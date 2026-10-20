/** Run with the packaged Electron executable to inspect ASAR files and execute the bundled Python. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const resources = process.argv[2]
if (!resources) throw new Error('TP Cowork: packaged resources directory is required')
const runtime = join(resources, 'app.asar/dsh')
const product = JSON.parse(readFileSync(join(runtime, 'desktop-product.json'), 'utf8'))
const expected = JSON.parse(readFileSync(new URL('../desktop-product.json', import.meta.url), 'utf8'))
assert.deepEqual(product.bundles, expected.bundles)
for (const name of product.bundles) {
  const directory = join(runtime, 'node_modules', name)
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  assert.equal(manifest.name, name)
  const patches = manifest.dsh.bundle.patch
  for (const patch of Array.isArray(patches) ? patches : [patches]) readFileSync(join(directory, patch))
}
const anchor = join(runtime, 'node_modules/@deepseek-ai/dsh/package.json')
const requireRuntime = createRequire(anchor)
const { initProfile, loadProfileDirectory, PROFILE_TEMPLATES } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-app-boot')))
const profile = mkdtempSync(join(tmpdir(), 'tp-bundles-'))
try {
  initProfile(profile, [...PROFILE_TEMPLATES.web.bundles, ...product.bundles])
  const loaded = loadProfileDirectory('dsh', profile, anchor)
  console.log('Installed product skipped bundles:', JSON.stringify(loaded.skippedBundles))
  assert.deepEqual(loaded.skippedBundles, [], 'Installed runtime cannot load its profile bundles')
  for (const name of product.bundles) assert.ok(loaded.layers.some(layer => layer.packageName === name), `Profile omits ${name}`)
} finally { rmSync(profile, { recursive: true, force: true }) }
const core = JSON.parse(readFileSync(join(runtime, 'node_modules/@tpcowork/dsh-core/deployment.local.json'), 'utf8'))
assert.equal(core.apiKey, undefined, 'Product package must not embed a developer API key')
const toolbox = join(runtime, 'node_modules/@tpcowork/dsh-toolbox')
const browser = JSON.parse(readFileSync(join(toolbox, 'runtime/playwright.json'), 'utf8'))
assert.equal(browser.platform, 'win32')
assert.equal(browser.arch, 'x64')
assert.equal(createHash('sha256').update(readFileSync(join(toolbox, 'runtime', browser.archive))).digest('hex'), browser.archiveSha256)
const python = join(resources, 'app.asar.unpacked/dsh/node_modules/@tpcowork/dsh-toolbox/runtime/python/python.exe')
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/iu.test(name)))
execFileSync(python, ['-I', '-B', '-c', 'import pptx,docx,PIL,yaml; print("Installed product Python ready")'], {
  env: { ...env, PATH: '', PYTHONPATH: '', PYTHONHOME: '' }, stdio: 'inherit', windowsHide: true, timeout: 60_000,
})
console.log(`TP Cowork: ${product.bundles.length} installed bundles, browser archive and offline Python verified`)
