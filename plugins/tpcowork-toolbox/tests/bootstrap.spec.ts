/** Release upgrades through the single real profile entry, without a second installation database. */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { readFile, rm, writeFile, mkdir, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import Editor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import Typert from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Skills from '@deepseek-ai/dsh-skill'
import Tools from '@deepseek-ai/dsh-tools'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import * as toolbox from '../src/host.ts'
import { skillId } from '../src/host/installer/index.ts'
import { requireInstaller } from '../src/host/skills/index.ts'
import { markerName } from '../src/host/installer/files.ts'

async function fixture(initial: object = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'toolbox-bootstrap-')))
  const dir = join(home, 'profiles/test')
  const resources = join(home, 'release')
  const skill = async (name: string, body: string) => {
    await mkdir(join(resources, name), { recursive: true })
    await writeFile(join(resources, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Release sample\n---\n${body}\n`)
  }
  await skill('sample', 'v1'); await skill('removed', 'v1'); await skill('override', 'v1')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules/test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
    { id: 'typert', name: 'cordis:typert' }, { id: 'gateway', name: 'cordis:gateway' },
    { id: 'skills', name: 'cordis:skills' }, { id: 'prompt', name: 'cordis:prompt' },
    { id: 'tools', name: 'cordis:tools' }, { id: 'credentials', name: 'cordis:credentials' },
    { id: 'tpcowork-toolbox', name: 'cordis:toolbox', config: { ...initial, skills: { bundledRoot: resources, userRoot: join(dir, 'skills') } } },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
  const contexts: Context[] = []
  const start = async () => {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
      ctx.provide('profileContext', profile)
      Object.assign(ctx.loader.builtins, { editor: Editor, settings: Settings, typert: Typert, gateway: Gateway, skills: Skills, tools: Tools, prompt: Prompt, toolbox,
        credentials: { apply(inner: Context) { inner.provide('credentials', {
          describe: async () => ({ configured: false, writable: false }), readRecord: async () => undefined,
          describeRecord: async () => ({ configured: false, writable: false }),
        } as never) } },
      })
    })
    contexts.push(ctx)
    await vi.waitFor(async () => {
      for (const runtime of ctx.registry.values()) for (const fiber of runtime.fibers) await fiber.await()
      expect(ctx.get('toolboxMcp')).toBeDefined()
    }, { timeout: 3000 })
    return ctx
  }
  onTestFinished(async () => { for (const ctx of contexts) await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }) })
  const deployment = async (value: object) => {
    const current = readProfilePatches('test', profile).findLast(patch => 'id' in patch && patch.id === 'tpcowork-toolbox')
    const patch = JSON.parse(JSON.stringify(current))
    patch.config.deployment = value
    await writeFile(profile.patchPath, JSON.stringify([patch]))
  }
  return { home, dir, skill, start, deployment }
}

it('initializes a fresh profile once and preserves disable/remove/override choices through restart and release upgrade', async () => {
  const { dir, start, skill, deployment } = await fixture()
  const ctx = await start()
  expect((await ctx.toolbox.describe()).modules).toEqual({ skills: true, installer: true, mcp: true, teams: false, tpcoworkhub: true })
  expect(await ctx.toolboxTpcoworkHub.account()).toMatchObject({ configured: false, state: 'signed_out' })
  expect(await ctx.toolboxTpcoworkHub.browserAuth()).toMatchObject({ loginUrl: 'http://localhost:8080/desktop/authorize' })
  const mcp = await ctx.toolboxMcp.inventory()
  expect(mcp.items.map(item => item.id)).toEqual(['juyuan', 'caihui_mcp', 'playwright'])
  expect(mcp.items.find(item => item.id === 'juyuan')?.readiness.reasons).toContainEqual(expect.objectContaining({ code: 'needs_configuration' }))
  expect(ctx.tools.schemas().some(item => item.name.startsWith('mcp__'))).toBe(false)
  const firstPatch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
  await ctx.fiber.dispose()
  const again = await start()
  expect(await readFile(join(dir, 'cordis.patch.yml'), 'utf8')).toBe(firstPatch)
  await again.toolboxSkills.setEnabled({ id: skillId(join(dir, 'skills/sample')), enabled: false, expectedRevision: (await again.toolboxSkills.inventory({})).revision })
  await again.toolboxSkills.remove({ id: skillId(join(dir, 'skills/removed')), expectedRevision: (await again.toolboxSkills.inventory({})).revision })
  await writeFile(join(dir, 'skills/override/SKILL.md'), '---\nname: override\ndescription: Mine\n---\nUser override\n')
  await again.toolboxMcp.setEnabled({ id: 'caihui_mcp', enabled: false, expectedRevision: (await again.toolboxMcp.inventory()).revision })
  await again.toolboxMcp.remove({ id: 'juyuan', expectedRevision: (await again.toolboxMcp.inventory()).revision })
  const original = await again.toolboxMcp.definition({ id: 'playwright' })
  await again.toolboxMcp.update({ expectedRevision: (await again.toolboxMcp.inventory()).revision, definition: { ...original, transport: 'stdio', command: 'my-local-browser', args: [] } })
  await again.fiber.dispose()
  await skill('sample', 'v2'); await skill('override', 'v2'); await skill('new-default', 'v2')
  await deployment({ caihuiEndpoint: 'https://example.invalid/new-default', playwrightCommand: 'new-default-browser', playwrightArgs: [] })
  const upgrade = await start()
  expect(await readFile(join(dir, 'skills/sample/SKILL.md'), 'utf8')).toContain('v2')
  expect((await upgrade.toolboxSkills.inventory({})).items.find(item => item.name === 'sample')?.enabled).toBe(false)
  await expect(readFile(join(dir, 'skills/removed/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(dir, 'skills/override/SKILL.md'), 'utf8')).toContain('User override')
  expect(await readFile(join(dir, 'skills/new-default/SKILL.md'), 'utf8')).toContain('v2')
  const items = (await upgrade.toolboxMcp.inventory()).items
  expect(items.some(item => item.id === 'juyuan')).toBe(false)
  expect(items.find(item => item.id === 'caihui_mcp')?.enabled).toBe(false)
  expect(await upgrade.toolboxMcp.definition({ id: 'caihui_mcp' })).toMatchObject({ endpoint: 'https://example.invalid/new-default' })
  expect(await upgrade.toolboxMcp.definition({ id: 'playwright' })).toMatchObject({ command: 'my-local-browser' })
}, 30000)

it('adopts old profiles conservatively, retires only product-owned legacy MCPs and never clears custom names', async () => {
  const { start, dir } = await fixture({ mcp: { servers: [
    { revision: 2, definition: { id: 'anysearch', label: 'User custom', origin: 'custom', enabled: false, transport: 'stdio', command: 'user-command', args: [], credentials: [] } },
    { revision: 3, definition: { id: 'hexin-ifind-ds-stock-mcp', label: 'Old product default', origin: 'bundled', enabled: true, transport: 'stdio', command: 'old-command', args: [], credentials: [] } },
    { revision: 4, definition: { id: 'juyuan', label: 'My endpoint', origin: 'custom', enabled: true, transport: 'streamable-http', endpoint: 'https://example.invalid/mcp', credentials: [] } },
  ] } })
  await mkdir(join(dir, 'skills/sample'), { recursive: true })
  await writeFile(join(dir, 'skills/sample/SKILL.md'), '---\nname: sample\ndescription: Custom\n---\nKeep me\n')
  const ctx = await start()
  expect(await readFile(join(dir, 'skills/sample/SKILL.md'), 'utf8')).toContain('Keep me')
  expect((await ctx.toolboxMcp.inventory()).items.map(item => item.id)).toEqual(['anysearch', 'juyuan', 'caihui_mcp', 'playwright'])
  expect(await ctx.toolboxMcp.definition({ id: 'juyuan' })).toMatchObject({ origin: 'custom', endpoint: 'https://example.invalid/mcp' })
})

it('leaves out-of-band file removals absent on later releases', async () => {
  const { start, dir, skill } = await fixture()
  const ctx = await start(); await ctx.fiber.dispose()
  await rm(join(dir, 'skills/sample'), { recursive: true })
  await skill('sample', 'v2')
  const next = await start()
  await expect(readFile(join(dir, 'skills/sample/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await next.toolbox.describe()).modules.skills).toBe(true)
})

it('retires removed bundled skills on upgrade and preserves modified or custom copies', async () => {
  const { start, dir, skill } = await fixture()
  const ctx = await start()
  const installer = requireInstaller(ctx)
  for (const name of ['office-documents', 'xlsx', 'portfolio-analysis', 'corporate-ppt', 'docx', 'pdf', 'writing-plans', 'write-article', 'weekly-report', 'long-goal', 'memory', 'my', 'weather', 'cron', 'create-skill']) {
    await skill(name, 'v1')
    const result = await installer.install({ requestId: name, source: { kind: 'bundled', resourceId: name }, scope: { kind: 'user' }, conflict: 'reject' })
    expect(result.state).toBe('installed')
  }
  await writeFile(join(dir, 'skills/xlsx/SKILL.md'), '---\nname: xlsx\ndescription: My spreadsheet workflow\n---\nUser override\n')
  await rm(join(dir, 'skills/portfolio-analysis', markerName), { force: true })
  await ctx.fiber.dispose()
  const upgraded = await start()
  for (const name of ['office-documents', 'corporate-ppt', 'docx', 'pdf', 'writing-plans', 'write-article', 'weekly-report', 'long-goal', 'memory', 'my', 'weather', 'cron', 'create-skill']) expect(await upgraded.skills.get(name)).toBeUndefined()
  expect((await upgraded.skills.get('xlsx'))?.content).toContain('User override')
  expect((await upgraded.skills.get('portfolio-analysis'))?.content).toContain('v1')
  expect(await readFile(join(dir, 'cordis.patch.yml'), 'utf8')).toContain('office-documents')
  await upgraded.fiber.dispose()
  const restarted = await start()
  for (const name of ['office-documents', 'corporate-ppt', 'docx', 'pdf', 'writing-plans', 'write-article', 'weekly-report', 'long-goal', 'memory', 'my', 'weather', 'cron', 'create-skill']) expect(await restarted.skills.get(name)).toBeUndefined()
})


it('installs the new PDF starter while preserving a user-owned legacy pdf skill', async () => {
  const { start, home, dir } = await fixture()
  await cp(new URL('../resources/skills/office-pdf/', import.meta.url), join(home, 'release/office-pdf'), { recursive: true })
  await mkdir(join(dir, 'skills/pdf'), { recursive: true })
  await writeFile(join(dir, 'skills/pdf/SKILL.md'), '---\nname: pdf\ndescription: My PDF workflow\n---\nKeep my workflow\n')
  const ctx = await start()
  expect((await ctx.skills.get('office-pdf'))?.content).toContain('scripts/create.mjs')
  expect(await readFile(join(dir, 'skills/office-pdf/scripts/create.mjs'), 'utf8')).toContain('createDocument')
  expect((await ctx.skills.get('pdf'))?.content).toContain('Keep my workflow')
  await ctx.fiber.dispose()
  const again = await start()
  expect((await again.skills.get('office-pdf'))?.content).toContain('scripts/create.mjs')
  expect((await again.skills.get('pdf'))?.content).toContain('Keep my workflow')
})

it('keeps MCP and the store available when one bundled skill is invalid, then repairs only failed defaults on retry', async () => {
  const { start, home, dir, skill } = await fixture()
  await writeFile(join(home, 'release/override/SKILL.md'), '---\nname: [\n---\nBroken release\n')
  const ctx = await start()
  expect((await ctx.toolbox.describe()).modules).toMatchObject({ skills: true, mcp: true, tpcoworkhub: true })
  expect((await ctx.toolboxMcp.inventory()).items.map(item => item.id)).toContain('caihui_mcp')
  expect((await ctx.skills.get('sample'))?.content).toContain('v1')
  expect((await ctx.toolbox.describe()).initialization).toMatchObject({ state: 'failed', issues: [{ kind: 'skill', resourceId: 'override', code: 'skills/invalid-frontmatter' }] })
  expect(await readFile(join(dir, 'cordis.patch.yml'), 'utf8')).not.toMatch(/override: [a-f0-9]{64}/)
  await ctx.toolboxSkills.remove({ id: skillId(join(dir, 'skills/removed')), expectedRevision: (await ctx.toolboxSkills.inventory({})).revision })
  await skill('override', 'repaired')
  const recovered = await ctx.toolbox.retryInitialization()
  expect(recovered.initialization).toEqual({ state: 'ready', issues: [] })
  expect((await ctx.skills.get('override'))?.content).toContain('repaired')
  expect(await ctx.skills.get('removed')).toBeUndefined()
  await ctx.fiber.dispose()
  const again = await start()
  expect((await again.toolbox.describe()).initialization).toEqual({ state: 'ready', issues: [] })
  expect(await again.skills.get('removed')).toBeUndefined()
})

it('keeps management available with a missing release directory and initializes resources after it is restored', async () => {
  const { start, home, skill } = await fixture()
  await rm(join(home, 'release'), { recursive: true })
  const ctx = await start()
  expect((await ctx.toolbox.describe()).initialization).toEqual({ state: 'failed', issues: [{ kind: 'resources', resourceId: 'bundled-skills', code: 'filesystem/ENOENT' }] })
  expect((await ctx.toolboxMcp.inventory()).items).toHaveLength(3)
  expect((await ctx.toolboxTpcoworkHub.account()).state).toBe('signed_out')
  await skill('sample', 'restored')
  const results = await Promise.all([ctx.toolbox.retryInitialization(), ctx.toolbox.retryInitialization()])
  expect(results.every(result => result.initialization.state === 'ready')).toBe(true)
  expect((await ctx.skills.get('sample'))?.content).toContain('restored')
})
