// Verify independently emitted T2/T5 modules share the actual installer, credentials and Gateway.
import assert from 'node:assert/strict'
import { registerHooks, createRequire } from 'node:module'
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
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
      const target = typeof value === 'string' ? value : value?.default ?? value?.import
      if (target && !key.includes('*')) peers.set(pkg.name + (key === '.' ? '' : key.slice(1)), pathToFileURL(resolve(folder, target)).href)
    }
  }
}
await collect(resolve(harness, 'packages')); await collect(resolve(harness, 'vendor'))
const requireHarness = createRequire(resolve(harness, 'package.json'))
peers.set('zod', pathToFileURL(requireHarness.resolve('zod')).href)
const hook = registerHooks({ resolve(specifier, context, next) { return next(peers.get(specifier) ?? specifier, context) } })
const [{ Context }, { default: Typert }, { default: Gateway }, { default: Skills }, { default: Credentials }, { credentialRef }, skills, hub] = await Promise.all([
  import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-typert-registry'), import('@deepseek-ai/dsh-api-gateway'), import('@deepseek-ai/dsh-skill'),
  import('@deepseek-ai/dsh-credentials-local'), import('@deepseek-ai/dsh-credentials'), import(pathToFileURL(resolve(root, 'lib/skills.js'))), import(pathToFileURL(resolve(root, 'lib/prompthub.js'))),
])
const home = await mkdtemp(join(tmpdir(), 'toolbox-hub-built-'))
const ctx = new Context()
const bytes = Buffer.from('---\nname: compiled-hub\ndescription: Compiled protocol fixture\n---\nUse this skill.\n')
const hash = createHash('sha256').update(bytes).digest('hex')
const meta = { path: 'SKILL.md', size: bytes.length, sha256: hash, contentType: 'text/markdown' }
const server = createServer(async (req, res) => {
  for await (const _chunk of req) { /* Drain request without logging credentials. */ }
  const envelope = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code: 200, data })) }
  if (req.url === '/api/users/login') { envelope({ token: 'compiled-fixture-token', user: { id: 'fixture', username: 'fixture' } }); return }
  if (req.headers.authorization !== 'Bearer compiled-fixture-token') { res.statusCode = 401; res.end(); return }
  if (req.url === '/api/skills/fixture') { envelope({ skill: { id: 'fixture', slug: 'compiled-hub' }, latestVersion: { id: 'v1', version: '1.0.0' }, files: [meta] }); return }
  if (req.url.startsWith('/api/skill-versions/files?')) { envelope({ ...meta, content: bytes.toString('utf8') }); return }
  res.statusCode = 404; res.end()
})
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  ctx.provide('profileContext', { dir: home, cwd: home, home })
  ctx.provide('settings', { describe: () => [], mutate: async () => {} })
  await ctx.plugin(Typert); await ctx.plugin(Gateway); await ctx.plugin(Skills)
  await ctx.plugin(Credentials, { path: join(home, '.credentials.yaml'), watch: false })
  await ctx.credentials.set(credentialRef('FIXTURE_PASSWORD'), 'compiled-fixture-password')
  await ctx.plugin(skills, { userRoot: join(home, 'user-skills') })
  const module = await ctx.plugin(hub, { endpoint: `http://127.0.0.1:${server.address().port}` })
  await ctx.typertGateway.invoke({ namespace: 'toolboxPromptHub', method: 'login', args: { request: { username: 'fixture', passwordRef: 'FIXTURE_PASSWORD' } } })
  const detail = await ctx.typertGateway.invoke({ namespace: 'toolboxPromptHub', method: 'detail', args: { request: { id: 'fixture' } } })
  const result = await ctx.typertGateway.invoke({ namespace: 'toolboxPromptHub', method: 'install', args: { request: { requestId: 'compiled', source: { kind: 'prompthub', skillId: 'fixture', versionId: 'v1', fingerprint: detail.fingerprint }, scope: { kind: 'user' }, conflict: 'reject' } } })
  assert.equal(result.state, 'installed')
  assert.equal((await ctx.skills.get('compiled-hub')).content, 'Use this skill.')
  assert.equal((await ctx.toolboxSkills.inventory({})).items[0].origin, 'prompthub')
  await module.dispose()
  assert.equal(ctx.get('toolboxPromptHub'), undefined)
  const missing = await ctx.toolboxInstaller.install({ requestId: 'unloaded', source: { kind: 'prompthub', skillId: 'fixture', versionId: 'v1', fingerprint: detail.fingerprint }, scope: { kind: 'user' }, conflict: 'reject' })
  assert.equal(missing.error.code, 'skills/source-unavailable')
  console.log('Compiled PromptHub/T2 installer, DSH credentials, HTTP login/download, Gateway and unload smoke passed.')
} finally {
  await ctx.fiber.dispose()
  server.closeAllConnections(); await new Promise(done => server.close(done))
  hook.deregister(); await rm(home, { recursive: true, force: true })
}
