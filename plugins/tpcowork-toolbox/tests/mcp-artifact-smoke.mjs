// Load compiled module and real DSH peers without touching a user profile.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = resolve(root, '../../../deepseek-harness')
const peers = new Map()
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const folder = resolve(directory, entry.name)
    let pkg
    try { pkg = JSON.parse(await readFile(resolve(folder, 'package.json'), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') { await collect(folder); continue } throw error }
    for (const [key, value] of Object.entries(pkg.exports ?? {})) {
      const target = typeof value === 'string' ? value : value?.import ?? value?.default
      if (target && !key.includes('*')) peers.set(pkg.name + (key === '.' ? '' : key.slice(1)), pathToFileURL(resolve(folder, target)).href)
    }
  }
}
await collect(resolve(harness, 'packages')); await collect(resolve(harness, 'vendor'))
const hook = registerHooks({ resolve(specifier, context, next) { return next(peers.get(specifier) ?? specifier, context) } })
const [{ Context }, { default: Registry }, { default: Gateway }, { default: Tools }, { default: Prompt }, mcp] = await Promise.all([
  import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-typert-registry'), import('@deepseek-ai/dsh-api-gateway'),
  import('@deepseek-ai/dsh-tools'), import('@deepseek-ai/dsh-system-prompt'), import(pathToFileURL(resolve(root, 'lib/mcp.js'))),
])
const ctx = new Context()
try {
  await ctx.plugin(Registry); await ctx.plugin(Gateway); await ctx.plugin(Prompt); await ctx.plugin(Tools)
  await ctx.plugin({ apply(inner) {
    inner.provide('settings', { describe: () => [], mutate: async () => {} })
    inner.provide('credentials', { describe: async () => ({ configured: false, writable: false }), resolve: async () => undefined })
  } })
  const definitions = mcp.defaultMcpDefinitions()
  definitions.push({ id: 'fixture', origin: 'custom', label: 'Compiled fixture', enabled: true, transport: 'stdio', command: process.execPath,
    args: [resolve(harness, 'packages/mcp/mcp-client/tests/fixtures/toolbox-server.mjs')], credentials: [] })
  const config = { settingsEntry: 'toolbox-mcp', settingsPath: [], connectTimeoutMs: 10000, servers: { get: () => definitions.map(definition => ({ definition, revision: 1 })) }, removedBundled: { get: () => [] }, configRevision: { get: () => 1 } }
  const module = await ctx.plugin({ inject: mcp.inject, apply(inner) { mcp.apply(inner, config) } })
  const inventory = await ctx.typertGateway.invoke({ namespace: 'toolboxMcp', method: 'inventory', args: {} })
  assert.deepEqual(inventory.items.map(row => row.id), ['juyuan', 'caihui_mcp', 'playwright', 'fixture'])
  const draft = await ctx.typertGateway.invoke({ namespace: 'toolboxMcp', method: 'probeDraft', args: { request: { definition: { ...definitions.at(-1), id: 'unsaved-fixture', connectTimeout: 15, toolTimeout: 30 } } }, signal: new AbortController().signal })
  assert.deepEqual(draft, { ok: true, toolCount: 2 })
  assert.equal((await ctx.toolboxMcp.inventory()).items.length, 4)
  const probe = await ctx.typertGateway.invoke({ namespace: 'toolboxMcp', method: 'probe', args: { request: { id: 'fixture' } }, signal: new AbortController().signal })
  assert.equal(probe.connection, 'disconnected'); assert.equal(probe.toolCount, 2)
  await module.dispose()
  assert.equal(ctx.get('toolboxMcp'), undefined)
  assert.equal(ctx.typert.local.list().length, 0)
  console.log('Compiled MCP Host/Gateway, native stdio probe and unload smoke passed.')
} finally { await ctx.fiber.dispose(); hook.deregister() }
