/** A fresh profile boots the shipped Host, templates and launcher, including after an offline tgz install. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { artifactPeers } from './artifact-peers.mjs'
const root = process.env.TOOLBOX_PACKAGE_ROOT ?? fileURLToPath(new URL('../', import.meta.url))
const expertsRoot = process.env.EXPERTS_PACKAGE_ROOT ?? fileURLToPath(new URL('../../tpcowork-experts/', import.meta.url))
const hook = await artifactPeers()
const [{ boot, initProfile, readProfilePatches }, { default: Editor }, { default: Settings }, { default: Typert }, { default: Gateway }, { default: Skills }, { default: Tools }, { default: Prompt }, toolbox] = await Promise.all([
  import('@deepseek-ai/dsh-app-boot'), import('@deepseek-ai/dsh-config-editor'), import('@deepseek-ai/dsh-settings'), import('@deepseek-ai/dsh-typert-registry'),
  import('@deepseek-ai/dsh-api-gateway'), import('@deepseek-ai/dsh-skill'), import('@deepseek-ai/dsh-tools'), import('@deepseek-ai/dsh-system-prompt'), import(pathToFileURL(resolve(root, 'lib/host.js'))),
])
const home = await realpath(await mkdtemp(join(tmpdir(), 'toolbox-release-')))
const [Sessions, Agents, Projections, Fs, Directory, experts] = await Promise.all([
  import('@deepseek-ai/dsh-session'), import('@deepseek-ai/dsh-agent'), import('@deepseek-ai/dsh-session-projection'),
  import('@deepseek-ai/dsh-fs-local'), import('@deepseek-ai/dsh-working-directory'), import(pathToFileURL(resolve(expertsRoot, 'lib/host.js'))),
])
const dir = join(home, 'profiles/test')
const contexts = []
try {
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules/test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}\n')
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' }, { id: 'typert', name: 'cordis:typert' },
    { id: 'gateway', name: 'cordis:gateway' }, { id: 'skills', name: 'cordis:skills' }, { id: 'tools', name: 'cordis:tools' },
    { id: 'prompt', name: 'cordis:prompt' }, { id: 'credentials', name: 'cordis:credentials' },
    { id: 'sessions', name: 'cordis:sessions' }, { id: 'agents', name: 'cordis:agents' }, { id: 'projections', name: 'cordis:projections' },
    { id: 'fs', name: 'cordis:fs' }, { id: 'directory', name: 'cordis:directory' },
    { id: 'experts', name: 'cordis:experts' }, { id: 'tpcowork-toolbox', name: 'cordis:toolbox', config: { skills: { userRoot: join(dir, 'skills') }, tpcoworkhub: { endpoint: '' } } },
  ] }]))
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
  async function start() {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
      ctx.provide('profileContext', profile)
      Object.assign(ctx.loader.builtins, { editor: Editor, settings: Settings, typert: Typert, gateway: Gateway, skills: Skills, tools: Tools, prompt: Prompt, toolbox,
        sessions: Sessions.default, agents: Agents.default, projections: Projections.default, fs: Fs.default, directory: Directory.default, experts,
        credentials: { apply(inner) {
          const credentials = new Map()
          inner.provide('credentials', {
            describe: async ref => ({ configured: credentials.has(ref), writable: true }),
            resolve: async ref => credentials.has(ref) ? { value: credentials.get(ref), source: 'test' } : undefined,
            set: async (ref, value) => { credentials.set(ref, value) },
          })
          // Discovery only; the native workflow/AgentLoop execution is exercised by experts tests.
          inner.provide('sessionController', { inspect: async () => ({ events: [] }) })
          inner.provide('workflowEngine', {})
          inner.provide('subagents', { getProvider: () => undefined })
        } },
      })
    })
    contexts.push(ctx)
    const ready = Promise.withResolvers()
    ctx.inject(['toolboxMcp', 'toolboxTpcoworkHub', 'toolboxTasks'], () => { ready.resolve() })
    const timeout = setTimeout(() => ready.reject(new Error('toolbox/default-initialization-timeout')), 30000)
    try { await ready.promise } finally { clearTimeout(timeout) }
    return ctx
  }
  const ctx = await start()
  assert.deepEqual((await ctx.toolbox.describe()).modules, { skills: true, installer: true, mcp: true, teams: true, tpcoworkhub: true })
  assert.equal((await ctx.toolboxTpcoworkHub.account()).state, 'unconfigured')
  const teams = await ctx.typertGateway.invoke({ namespace: 'toolboxTeams', method: 'inventory', args: {} })
  assert.deepEqual(teams.items.map(item => item.id), ['asset-research-team', 'supply-chain-bottleneck-team'])
  assert.ok(teams.items.every(item => item.readiness.state === 'blocked'))
  const items = (await ctx.toolboxSkills.inventory({})).items
  const bundledNames = (await readdir(resolve(root, 'resources/skills'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  assert.deepEqual(items.map(item => item.name).sort(), bundledNames)
  for (const name of ['office-documents', 'xlsx', 'portfolio-analysis', 'corporate-ppt', 'docx', 'pdf', 'writing-plans', 'write-article', 'weekly-report', 'long-goal', 'memory', 'my', 'weather', 'cron', 'create-skill']) assert.ok(!items.some(item => item.name === name))
  assert.ok(items.some(item => item.name === 'skill-creator' && item.origin === 'bundled'))
  for (const path of ['skill-creator/SKILL.md', 'skill-creator/scripts/quick_validate.py', 'skill-creator/references/gui-authoring.md']) {
    assert.deepEqual(await readFile(join(dir, 'skills', path)), await readFile(resolve(root, 'resources/skills', path)))
  }
  const management = await import(pathToFileURL(resolve(root, 'lib/skills.js')))
  assert.equal(typeof management.requireInstaller(ctx).install, 'function')
  assert.equal(ctx.tools.schemas().filter(item => item.name.startsWith('mcp__')).length, 0)
  const mcp = await ctx.toolboxMcp.inventory()
  assert.deepEqual(mcp.items.map(item => item.id), ['juyuan', 'caihui_mcp', 'playwright'])
  for (const id of ['juyuan', 'caihui_mcp']) assert.ok(mcp.items.find(item => item.id === id).readiness.reasons.some(reason => reason.code === 'needs_configuration'))
  const patch = await readFile(profile.patchPath, 'utf8')
  await ctx.fiber.dispose()
  const restored = await start()
  assert.equal(await readFile(profile.patchPath, 'utf8'), patch)
  assert.deepEqual((await restored.toolboxSkills.inventory({})).items.map(item => item.name).sort(), bundledNames)
  console.log(`Compiled toolbox + experts: TpcoworkHub, two teams, ${bundledNames.length} complete skills, 3 credential references, no global MCP, unchanged restart passed.`)
} finally {
  for (const ctx of contexts) await ctx.fiber.dispose()
  await rm(home, { recursive: true, force: true }); hook.deregister()
}
