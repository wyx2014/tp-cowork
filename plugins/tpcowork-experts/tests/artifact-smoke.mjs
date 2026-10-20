/** Built Host/Gateway and browser ModuleLoader smoke; execution has its real Loader suite. */
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = process.env.EXPERTS_PACKAGE_ROOT ?? sourceRoot
const harness = resolve(sourceRoot, '../../../deepseek-harness')
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
const [{ Context }, Registry, Gateway, Sessions, Agents, Projections, Tools, Prompt, Fs, Directory, Controller, host, teams] = await Promise.all([
  import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-typert-registry'), import('@deepseek-ai/dsh-api-gateway'),
  import('@deepseek-ai/dsh-session'), import('@deepseek-ai/dsh-agent'), import('@deepseek-ai/dsh-session-projection'),
  import('@deepseek-ai/dsh-tools'), import('@deepseek-ai/dsh-system-prompt'), import('@deepseek-ai/dsh-fs-local'), import('@deepseek-ai/dsh-working-directory'), import('@deepseek-ai/dsh-api-session-controller'),
  import(pathToFileURL(resolve(root, 'lib/host.js'))), import(pathToFileURL(resolve(root, 'lib/teams.js'))),
])
assert.equal(typeof Controller.SessionController.prototype.promptWithAdmission, 'function')
assert.equal(typeof Controller.SessionController.prototype.modelSelectionForStep, 'function')
const ctx = new Context()
try {
  for (const module of [Registry, Gateway, Sessions, Projections, Prompt, Tools, Agents, Fs, Directory]) await ctx.plugin(module.default)
  await ctx.plugin({ apply(inner) {
    // This smoke addresses no active session or workflow; those services are never executed.
    inner.provide('sessionController', { inspect: async () => ({ events: [] }) })
    inner.provide('workflowEngine', {})
    inner.provide('subagents', { getProvider: () => undefined })
  } })
  const runtime = await ctx.plugin(host)
  const admission = await ctx.plugin(teams)
  const catalog = await ctx.typertGateway.invoke({ namespace: 'toolboxTeams', method: 'inventory', args: {} })
  assert.deepEqual(catalog.items.map(row => row.id), ['asset-research-team', 'supply-chain-bottleneck-team'])
  assert.ok(catalog.items.every(row => row.readiness.state === 'blocked'))
  const snapshot = await ctx.typertGateway.invoke({ namespace: 'experts', method: 'snapshot', args: { request: { sessionId: 'cold-empty' } } })
  assert.deepEqual(snapshot, { run: null, status: null })
  let registration
  runInNewContext(await readFile(resolve(root, 'lib/client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { registration = value } } }, TextEncoder, TextDecoder, AbortController, structuredClone,
  })
  assert.equal(registration.id, '@tpcowork/dsh-experts')
  const client = registration.factory(name => { throw new Error('Unexpected Client dependency: ' + name) })
  assert.equal(typeof client.apply, 'function')
  assert.equal(client.ExpertsPanel, undefined)
  let unmounted = false
  const effects = []
  await client.apply({ remote: { async $mount() { return () => { unmounted = true } } }, effect(run) { effects.push(run()) } })
  effects.forEach(dispose => dispose())
  assert.equal(unmounted, true)
  await admission.dispose(); await runtime.dispose()
  assert.equal(ctx.get('experts'), undefined)
  assert.equal(ctx.get('toolboxTasks'), undefined)
  assert.equal(ctx.sessionProjections.stateOf(Sessions.Session.create(Sessions.SessionId('probe')), 'tpcoworkExperts'), undefined)
  assert.equal(ctx.typert.local.list().length, 0)
  console.log('Compiled experts Host/Gateway, resources, Client ModuleLoader and unload smoke passed.')
} finally { await ctx.fiber.dispose(); hook.deregister() }
