import { describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { skillsFixture } from './skills-fixture.ts'
import { fingerprint, readTree, sha256, validateFiles } from '../src/host/installer/files.ts'
const text = (body: string) => `---\nname: sample\ndescription: A sample\n---\n${body}\n`
async function draft(home: string, body = 'first') {
  const path = join(home, 'draft')
  await mkdir(join(path, 'assets'), { recursive: true })
  await writeFile(join(path, 'SKILL.md'), text(body))
  await writeFile(join(path, 'assets/data.txt'), 'complete resource')
  return path
}
describe('unified installer', () => {
  it('creates manually authored skills through the real Gateway and native discovery, preserving conflicts', async () => {
    const { ctx, installer, dir } = await skillsFixture()
    const prepared = await ctx.typertGateway.invoke({ namespace: 'toolboxInstaller', method: 'prepareSkill', args: { request: { content: text('Manually authored instructions.') } } }) as { importId: string }
    const request = { requestId: 'manual', source: { kind: 'local' as const, importId: prepared.importId }, scope: { kind: 'user' as const }, conflict: 'reject' as const }
    expect((await installer.install(request)).state).toBe('installed')
    expect((await ctx.skills.get('sample'))?.content).toBe('Manually authored instructions.')
    expect((await installer.install(request)).state).toBe('installed')
    const conflict = await installer.prepareSkill({ content: text('Replacement instructions.') })
    expect((await installer.install({ ...request, requestId: 'manual-conflict', source: { kind: 'local', importId: conflict.importId } })).error?.code).toBe('skills/name-conflict')
    expect(await readFile(join(dir, 'skills/sample/SKILL.md'), 'utf8')).toContain('Manually authored instructions.')
    await expect(installer.prepareSkill({ content: text('Missing [script](scripts/missing.py)') })).rejects.toMatchObject({ code: 'skills/missing-resource' })
  })
  it('releases completed imports and expires old previews without permanently exhausting import slots', async () => {
    const { installer } = await skillsFixture()
    const first = await installer.prepareSkill({ content: text('Preview') })
    let latest = first
    for (let index = 0; index < 40; index++) latest = await installer.prepareSkill({ content: text('Preview ' + index) })
    const request = { requestId: 'old-preview', source: { kind: 'local' as const, importId: first.importId }, scope: { kind: 'user' as const }, conflict: 'reject' as const }
    expect((await installer.install(request)).error?.code).toBe('skills/import-expired')
    expect((await installer.install({ ...request, requestId: 'latest-preview', source: { kind: 'local', importId: latest.importId } })).state).toBe('installed')
    expect((await installer.install({ ...request, requestId: 'consumed-preview', source: { kind: 'local', importId: latest.importId } })).error?.code).toBe('skills/import-expired')
    const expiring = await installer.prepareSkill({ content: text('Expires') })
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 16 * 60 * 1000)
    try { expect((await installer.install({ ...request, requestId: 'expired-preview', source: { kind: 'local', importId: expiring.importId } })).error?.code).toBe('skills/import-expired') }
    finally { clock.mockRestore() }
  })
  it('imports full resources, updates an owned tree, rejects user edits, and preserves foreign names', async () => {
    const { ctx, installer, home, dir } = await skillsFixture()
    const path = await draft(home)
    const first = await installer.prepareLocalImport({ path })
    const request = { requestId: 'first', source: { kind: 'local' as const, importId: first.importId }, scope: { kind: 'user' as const }, conflict: 'reject' as const }
    const result = await installer.install(request)
    expect(result.state).toBe('installed')
    expect(await installer.install(request)).toEqual(result)
    expect(await readFile(join(dir, 'skills/sample/assets/data.txt'), 'utf8')).toBe('complete resource')
    expect((await ctx.skills.get('sample'))?.content).toBe('first')
    await writeFile(join(path, 'SKILL.md'), text('updated'))
    const update = await installer.prepareLocalImport({ path })
    expect((await installer.install({ ...request, requestId: 'reject-update', source: { kind: 'local', importId: update.importId } })).state).toBe('failed')
    expect((await installer.install({ ...request, requestId: 'update', source: { kind: 'local', importId: update.importId }, conflict: 'replace-owned' })).state).toBe('installed')
    expect((await ctx.skills.get('sample'))?.content).toBe('updated')
    await writeFile(join(dir, 'skills/sample/assets/data.txt'), 'user edit')
    expect((await installer.install({ ...request, requestId: 'preserve-edit', source: { kind: 'local', importId: update.importId }, conflict: 'replace-owned' })).state).toBe('failed')
    const catalog = await ctx.toolboxSkills.inventory({})
    await expect(ctx.toolboxSkills.remove({ id: result.skillId!, expectedRevision: catalog.revision })).rejects.toMatchObject({ code: 'skills/user-modified' })
    expect(await readFile(join(dir, 'skills/sample/assets/data.txt'), 'utf8')).toBe('user edit')
  })
  it('rejects traversal, duplicate names, invalid hashes, symlinks and missing resources', async () => {
    const { installer, home, dir } = await skillsFixture()
    const path = await draft(home)
    await symlink('/etc/hosts', join(path, 'assets/link'))
    await expect(installer.prepareLocalImport({ path })).rejects.toMatchObject({ code: 'skills/symlink' })
    const bytes = Buffer.from(text('safe'))
    const file = { path: 'SKILL.md', bytes, sha256: sha256(bytes) }
    for (const bad of ['../evil','/absolute','a\\b','a//b','.toolbox-install.json','C:/escape']) expect(() => validateFiles([file, { ...file, path: bad }], 99999, 100)).toThrow()
    expect(() => validateFiles([file, { ...file, path: 'skill.md' }], 99999, 100)).toThrowError(expect.objectContaining({ code: 'skills/resource-conflict' }))
    expect(() => validateFiles([{ ...file, sha256: 'bad' }], 99999, 100)).toThrowError(expect.objectContaining({ code: 'skills/resource-hash' }))
    expect(() => validateFiles([file], 1, 100)).toThrowError(expect.objectContaining({ code: 'skills/resource-size' }))
    const meta = Buffer.from(JSON.stringify({ requiredFiles: ['missing.bin'] }))
    expect(() => validateFiles([file, { path: 'toolbox.json', bytes: meta, sha256: sha256(meta) }], 99999, 100)).toThrowError(expect.objectContaining({ code: 'skills/missing-resource' }))
    await mkdir(join(dir, 'skills/sample'), { recursive: true })
    await writeFile(join(dir, 'skills/sample/SKILL.md'), text('foreign'))
    const source = join(home, 'clean'); await mkdir(source); await writeFile(join(source, 'SKILL.md'), bytes)
    const prepared = await installer.prepareLocalImport({ path: source })
    expect((await installer.install({ requestId: 'foreign', source: { kind: 'local', importId: prepared.importId }, scope: { kind: 'user' }, conflict: 'replace-owned' })).error?.code).toBe('skills/not-owned')
    expect(await readFile(join(dir, 'skills/sample/SKILL.md'), 'utf8')).toContain('foreign')
  })
  it('shares TpcoworkHub validation, rejects fingerprint mismatches, and cancels before commit', async () => {
    const { installer, home, dir } = await skillsFixture()
    const path = await draft(home)
    const files = await readTree(path, 99999, 100)
    const release = installer.registerSource('tpcoworkhub', async () => files)
    const source = { kind: 'tpcoworkhub' as const, skillId: 'public-1', versionId: 'v1', fingerprint: fingerprint(files) }
    const request = { requestId: 'hub', source, scope: { kind: 'user' as const }, conflict: 'reject' as const }
    expect((await installer.install({ ...request, requestId: 'bad-hub', source: { ...source, fingerprint: '0'.repeat(64) } })).error?.code).toBe('skills/package-hash')
    const pending = installer.install({ ...request, requestId: 'cancel' }); await installer.cancel({ operationId: 'cancel' })
    expect((await pending).state).toBe('cancelled')
    expect((await installer.install(request)).state).toBe('installed')
    expect(JSON.parse(await readFile(join(dir, 'skills/sample/.toolbox-install.json'), 'utf8')).source).toBe('tpcoworkhub:public-1')
    release()
    expect((await installer.install({ ...request, requestId: 'no-hub' })).error?.code).toBe('skills/source-unavailable')
  })
  it('rejects a same-name skill owned by another DSH provider', async () => {
    const { ctx, installer, home } = await skillsFixture()
    ctx.skills.register({ name: 'sample', description: 'User runtime', source: 'runtime', content: 'Keep this definition' })
    const path = await draft(home)
    const source = await installer.prepareLocalImport({ path })
    const result = await installer.install({ requestId: 'provider-conflict', source: { kind: 'local', importId: source.importId }, scope: { kind: 'user' }, conflict: 'replace-owned' })
    expect(result).toMatchObject({ state: 'failed', error: { code: 'skills/name-conflict' } })
    expect((await ctx.skills.get('sample'))?.content).toBe('Keep this definition')
  })
  it('refuses installation when another provider cannot complete discovery', async () => {
    const { ctx, installer, home, dir } = await skillsFixture()
    ctx.skills.registerProvider(() => ({ name: 'offline', list: async () => ({ candidates: [], complete: false }), get: async () => undefined }))
    const path = await draft(home)
    const source = await installer.prepareLocalImport({ path })
    const result = await installer.install({ requestId: 'incomplete', source: { kind: 'local', importId: source.importId }, scope: { kind: 'user' }, conflict: 'reject' })
    expect(result).toMatchObject({ state: 'failed', error: { code: 'skills/incomplete-inventory' } })
    await expect(readFile(join(dir, 'skills/sample/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
