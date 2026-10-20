/** Real profile/Loader/settings/Gateway persistence, without using a desktop profile. */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, onTestFinished } from 'vitest'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { Context } from '@deepseek-ai/cordis'
import * as mcp from '../src/host/mcp/index.ts'

it('CRUD persists through real DSH profile patches and reload, preserving custom servers and removal policy', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'toolbox-mcp-')))
  const dir = join(home, 'profiles/test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules/test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
    { id: 'typert', name: 'cordis:typert' }, { id: 'gateway', name: 'cordis:gateway' },
    { id: 'prompt', name: 'cordis:prompt' }, { id: 'tools', name: 'cordis:tools' }, { id: 'credentials', name: 'cordis:credentials' },
    { id: 'toolbox-mcp', name: 'cordis:toolbox', config: { servers: mcp.defaultMcpDefinitions().map(definition => ({ definition, revision: 1 })) } },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
  const contexts: Awaited<ReturnType<typeof boot>>[] = []
  const start = async () => {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
      ctx.provide('profileContext', profile)
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, typert: TypertRegistry, gateway: Gateway, tools: Tools, prompt: SystemPrompt, toolbox: mcp,
        credentials: { apply(inner: Context) { inner.provide('credentials', { describe: async () => ({ configured: false, writable: false }) } as never) } },
      })
    })
    contexts.push(ctx)
    return ctx
  }
  onTestFinished(async () => { for (const ctx of contexts) await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }) })
  const ctx = await start()
  const initial = await ctx.toolboxMcp.inventory()
  expect(initial.items.map(item => item.id)).toEqual(['juyuan', 'caihui_mcp', 'playwright'])
  await ctx.parallel('settings/document-updated', 'toolbox-mcp')
  expect((await ctx.toolboxMcp.inventory()).revision).toBe(initial.revision)
  await ctx.toolboxMcp.create({ expectedRevision: initial.revision, definition: { id: 'my_custom', origin: 'custom', label: 'Custom', enabled: true, transport: 'streamable-http', endpoint: 'https://example.invalid/mcp', credentials: [], connectTimeout: 25, toolTimeout: 45 } })
  await ctx.toolboxMcp.setEnabled({ id: 'caihui_mcp', enabled: false, expectedRevision: (await ctx.toolboxMcp.inventory()).revision })
  await ctx.toolboxMcp.remove({ id: 'juyuan', expectedRevision: (await ctx.toolboxMcp.inventory()).revision })
  await ctx.fiber.dispose()
  const restored = await start()
  const inventory = await restored.typertGateway.invoke({ namespace: 'toolboxMcp', method: 'inventory', args: {} })
  expect(inventory).toMatchObject({ items: [
    { id: 'caihui_mcp', enabled: false, configRevision: 3 }, { id: 'playwright' }, { id: 'my_custom', origin: 'custom' },
  ] })
  expect(await restored.toolboxMcp.definition({ id: 'my_custom' })).toMatchObject({ connectTimeout: 25, toolTimeout: 45 })
  const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
  expect(patch).toContain('removedBundled'); expect(patch).toContain('juyuan')
  expect(patch).not.toContain('?token=')
})
