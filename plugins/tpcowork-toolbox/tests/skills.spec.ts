import { describe, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { skillsFixture } from './skills-fixture.ts'
import { ToolboxSkills } from '../src/host/skills/index.ts'
describe('skills profile lifecycle through real Loader and Gateway', () => {
  it('shows missing runtime dependencies and configuration without running external actions', async () => {
    const { ctx, installer } = await skillsFixture({ python: '/not-installed/toolbox-python' })
    for (const name of ['call', 'skill-creator']) expect((await installer.install({ requestId: name, source: { kind: 'bundled', resourceId: name }, scope: { kind: 'user' }, conflict: 'reject' })).state).toBe('installed')
    const catalog = await ctx.toolboxSkills.inventory({})
    expect(catalog.items.find(item => item.name === 'call')?.readiness).toMatchObject({ state: 'blocked', reasons: expect.arrayContaining([expect.objectContaining({ code: 'needs-configuration' })]) })
    expect(catalog.items.find(item => item.name === 'skill-creator')?.readiness).toMatchObject({ state: 'blocked', reasons: expect.arrayContaining([expect.objectContaining({ code: 'python-unavailable' })]) })
  })

  it('installs, disables in /name and loader, survives restart, re-enables and removes with tombstone', async () => {
    const { ctx, installer, start, dir } = await skillsFixture()
    const installed = await installer.install({ requestId: 'memory', source: { kind: 'bundled', resourceId: 'memory' }, scope: { kind: 'user' }, conflict: 'reject' })
    expect(installed.state).toBe('installed')
    const list = () => ctx.typertGateway.invoke({ namespace: 'toolboxSkills', method: 'inventory', args: { request: {} } })
    const catalog = await ctx.toolboxSkills.inventory({})
    expect(catalog.items[0]).toMatchObject({ id: installed.skillId, installed: true, enabled: true, origin: 'bundled', readiness: { state: 'ready' } })
    expect(await list()).toMatchObject({ revision: catalog.revision, complete: true, items: [{ id: installed.skillId, enabled: true }] })
    const notices: unknown[] = []
    const stop = ctx.on('toolbox/changed', notice => { notices.push(notice) })
    await ctx.parallel('settings/document-updated', 'toolbox-skills')
    expect(notices).toEqual([])
    stop()
    await expect(ctx.toolboxSkills.setEnabled({ id: installed.skillId!, enabled: false, expectedRevision: 0 })).rejects.toMatchObject({ code: 'toolbox/stale-selection' })
    const disabled = await ctx.toolboxSkills.setEnabled({ id: installed.skillId!, enabled: false, expectedRevision: catalog.revision })
    expect(disabled.items[0]?.enabled).toBe(false)
    expect(await ctx.skills.list()).toEqual([])
    expect(await ctx.skills.get('memory')).toBeUndefined()
    const restarted = await start()
    expect(await restarted.skills.get('memory')).toBeUndefined()
    const restored = await restarted.toolboxSkills.inventory({})
    const enabled = await restarted.toolboxSkills.setEnabled({ id: installed.skillId!, enabled: true, expectedRevision: restored.revision })
    expect((await restarted.skills.get('memory'))?.content).toContain('DSH')
    expect((await restarted.toolboxSkills.checkReadiness({ id: installed.skillId! })).readiness.state).toBe('ready')
    await restarted.toolboxSkills.remove({ id: installed.skillId!, expectedRevision: enabled.revision })
    expect(await restarted.skills.list()).toEqual([])
    expect((await readdir(join(dir, 'skills'))).length).toBe(0)
    expect(await readFile(join(dir, 'cordis.patch.yml'), 'utf8')).toContain('removedBundled')
    await restarted.fiber.dispose()
    expect(restarted.get('toolboxSkills')).toBeUndefined()
    expect(restarted.get('toolboxInstaller')).toBeUndefined()
  })
  it('invalidates user skill discovery immediately after removal without a policy change', async () => {
    const { ctx, installer } = await skillsFixture()
    const prepared = await installer.prepareSkill({ content: '---\nname: removal-check\ndescription: User removal fixture\n---\nCheck removal.\n' })
    const installed = await installer.install({ requestId: 'user-removal', source: { kind: 'local', importId: prepared.importId }, scope: { kind: 'user' }, conflict: 'reject' })
    const catalog = await ctx.toolboxSkills.inventory({})
    expect(catalog.items.map(item => item.name)).toEqual(['removal-check'])
    await ctx.toolboxSkills.remove({ id: installed.skillId!, expectedRevision: catalog.revision })
    expect((await ctx.toolboxSkills.inventory({})).items).toEqual([])
    expect(await ctx.skills.list()).toEqual([])
  })

  it('installs the 31 retained migrated skills without the six retired names', async () => {
    const { ctx, installer, bundledRoot } = await skillsFixture()
    const names = await readdir(bundledRoot)
    expect(names.length).toBe(31)
    for (const name of ['office-documents', 'xlsx', 'portfolio-analysis', 'corporate-ppt', 'docx', 'pdf']) expect(names).not.toContain(name)
    for (const name of names) {
      const result = await installer.install({ requestId: name, source: { kind: 'bundled', resourceId: name }, scope: { kind: 'user' }, conflict: 'reject' })
      expect(result.error, name).toBeUndefined()
      expect(result, name).toMatchObject({ state: 'installed' })
      expect((await ctx.skills.get(name))?.resourceBase?.kind, name).toBe('directory')
    }
    expect((await ctx.skills.list()).map(item => item.name).sort()).toEqual(names.sort())
    expect(await ctx.skills.get('create-skill')).toMatchObject({ invocation: { modelInvocable: false, userInvocable: true } })
    expect(ctx.get('toolboxSkills')).toBeInstanceOf(ToolboxSkills)
  })
})
