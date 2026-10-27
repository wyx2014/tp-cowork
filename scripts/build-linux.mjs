/** Build standalone Linux x64 AppImage/DEB packages on a native Linux host. */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { harnessRoot, npmCli, productRoot, runCommand } from './package-command.mjs'
import { standaloneBuildVersion } from './build-windows.mjs'
import { prepareDesktopBranding } from './desktop-branding.mjs'

/** Refuse incomplete or ambiguous output so an old package cannot masquerade as this build. */
export async function linuxInstallerNames(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return ['.AppImage', '.deb'].map(extension => {
    const names = entries.filter(entry => entry.isFile() && entry.name.endsWith(extension)).map(entry => entry.name)
    if (names.length !== 1) throw new Error(`TP Cowork: expected one ${extension} package, found ${names.length}`)
    return names[0]
  })
}

/** Copy verified packages with streaming checksums and the exact source revisions. */
export async function collectLinuxInstallers(source, output, revisions) {
  const names = await linuxInstallerNames(source)
  await mkdir(output, { recursive: true })
  for (const name of names) {
    const hash = createHash('sha256')
    for await (const bytes of createReadStream(join(source, name))) hash.update(bytes)
    await copyFile(join(source, name), join(output, name))
    await writeFile(join(output, `${name}.sha256`), `${hash.digest('hex')}  ${name}\n`)
  }
  await writeFile(join(output, 'build-info.json'), JSON.stringify({ schemaVersion: 1, ...revisions, installers: names }, null, 2) + '\n')
  return names
}

/** Extract both deliverables and execute their own bundled runtime before collecting them. */
async function verifyLinuxInstallers(source, product, env) {
  const [appimage, deb] = await linuxInstallerNames(source)
  const scratch = await mkdtemp(join(tmpdir(), 'TP Cowork Linux '))
  const smoke = async application => {
    await runCommand(join(application, product.artifactPrefix), ['--expose-internals',
      join(productRoot, 'scripts/smoke-windows-product.mjs'), join(application, 'resources')], {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    })
  }
  try {
    // Extraction avoids a FUSE requirement on the hosted runner.
    await runCommand(join(source, appimage), ['--appimage-extract'], { cwd: scratch, env, capture: true })
    await smoke(join(scratch, 'squashfs-root'))
    const architecture = (await runCommand('dpkg-deb', ['--field', join(source, deb), 'Architecture'], { env, capture: true })).trim()
    if (architecture !== 'amd64') throw new Error(`TP Cowork: unexpected DEB architecture ${architecture}`)
    const packageName = (await runCommand('dpkg-deb', ['--field', join(source, deb), 'Package'], { env, capture: true })).trim()
    if (packageName !== product.artifactPrefix) throw new Error(`TP Cowork: unexpected DEB package ${packageName}`)
    const extracted = join(scratch, 'deb')
    await runCommand('dpkg-deb', ['--extract', join(source, deb), extracted], { env })
    const applications = (await readdir(join(extracted, 'opt')))
      .map(name => join(extracted, 'opt', name))
      .filter(path => existsSync(join(path, product.artifactPrefix)) && existsSync(join(path, 'resources/app.asar')))
    if (applications.length !== 1) throw new Error('TP Cowork: DEB must contain exactly one application')
    await smoke(applications[0])
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

export async function buildLinux(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv.filter(value => value !== '--'), options: {
    check: { type: 'boolean', default: false }, plan: { type: 'boolean', default: false }, 'build-version': { type: 'string' },
  } })
  const config = join(productRoot, 'desktop-product.json')
  const product = JSON.parse(await readFile(config, 'utf8'))
  if (values.plan) {
    console.log(JSON.stringify({ product: product.productName, target: 'linux-x64', runner: 'ubuntu-22.04',
      formats: ['AppImage', 'deb'], output: 'dist/installers', deployment: 'standalone',
      verification: 'Extract both packages and execute bundled Electron, product bundles and offline Python',
      compatibility: 'Kylin Desktop x86_64 requires installation and UI verification on the actual OS' }, null, 2))
    return
  }
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('TP Cowork: Linux 打包需要 Linux x64；请运行 GitHub Actions 的 Build Kylin Linux Packages。')
  if ((process.env.PACKAGE_DEPLOYMENT ?? 'standalone') !== 'standalone') throw new Error('TP Cowork: Linux currently supports standalone packaging only')
  const env = { ...process.env, TPCOWORK_NPM_CLI: npmCli(), DSH_TELEMETRY_DISABLED: '1',
    DSH_DESKTOP_PRODUCT_NAME: product.productName, DSH_DESKTOP_ARTIFACT_PREFIX: product.artifactPrefix,
    DSH_DESKTOP_HOMEPAGE: 'https://github.com/wyx2014/tp-cowork' }
  await runCommand(process.execPath, [join(productRoot, 'scripts/check-worktree.mjs')], { env })
  const native = JSON.parse(await readFile(join(harnessRoot, 'apps/desktop/package.json'), 'utf8'))
  const version = standaloneBuildVersion({ ...env, PACKAGE_BUILD_VERSION: values['build-version'] ?? env.PACKAGE_BUILD_VERSION
    ?? (env.GITHUB_RUN_NUMBER ? 'auto' : native.version) }, native.version)
  await runCommand('pnpm', ['install', '--frozen-lockfile'], { cwd: harnessRoot, env })
  if (!values.check) await prepareDesktopBranding()
  const artifacts = join(harnessRoot, 'apps/desktop/.desktop-build/targets/linux-x64/unsigned-artifacts')
  const output = join(productRoot, 'dist/installers')
  if (!values.check) {
    await rm(artifacts, { recursive: true, force: true })
    await rm(output, { recursive: true, force: true })
  }
  await runCommand('pnpm', ['run', 'package:desktop:linux:x64:unsigned', '--product', config, '--standalone',
    '--build-version', version, ...(values.check ? ['--check'] : [])], { cwd: harnessRoot, env })
  if (values.check) return
  await verifyLinuxInstallers(artifacts, product, env)
  const revision = async cwd => (await runCommand('git', ['rev-parse', 'HEAD'], { cwd, env, capture: true })).trim()
  const names = await collectLinuxInstallers(artifacts, output, {
    productCommit: await revision(productRoot), harnessCommit: await revision(harnessRoot), version,
    platform: 'linux', arch: 'x64', deployment: 'standalone', unsigned: true,
    buildHost: { platform: process.platform, arch: process.arch }, kylinMachineVerified: false,
  })
  console.log(`TP Cowork: verified Linux packages: ${names.join(', ')}`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await buildLinux().catch(error => { console.error(error.stack); process.exitCode = 1 })
}
