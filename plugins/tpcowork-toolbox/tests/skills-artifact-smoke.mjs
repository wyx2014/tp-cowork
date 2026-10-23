// Boot compiled peers and the compiled skills module through the actual profile Loader.
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { readFile, readdir, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
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
      const target = typeof value === 'string' ? value : value?.default ?? value?.import
      if (target && !key.includes('*')) peers.set(pkg.name + (key === '.' ? '' : key.slice(1)), pathToFileURL(resolve(folder, target)).href)
    }
  }
}
await collect(resolve(harness, 'packages')); await collect(resolve(harness, 'vendor'))
const hook = registerHooks({ resolve(specifier, context, next) { return next(peers.get(specifier) ?? specifier, context) } })
const [{ boot, initProfile, readProfilePatches }, { default: Editor }, { default: Settings }, { default: Typert }, { default: Gateway }, { default: Skills }, module] = await Promise.all([
  import('@deepseek-ai/dsh-app-boot'), import('@deepseek-ai/dsh-config-editor'), import('@deepseek-ai/dsh-settings'), import('@deepseek-ai/dsh-typert-registry'), import('@deepseek-ai/dsh-api-gateway'), import('@deepseek-ai/dsh-skill'), import(pathToFileURL(resolve(root, 'lib/skills.js'))),
])
const home = await mkdtemp(join(tmpdir(), 'toolbox-skills-built-'))
let ctx
try {
  const dir = join(home, 'profiles/test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules/test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"smoke"}')
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' }, { id: 'typert', name: 'cordis:typert' },
    { id: 'gateway', name: 'cordis:gateway' }, { id: 'skills', name: 'cordis:skills' }, { id: 'toolbox-skills', name: 'cordis:toolbox', config: { userRoot: join(dir, 'skills') } },
  ] }]))
  await writeFile(join(dir, 'cordis.yml'), '[]')
  const profile = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
  ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
    ctx.provide('profileContext', profile)
    Object.assign(ctx.loader.builtins, { editor: Editor, settings: Settings, typert: Typert, gateway: Gateway, skills: Skills, toolbox: module })
  })
  const installed = await ctx.typertGateway.invoke({ namespace: 'toolboxInstaller', method: 'install', args: { request: { requestId: 'built', source: { kind: 'bundled', resourceId: 'brainstorming' }, scope: { kind: 'user' }, conflict: 'reject' } } })
  assert.equal(installed.state, 'installed')
  const catalog = await ctx.toolboxSkills.inventory({})
  assert.equal(catalog.items[0].origin, 'bundled')
  await ctx.toolboxSkills.setEnabled({ id: installed.skillId, enabled: false, expectedRevision: catalog.revision })
  assert.equal(await ctx.skills.get('brainstorming'), undefined)
  assert.deepEqual(await ctx.skills.list(), [])
  const { zipSync } = createRequire(join(harness, 'package.json'))('fflate')
  const zip = zipSync({
    'skillhub-sample/SKILL.md': Buffer.from('---\nname: skillhub-sample\ndescription: ZIP import smoke\n---\nRead [data](references/data.bin).\n'),
    'skillhub-sample/references/data.bin': new Uint8Array([0, 128, 255]),
    'skillhub-sample/_meta.json': Buffer.from('{"slug":"skillhub-sample"}'),
  })
  const prepared = await ctx.typertGateway.invoke({ namespace: 'toolboxInstaller', method: 'prepareArchive', args: { request: { contentBase64: Buffer.from(zip).toString('base64') } } })
  assert.equal(prepared.name, 'skillhub-sample')
  const imported = await ctx.typertGateway.invoke({ namespace: 'toolboxInstaller', method: 'install', args: { request: { requestId: 'zip-built', source: { kind: 'local', importId: prepared.importId }, scope: { kind: 'user' }, conflict: 'reject' } } })
  assert.equal(imported.state, 'installed')
  assert.deepEqual(await readFile(join(dir, 'skills/skillhub-sample/references/data.bin')), Buffer.from([0, 128, 255]))
  assert.match((await ctx.skills.get('skillhub-sample')).content, /references\/data.bin/)
  console.log('Compiled profile Loader, Gateway ZIP import, binary resources, native settings and loader-disable smoke passed.')
} finally { await ctx?.fiber.dispose(); hook.deregister(); await rm(home, { recursive: true, force: true }) }
