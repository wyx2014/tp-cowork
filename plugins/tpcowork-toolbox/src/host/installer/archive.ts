/** Read bounded ZIP resources in memory; archive paths are never extracted to disk. */
import { readFile, lstat } from 'node:fs/promises'
import { extname } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
import { SkillError } from './errors.ts'
import { readTree, safeResource, sha256, validateFiles, type SkillFile } from './files.ts'

/** Accept a complete directory, a Markdown entry, or a ZIP with one skill root. */
export async function readPackage(path: string, maxBytes: number, maxFiles: number): Promise<SkillFile[]> {
  const stat = await lstat(path)
  if (stat.isSymbolicLink()) throw new SkillError('skills/symlink')
  if (stat.isDirectory()) return readTree(path, maxBytes, maxFiles)
  if (!stat.isFile()) throw new SkillError('skills/special-file')
  if (stat.size > maxBytes) throw new SkillError('skills/resource-size')
  const bytes = await readFile(path)
  if (extname(path).toLowerCase() === '.zip') return readZip(bytes, maxBytes, maxFiles)
  if (extname(path).toLowerCase() !== '.md') throw new SkillError('skills/unsupported-package')
  const files = [{ path: 'SKILL.md', bytes, sha256: sha256(bytes) }]
  validateFiles(files, maxBytes, maxFiles)
  return files
}

/** Validate ZIP metadata, output limits and CRC before returning a single complete skill tree. */
export function readZip(bytes: Uint8Array, maxBytes: number, maxFiles: number): SkillFile[] {
  try { return parseZip(Buffer.from(bytes), maxBytes, maxFiles) }
  catch (error) { if (error instanceof SkillError) throw error; throw new SkillError('skills/invalid-archive') }
}

function parseZip(archive: Buffer, maxBytes: number, maxFiles: number): SkillFile[] {
  if (archive.length > maxBytes) throw new SkillError('skills/resource-size')
  let end = archive.length - 22
  for (; end >= Math.max(0, archive.length - 65557); end--) {
    if (archive.readUInt32LE(end) === 0x06054b50 && end + 22 + archive.readUInt16LE(end + 20) === archive.length) break
  }
  if (end < 0 || archive.readUInt32LE(end) !== 0x06054b50) throw new SkillError('skills/invalid-archive')
  const count = archive.readUInt16LE(end + 10)
  const centralSize = archive.readUInt32LE(end + 12)
  const centralStart = archive.readUInt32LE(end + 16)
  if (archive.readUInt16LE(end + 4) || archive.readUInt16LE(end + 6) || archive.readUInt16LE(end + 8) !== count
    || count === 0xffff || centralStart === 0xffffffff || centralSize === 0xffffffff
    || centralStart + centralSize !== end) throw new SkillError('skills/invalid-archive')
  // Directory entries consume archive space too, even when they contain no bytes.
  if (count > maxFiles * 4) throw new SkillError('skills/resource-count')
  const files: SkillFile[] = []
  let cursor = centralStart
  let total = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || archive.readUInt32LE(cursor) !== 0x02014b50) throw new SkillError('skills/invalid-archive')
    const flags = archive.readUInt16LE(cursor + 8)
    const method = archive.readUInt16LE(cursor + 10)
    const checksum = archive.readUInt32LE(cursor + 16)
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const size = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const attributes = archive.readUInt32LE(cursor + 38)
    const offset = archive.readUInt32LE(cursor + 42)
    const next = cursor + 46 + nameLength + archive.readUInt16LE(cursor + 30) + archive.readUInt16LE(cursor + 32)
    if (next > end || flags & 1 || ![0, 8].includes(method) || archive.readUInt16LE(cursor + 34)) throw new SkillError('skills/invalid-archive')
    const nameBytes = archive.subarray(cursor + 46, cursor + 46 + nameLength)
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes)
    const directory = name.endsWith('/')
    const path = safeResource(directory ? name.slice(0, -1) : name)
    const mode = attributes >>> 16 & 0xf000
    if (mode === 0xa000) throw new SkillError('skills/symlink')
    if (mode && mode !== (directory ? 0x4000 : 0x8000)) throw new SkillError('skills/special-file')
    if (offset + 30 > centralStart || archive.readUInt32LE(offset) !== 0x04034b50
      || archive.readUInt16LE(offset + 6) !== flags || archive.readUInt16LE(offset + 8) !== method) throw new SkillError('skills/invalid-archive')
    const localNameLength = archive.readUInt16LE(offset + 26)
    const start = offset + 30 + localNameLength + archive.readUInt16LE(offset + 28)
    if (!archive.subarray(offset + 30, offset + 30 + localNameLength).equals(nameBytes)
      || start > centralStart || compressedSize > centralStart - start) throw new SkillError('skills/invalid-archive')
    total += size
    if (total > maxBytes) throw new SkillError('skills/resource-size')
    const compressed = archive.subarray(start, start + compressedSize)
    const content = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) })
    if (content.length !== size || crc32(content) !== checksum || directory && size !== 0) throw new SkillError('skills/invalid-archive')
    const ignored = path.split('/').some(part => ['__MACOSX', '__pycache__', '.DS_Store'].includes(part))
    if (!directory && !ignored) {
      if (files.length >= maxFiles) throw new SkillError('skills/resource-count')
      files.push({ path, bytes: content, sha256: sha256(content) })
    }
    cursor = next
  }
  if (cursor !== end) throw new SkillError('skills/invalid-archive')
  // Common exports wrap all files in a single directory. Never combine multiple skill packages.
  const entries = files.some(file => file.path === 'SKILL.md') ? files.filter(file => file.path === 'SKILL.md')
    : files.filter(file => file.path.endsWith('/SKILL.md') && file.path.split('/').length === 2)
  if (entries.length !== 1) throw new SkillError('skills/missing-entry')
  const prefix = entries[0]!.path.slice(0, -'SKILL.md'.length)
  if (prefix && (prefix.split('/').length !== 2 || files.some(file => !file.path.startsWith(prefix)))) throw new SkillError('skills/invalid-archive')
  const result = files.map(file => ({ ...file, path: file.path.slice(prefix.length) }))
  validateFiles(result, maxBytes, maxFiles)
  return result
}
