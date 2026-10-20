import { artifactPeers } from './artifact-peers.mjs'
// Exercise compiled outputs with real local DSH peers; no user profile writes or external connections.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = resolve(root, '../../../deepseek-harness')
// Linked desktop installs resolve only declared peers, unlike the broad test resolver.
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }))
for (const file of await readdir(resolve(root, 'lib'))) {
  if (!file.endsWith('.js')) continue
  const code = await readFile(resolve(root, 'lib', file), 'utf8')
  for (const match of code.matchAll(/from ["'](@deepseek-ai\/[^"']+)["']/g)) {
    const name = match[1].split('/').slice(0, 2).join('/')
    assert.ok(declared.has(name), `undeclared Host peer in ${file}: ${name}`)
  }
}
const hook = await artifactPeers()
const [{ Context }, { default: Registry }, { default: Gateway }, host] = await Promise.all([
  import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-typert-registry'), import('@deepseek-ai/dsh-api-gateway'), import(pathToFileURL(resolve(root, 'lib/host.js'))),
])
const ctx = new Context()
try {
  await ctx.plugin(Registry); await ctx.plugin(Gateway)
  const plugin = await ctx.plugin(host)
  const result = await ctx.typertGateway.invoke({ namespace: 'toolbox', method: 'describe', args: {} })
  assert.deepEqual(result.defaultMcpIds, ['juyuan', 'caihui_mcp', 'playwright'])
  let registration
  runInNewContext(await readFile(resolve(root, 'lib/client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { registration = value } } },
    TextEncoder, TextDecoder, AbortController, structuredClone,
  })
  assert.equal(registration.id, '@tpcowork/dsh-toolbox')
  const requireReact = createRequire(resolve(harness, 'packages/client/ui-schedule/package.json'))
  const baseline = new Set(['@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-primitives'])
  const client = registration.factory(name => {
    if (name === 'react') return requireReact(name)
    assert.ok(baseline.has(name), `unexpected Client runtime dependency: ${name}`)
    // This facade smoke does not mount UI; ui-components covers the real shared primitives.
    return {}
  })
  assert.deepEqual(JSON.parse(JSON.stringify(await client.createClient({ describe: async () => ({ ok: true, value: result }) }).describe())), result)
  await plugin.dispose()
  assert.equal(ctx.get('toolbox'), undefined)
  assert.equal(ctx.typert.local.list().length, 0)
  const stepSearch = await import(pathToFileURL(resolve(root, 'lib/web-search-step.js')))
  assert.equal(stepSearch.name, 'tpcowork-web-search-step')
  assert.deepEqual(stepSearch.inject, ['web', 'credentials'])
  console.log('Compiled Host Gateway and browser ModuleLoader smoke passed.')
} finally { await ctx.fiber.dispose(); hook.deregister() }
