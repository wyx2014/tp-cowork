/** Product entry point matching nanobot-gui: npm ci, npm run build:win, dist/installers. */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { harnessRoot, npmCli, productRoot, runCommand } from './package-command.mjs'
import { withStagedWindowsApplication } from './stage-windows-smoke.mjs'
import { desktopBuildVersionPrefix, validateDesktopBuildVersion } from '../../deepseek-harness/apps/desktop/scripts/desktop-build-version.mjs'

/** Number an unpublished CI artifact without an update server or signing credentials. */
export function standaloneBuildVersion(environment, productVersion, now = new Date()) {
  const requested = environment.PACKAGE_BUILD_VERSION?.trim() || productVersion
  if (requested !== 'auto') return validateDesktopBuildVersion(requested, productVersion)
  for (const name of ['GITHUB_RUN_NUMBER', 'GITHUB_RUN_ATTEMPT']) {
    if (!/^[1-9]\d*$/u.test(environment[name] ?? '')) throw new Error(`${name} must be a positive integer for auto builds`)
  }
  const date = now.toISOString().slice(0, 10).replaceAll('-', '')
  return validateDesktopBuildVersion(`${desktopBuildVersionPrefix(productVersion)}${date}.${environment.GITHUB_RUN_NUMBER}.${environment.GITHUB_RUN_ATTEMPT}`, productVersion)
}

/** Copy only this successful run's installers and record their source revisions and SHA-256. */
export async function collectWindowsInstallers(source, output, revisions) {
  const names = (await readdir(source)).filter(name => name.endsWith('.exe')).sort()
  if (names.length !== 1) throw new Error(`TP Cowork: expected one verified installer, found ${names.length}`)
  await mkdir(output, { recursive: true })
  for (const name of names) {
    const bytes = await readFile(join(source, name))
    await copyFile(join(source, name), join(output, name))
    await writeFile(join(output, `${name}.sha256`), `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`)
  }
  await writeFile(join(output, 'build-info.json'), JSON.stringify({ schemaVersion: 1, ...revisions, installers: names }, null, 2) + '\n')
  return names
}

/** Build on a Windows x64 host; Mac users run the same entry point on GitHub Actions. */
export async function buildWindows(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv.filter(value => value !== '--'), options: {
    check: { type: 'boolean', default: false }, plan: { type: 'boolean', default: false }, 'build-version': { type: 'string' },
  } })
  const productConfig = join(productRoot, 'desktop-product.json')
  const product = JSON.parse(await readFile(productConfig, 'utf8'))
  if (values.plan) {
    console.log(JSON.stringify({ product: product.productName, harness: '../deepseek-harness', bundles: product.bundles,
      steps: ['Install locked harness dependencies', 'Build harness', 'Build and pack product plugins and offline dependencies',
        'Materialize and verify bundled runtime', 'Build NSIS EXE and smoke packaged runtime', 'Collect installer and checksum'],
      output: 'dist/installers', requires: 'Windows x64, Node.js 24, Visual Studio C++ build tools and Windows SDK' }, null, 2))
    return
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('TP Cowork: Windows 打包需要 Windows x64。macOS 请在 GitHub Actions 运行 Build Windows Installer；可加 --plan 查看构建步骤。')
  }
  const prepareSettings = join(harnessRoot, 'apps/desktop/scripts/prepare-windows-ci.mjs')
  if (!existsSync(prepareSettings)) throw new Error('TP Cowork: deepseek-harness is missing; check out the harness fork beside the product directory first')
  const env = { ...process.env, TPCOWORK_NPM_CLI: npmCli(), DSH_TELEMETRY_DISABLED: '1' }
  const deployment = env.PACKAGE_DEPLOYMENT ?? 'standalone'
  if (!['standalone', 'test', 'production'].includes(deployment)) throw new Error('TP Cowork: unsupported PACKAGE_DEPLOYMENT')
  const standalone = deployment === 'standalone'
  await runCommand(process.execPath, [join(productRoot, 'scripts/check-worktree.mjs')], { env })
  const settingsFile = join(harnessRoot, 'apps/desktop/.env.windows')
  let ownsSettings = false
  let version = values['build-version'] ?? env.PACKAGE_BUILD_VERSION
  try {
    const nativePackage = JSON.parse(await readFile(join(harnessRoot, 'apps/desktop/package.json'), 'utf8'))
    if (standalone) {
      version = standaloneBuildVersion({ ...env, PACKAGE_BUILD_VERSION: version ?? (env.GITHUB_RUN_NUMBER ? 'auto' : nativePackage.version) }, nativePackage.version)
    } else if (!existsSync(settingsFile)) {
      const { windowsCiSettings } = await import(pathToFileURL(prepareSettings))
      const prepared = windowsCiSettings({ ...env, PACKAGE_BUILD_VERSION: version ?? (env.GITHUB_RUN_NUMBER ? 'auto' : nativePackage.version) }, nativePackage.version)
      await writeFile(settingsFile, prepared.settings, { flag: 'wx', mode: 0o600 })
      ownsSettings = true
      version = prepared.version
    }
    await runCommand('pnpm', ['install', '--frozen-lockfile'], { cwd: harnessRoot, env })
    const args = ['run', 'package:desktop:win:x64:unsigned', '--product', productConfig,
      ...(standalone ? ['--standalone'] : []),
      ...(version ? ['--build-version', version] : []), ...(values.check ? ['--check'] : [])]
    const output = join(productRoot, 'dist/installers')
    if (!values.check) {
      await rm(output, { recursive: true, force: true })
      // Previous native artifacts must not be mistaken for the output of this run.
      await rm(join(harnessRoot, 'apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts'), { recursive: true, force: true })
    }
    await runCommand('pnpm', args, { cwd: harnessRoot, env })
    if (values.check) return
    const application = join(harnessRoot, 'apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/win-unpacked')
    // Python extension DLLs cannot reliably load from the deeply nested CI output path.
    await withStagedWindowsApplication(application, staged => runCommand(join(staged, `${product.productName}.exe`),
      ['--expose-internals', join(productRoot, 'scripts/smoke-windows-product.mjs'), join(staged, 'resources')], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }))
    const revision = async cwd => (await runCommand('git', ['rev-parse', 'HEAD'], { cwd, env, capture: true })).trim()
    const revisions = { productCommit: await revision(productRoot), harnessCommit: await revision(harnessRoot), deployment, unsigned: true }
    const names = await collectWindowsInstallers(join(harnessRoot, 'apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts'), output, revisions)
    console.log(`TP Cowork: ${join(output, names[0])}`)
  } finally {
    if (ownsSettings) await rm(settingsFile, { force: true })
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await buildWindows().catch(error => { console.error(error.message); process.exitCode = 1 })
}
