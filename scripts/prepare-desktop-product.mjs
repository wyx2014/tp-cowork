/** Build and pack product bundles after the harness and its target runtime have been prepared. */
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { harnessRoot, productRoot, runCommand } from './package-command.mjs'
import { stageCoreBundle } from './stage-core-bundle.mjs'
import { prepareLinuxDesktopUtilities } from './prepare-linux-desktop-utilities.mjs'
import { resolveDesktopTargetBuildPaths } from '../../deepseek-harness/apps/desktop/scripts/desktop-build-paths.mjs'

const product = JSON.parse(await readFile(process.env.DSH_DESKTOP_PRODUCT_CONFIG ?? join(productRoot, 'desktop-product.json'), 'utf8'))
const packages = resolve(productRoot, product.packages)
if (!['product', 'linux'].some(name => packages === join(productRoot, '.desktop-build', name, 'packages'))) {
  throw new Error('Unexpected product package staging directory')
}
const staging = dirname(packages)
await rm(staging, { recursive: true, force: true })
await mkdir(packages, { recursive: true })
const env = { ...process.env, TPCOWORK_PACKAGED_PYTHON_SOURCE: join(resolveDesktopTargetBuildPaths().runtime, 'primary-runtime/dependencies/python') }
// Recreate the selected native payload so a cached build cannot mix browser and utility variants.
await rm(join(harnessRoot, 'apps/desktop/lib/tpcowork-browser'), { recursive: true, force: true })
for (const [directory, buildArgs] of [
  ['tpcowork-ui', ['build.mjs']], ['tpcowork-browser', ['build.mjs', '--install-native']],
  ['tpcowork-toolbox', ['build.mjs', '--install-native']], ['tpcowork-automation', ['build.mjs']], ['tpcowork-memory', ['build.mjs']], ['tpcowork-archives', ['build.mjs']], ['tpcowork-usage', ['build.mjs']], ['tpcowork-diagnostics', ['build.mjs']], ['tpcowork-computer-use', ['build.mjs']], ['tpcowork-experts', ['build.mjs']],
]) {
  if (!product.bundles.includes(directory.replace('tpcowork-', '@tpcowork/dsh-'))) continue
  const cwd = join(productRoot, 'plugins', directory)
  if (directory === 'tpcowork-browser') await runCommand('npm', ['ci', '--legacy-peer-deps', '--no-audit', '--no-fund'], { cwd, env })
  await runCommand(process.execPath, buildArgs, { cwd, env })
}
if (!product.bundles.includes('@tpcowork/dsh-browser') && product.bundles.includes('@tpcowork/dsh-diagnostics')) {
  await prepareLinuxDesktopUtilities()
}
await runCommand(process.execPath, [join(productRoot, 'scripts/prepare-toolbox-runtime.mjs'), '--download'], { env })
// Exercise the compiled services with fresh and existing profiles before creating the installer.
await runCommand(process.execPath, [join(productRoot, 'plugins/tpcowork-toolbox/tests/bootstrap-artifact-smoke.mjs')], { env })

// Build deployment defaults in staging; local credentials and generated files stay in their source directory.
const coreSource = join(productRoot, 'plugins/tpcowork-core')
const coreStage = join(staging, 'core')
await stageCoreBundle(coreSource, coreStage, env)
for (const name of product.bundles) {
  const directory = name === '@tpcowork/dsh-core' ? coreStage : join(productRoot, 'plugins', name.replace('@tpcowork/dsh-', 'tpcowork-'))
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== name || !manifest.dsh?.bundle?.patch) throw new Error(`TP Cowork: missing bundle ${name}`)
  await runCommand('npm', ['pack', '--ignore-scripts', '--pack-destination', packages], { cwd: directory, env })
}
console.log(`TP Cowork: packed ${product.bundles.length} product bundles for the installer`)
