import { expect, it, vi } from 'vitest'
import { skillsFixture } from './skills-fixture.ts'

const pythonProbe = vi.hoisted(() => vi.fn(async () => ({ stdout: '[]', stderr: '' })))
vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  return { ...original, execFile: Object.assign(vi.fn(), { [promisify.custom]: pythonProbe }) }
})

it('reuses Python dependency probes while toggling and reading, publishes only actual changes, and explicitly rechecks dependencies', async () => {
  const { ctx, installer } = await skillsFixture()
  await installer.install({ requestId: 'creator', source: { kind: 'bundled', resourceId: 'skill-creator' }, scope: { kind: 'user' }, conflict: 'reject' })
  const notices: unknown[] = []
  ctx.on('toolbox/changed', notice => { notices.push(notice) })
  const catalog = await ctx.toolboxSkills.inventory({})
  const probes = pythonProbe.mock.calls.length
  expect(probes).toBeGreaterThan(0)
  notices.length = 0
  expect((await ctx.toolboxSkills.inventory({})).revision).toBe(catalog.revision)
  expect(notices).toEqual([])
  const item = catalog.items[0]!
  const disabled = await ctx.toolboxSkills.setEnabled({ id: item.id, expectedRevision: catalog.revision, enabled: false })
  expect(disabled.items[0]?.enabled).toBe(false)
  expect(await ctx.skills.get(item.name)).toBeUndefined()
  expect(notices.length).toBeGreaterThan(0)
  await ctx.toolboxSkills.setEnabled({ id: item.id, expectedRevision: disabled.revision, enabled: true })
  expect(await ctx.skills.get(item.name)).toBeDefined()
  await ctx.toolboxSkills.detail({ id: item.id })
  expect(pythonProbe).toHaveBeenCalledTimes(probes)
  await ctx.toolboxSkills.checkReadiness({ id: item.id })
  expect(pythonProbe).toHaveBeenCalledTimes(probes + 1)
})
