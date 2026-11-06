/** Check the installed Basic runtime and its real default-profile resolution without product plugins. */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const resources = process.argv[2]
if (!resources) throw new Error('Basic runtime resources directory is required')
const runtime = join(resources, 'app.asar/dsh')
const productFile = join(runtime, 'desktop-product.json')
if (existsSync(productFile)) assert.deepEqual(JSON.parse(readFileSync(productFile, 'utf8')).bundles, [])
const scope = join(runtime, 'node_modules/@tpcowork')
assert.deepEqual(existsSync(scope) ? readdirSync(scope) : [], [], 'Basic must not ship any TP Cowork plugins')
for (const name of ['tpcowork-browser', 'tpcoworkhub']) {
  assert.equal(existsSync(join(resources, 'app.asar/lib', name)), false, `Basic must not ship ${name} native payload`)
}
const anchor = join(runtime, 'package.json')
const requireRuntime = createRequire(anchor)
const { createRuntimeResolution, initProfile, loadProfileDirectory, PROFILE_TEMPLATES } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-app-boot')))
const profile = mkdtempSync(join(tmpdir(), 'tp-basic-profile-'))
try {
  initProfile(profile, PROFILE_TEMPLATES.web.bundles)
  const loaded = loadProfileDirectory('dsh', profile, anchor)
  assert.deepEqual(loaded.skippedBundles, [], 'Basic default profile must resolve its bundles')
  const resolution = await createRuntimeResolution({ installAnchor: anchor, profile: loaded, home: profile })
  assert.equal(resolution.entries.some(entry => entry.name.startsWith('@tpcowork/')), false)
  console.log('TP Cowork Basic: default profile resolves; no product plugins or native adapters installed')
} finally { rmSync(profile, { recursive: true, force: true }) }
