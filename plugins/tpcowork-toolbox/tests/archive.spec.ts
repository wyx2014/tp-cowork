import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { writeFile, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { readZip } from '../src/host/installer/archive.ts'
import { skillsFixture } from './skills-fixture.ts'

const { zipSync } = createRequire(resolve(import.meta.dirname, '../../../../deepseek-harness/package.json'))('fflate') as {
  zipSync(files: Record<string, Uint8Array>): Uint8Array
}
const entry = Buffer.from('---\nname: sample\ndescription: Archive sample\n---\nRead [reference](references/data.txt).\n')
const resources = { 'SKILL.md': entry, 'references/data.txt': Buffer.from('complete reference') }
const limits = [1024 * 1024, 100] as const

describe('local skill packages', () => {
  it.each([false, true])('imports a browser-selected SkillHub ZIP through the Gateway (wrapped: %s)', async wrapped => {
    const { ctx, installer, dir } = await skillsFixture()
    const image = new Uint8Array([0, 255, 3, 128])
    const files = { ...resources, '_meta.json': Buffer.from('{"slug":"sample","version":"1.0.0"}'), 'assets/image.bin': image }
    const zip = zipSync(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [wrapped ? `sample/${name}` : name, bytes])))
    const prepared = await ctx.typertGateway.invoke({ namespace: 'toolboxInstaller', method: 'prepareArchive', args: { request: { contentBase64: Buffer.from(zip).toString('base64') } } }) as { importId: string; name: string }
    expect(prepared.name).toBe('sample')
    const result = await installer.install({ requestId: 'browser-zip', source: { kind: 'local', importId: prepared.importId }, scope: { kind: 'user' }, conflict: 'reject' })
    expect(result.state).toBe('installed')
    expect(await readFile(join(dir, 'skills/sample/assets/image.bin'))).toEqual(Buffer.from(image))
    expect(await readFile(join(dir, 'skills/sample/_meta.json'), 'utf8')).toBe('{"slug":"sample","version":"1.0.0"}')
    expect((await ctx.skills.get('sample'))?.content).toContain('references/data.txt')
  })

  it('rejects corrupt and unsafe browser archives before staging', async () => {
    const { installer, ctx } = await skillsFixture()
    for (const contentBase64 of ['not base64!', Buffer.from('not a zip').toString('base64'), Buffer.from(zipSync({ ...resources, '../escape': Buffer.from('bad') })).toString('base64')]) {
      await expect(installer.prepareArchive({ contentBase64 })).rejects.toThrow()
    }
    expect(await ctx.skills.get('sample')).toBeUndefined()
  })

  it('imports ZIP files with root entries or a single wrapper, preserving binary resources', async () => {
    const { ctx, installer, home, dir } = await skillsFixture()
    const image = new Uint8Array([0, 255, 3, 0, 128])
    const files = { ...resources, 'assets/image.bin': image }
    expect(readZip(zipSync(files), ...limits).map(file => file.path)).toEqual(Object.keys(files))
    const zip = zipSync(Object.fromEntries(Object.entries(files).map(([name, bytes]) => ['sample/' + name, bytes])))
    const path = join(home, 'package.zip')
    await writeFile(path, zip)
    const preview = await installer.prepareLocalImport({ path })
    const result = await installer.install({ requestId: 'zip', source: { kind: 'local', importId: preview.importId }, scope: { kind: 'user' }, conflict: 'reject' })
    expect(result.state).toBe('installed')
    expect(await readFile(join(dir, 'skills/sample/assets/image.bin'))).toEqual(Buffer.from(image))
    expect((await ctx.skills.get('sample'))?.content).toContain('references/data.txt')
  })

  it('accepts standalone Markdown and rejects entries whose referenced resources are missing', async () => {
    const { installer, home } = await skillsFixture()
    const path = join(home, 'sample.md')
    await writeFile(path, entry)
    await expect(installer.prepareLocalImport({ path })).rejects.toMatchObject({ code: 'skills/missing-resource' })
    await writeFile(path, '---\nname: sample\ndescription: Markdown sample\n---\nComplete instructions.\n')
    expect(await installer.prepareLocalImport({ path })).toMatchObject({ name: 'sample' })
  })

  it('rejects traversal, colliding paths, multiple roots, symlinks and truncated archives', () => {
    for (const name of ['../escape.txt', '/absolute.txt', 'assets\\escape.txt', '.git/config']) {
      expect(() => readZip(zipSync({ ...resources, [name]: Buffer.from('bad') }), ...limits)).toThrow()
    }
    expect(() => readZip(zipSync({ ...resources, 'skill.md': entry }), ...limits)).toThrow()
    expect(() => readZip(zipSync({ 'one/SKILL.md': entry, 'two/SKILL.md': entry }), ...limits)).toThrow()
    const symlink = Buffer.from(zipSync(resources))
    const central = symlink.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    symlink.writeUInt32LE(0xa1ff0000, central + 38)
    expect(() => readZip(symlink, ...limits)).toThrowError(expect.objectContaining({ code: 'skills/symlink' }))
    expect(() => readZip(zipSync(resources).slice(0, -10), ...limits)).toThrow()
  })

  it('bounds uncompressed resources and rejects forged sizes or CRC values', () => {
    const zip = zipSync({ ...resources, 'assets/large.bin': new Uint8Array(100000) })
    expect(() => readZip(zip, 1000, 100)).toThrowError(expect.objectContaining({ code: 'skills/resource-size' }))
    expect(() => readZip(zip, limits[0], 1)).toThrowError(expect.objectContaining({ code: 'skills/resource-count' }))
    const corrupt = Buffer.from(zipSync(resources))
    const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    corrupt.writeUInt32LE(0, central + 16)
    expect(() => readZip(corrupt, ...limits)).toThrowError(expect.objectContaining({ code: 'skills/invalid-archive' }))
    const bomb = Buffer.from(zip)
    let position = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    for (let i = 0; i < 2; i++) position += 46 + bomb.readUInt16LE(position + 28) + bomb.readUInt16LE(position + 30) + bomb.readUInt16LE(position + 32)
    bomb.writeUInt32LE(1, position + 24)
    expect(() => readZip(bomb, ...limits)).toThrowError(expect.objectContaining({ code: 'skills/invalid-archive' }))
  })
})
