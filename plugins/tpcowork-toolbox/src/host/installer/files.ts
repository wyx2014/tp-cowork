import { SkillError } from './errors.ts'
/** Validate and fingerprint complete skill trees before publication. Never follow imported links. */
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { parseSkillFrontmatter, parseSkillInvocationPolicy } from '@deepseek-ai/dsh-skill-filesystem'
import { z } from 'zod'

export const markerName = '.toolbox-install.json'
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
export interface SkillFile { path: string; bytes: Uint8Array; sha256: string }
export const manifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64), description: z.string().min(1),
  'disable-model-invocation': z.boolean().optional(), 'user-invocable': z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
}).passthrough()
export function parseSkill(bytes: Uint8Array) {
  const text = Buffer.from(bytes).toString('utf8')
  try {
    const parsed = parseSkillFrontmatter(text)
    if (!parsed) throw new SkillError('skills/invalid-frontmatter')
    const invocation = parseSkillInvocationPolicy(parsed.data)
    return { ...manifestSchema.parse({ ...parsed.data, 'disable-model-invocation': !invocation.modelInvocable, 'user-invocable': invocation.userInvocable }), content: parsed.body }
  } catch { throw new SkillError('skills/invalid-frontmatter') }
}
export function safeResource(path: string): string {
  if (!path || path.includes('\\') || path.includes('\0') || path.includes(':') || isAbsolute(path)
    || path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')
    || path.toLowerCase() === markerName) throw new SkillError('skills/unsafe-resource-path')
  return path
}
export function contained(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return rel !== '' && !isAbsolute(rel) && rel.split(/[\\/]/)[0] !== '..'
}
export function fingerprint(files: readonly SkillFile[]): string {
  return sha256([...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(file => `${file.path}\0${file.sha256}\n`).join(''))
}
export function validateFiles(files: readonly SkillFile[], maxBytes: number, maxFiles: number): void {
  if (!files.length || files.length > maxFiles) throw new SkillError('skills/resource-count')
  const seen = new Set<string>()
  let total = 0
  for (const file of files) {
    const key = safeResource(file.path).normalize('NFC').toLowerCase()
    if (seen.has(key) || [...seen].some(other => key.startsWith(other + '/') || other.startsWith(key + '/'))) throw new SkillError('skills/resource-conflict')
    seen.add(key)
    total += file.bytes.byteLength
    if (total > maxBytes) throw new SkillError('skills/resource-size')
    if (sha256(file.bytes) !== file.sha256) throw new SkillError('skills/resource-hash')
  }
  const entry = files.find(file => file.path === 'SKILL.md')
  if (!entry) throw new SkillError('skills/missing-entry')
  const skill = parseSkill(entry.bytes)
  for (const match of skill.content.matchAll(/\]\(((?:scripts|references|assets)\/[^)\s]+)\)/g)) {
    const path = safeResource(decodeURIComponent(match[1]!.split('#')[0]!))
    if (!files.some(file => file.path === path)) throw new SkillError('skills/missing-resource')
  }
  const declared = files.find(file => file.path === 'toolbox.json')
  if (declared) {
    const meta = z.object({ requiredFiles: z.array(z.string()), checksums: z.record(z.string(), z.string()).optional() }).passthrough()
      .parse(JSON.parse(Buffer.from(declared.bytes).toString('utf8')))
    for (const path of meta.requiredFiles) if (!files.some(file => file.path === safeResource(path))) throw new SkillError('skills/missing-resource')
    for (const [path, hash] of Object.entries(meta.checksums ?? {})) if (files.find(file => file.path === safeResource(path))?.sha256 !== hash) throw new SkillError('skills/resource-hash')
  }
}
export async function readTree(root: string, maxBytes: number, maxFiles: number, owned = false): Promise<SkillFile[]> {
  if ((await lstat(root)).isSymbolicLink()) throw new SkillError('skills/symlink')
  const files: SkillFile[] = []
  let total = 0
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '__pycache__' || entry.name === '.DS_Store') continue
      if (owned && prefix === '' && entry.name === markerName) continue
      const path = safeResource(prefix + entry.name)
      const target = join(directory, entry.name)
      const stat = await lstat(target)
      if (stat.isSymbolicLink()) throw new SkillError('skills/symlink')
      if (stat.isDirectory()) { await walk(target, path + '/'); continue }
      if (!stat.isFile()) throw new SkillError('skills/special-file')
      total += stat.size
      if (total > maxBytes || files.length >= maxFiles) throw new SkillError('skills/resource-size')
      const bytes = await readFile(target)
      files.push({ path, bytes, sha256: sha256(bytes) })
    }
  }
  await walk(root, '')
  validateFiles(files, maxBytes, maxFiles)
  return files
}
