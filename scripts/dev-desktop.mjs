/** Launch existing local artifacts; prepare or rebuild them only when needed. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { harnessRoot, productRoot, runCommand } from './package-command.mjs'

/** A git-tracked checkout's current content: the commit plus any uncommitted or untracked edits within `scope`.
 * `exclude` is always left out, even if a checkout's own .gitignore doesn't (yet) cover it — this is how the
 * fingerprint file itself, which lives inside the harness checkout, avoids reporting itself as a pending change. */
function gitFingerprint(repository, scope = [], exclude = []) {
  try {
    const head = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const status = execFileSync('git', ['-C', repository, 'status', '--porcelain=v1', '--', ...scope, ...exclude.map(path => `:!${path}`)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return createHash('sha256').update(head).update('\0').update(status).digest('hex')
  } catch { return undefined } // not a git checkout (or git unavailable): staleness falls back to missing-artifact detection
}

function missingDependencies(directory, sections) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  return sections.some(section => Object.keys(manifest[section] ?? {})
    .some(name => !existsSync(join(directory, 'node_modules', name, 'package.json'))))
}

const pluginNames = ['core', 'ui', 'workbench', 'browser', 'toolbox', 'automation', 'experts']
const builtPlugins = pluginNames.filter(name => name !== 'workbench')
const harnessArtifacts = ['apps/desktop/lib/main.js', 'apps/desktop/lib/types/project-manager.js',
  'apps/desktop-host/lib/index.js', 'apps/cli/lib/bin.js', 'apps/web/dist/index.html']

function electronReady(harness) {
  const directory = join(harness, 'apps/desktop/node_modules/electron')
  if (!existsSync(join(directory, 'path.txt'))) return false
  return existsSync(join(directory, 'dist', readFileSync(join(directory, 'path.txt'), 'utf8').trim()))
}

function pluginsReady(product, harness) {
  const artifacts = ['tpcowork-core/model.js', 'tpcowork-ui/client.js', 'tpcowork-ui/upstream.css',
    ...['browser', 'toolbox', 'automation', 'experts'].flatMap(name =>
      [`tpcowork-${name}/lib/host.js`, `tpcowork-${name}/lib/client.js`])]
  return artifacts.every(file => existsSync(join(product, 'plugins', file)))
    && existsSync(join(harness, 'apps/desktop/lib/tpcowork-browser/desktop.js'))
}

function missingPluginLinks(product, profile) {
  const manifestPath = join(profile, 'package.json')
  if (!existsSync(manifestPath)) return pluginNames
  const { dependencies = {} } = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return pluginNames.filter(name => {
    const source = resolve(product, 'plugins', `tpcowork-${name}`)
    const installed = join(profile, 'node_modules', '@tpcowork', `dsh-${name}`)
    const reference = dependencies[`@tpcowork/dsh-${name}`]
    if (typeof reference !== 'string' || !reference.startsWith('link:')) return true
    const linked = resolve(profile, reference.slice('link:'.length))
    return !existsSync(linked) || !existsSync(installed)
      || realpathSync(linked) !== realpathSync(source) || realpathSync(installed) !== realpathSync(source)
  })
}

/** Keep the data paths identical to the framework's ordinary development launcher. */
export function desktopPlan({ product = productRoot, harness = harnessRoot, environment = process.env,
  rebuild = false, plugins = false } = {}) {
  if (!existsSync(join(harness, 'apps/desktop/package.json'))) {
    throw new Error('缺少桌面底座，请将 deepseek-harness 仓库放到 tp-coworkdsh 的同级目录。')
  }
  const development = join(harness, 'apps/desktop/.desktop-build/development')
  const env = {
    ...environment,
    DSH_HOME: resolve(environment.DSH_HOME || join(development, 'home')),
    DSH_DESKTOP_USER_DATA_DIR: resolve(environment.DSH_DESKTOP_USER_DATA_DIR || join(development, 'electron-user-data')),
    DSH_DESKTOP_OPEN_DEVTOOLS: environment.DSH_DESKTOP_OPEN_DEVTOOLS ?? '0',
  }
  const steps = []
  const add = (label, command, args, cwd = product) => steps.push({ label, command, args, cwd })
  const node = (label, script, args = []) => add(label, process.execPath, [join(product, script), ...args])
  if (missingDependencies(product, ['devDependencies'])) {
    add('安装产品依赖', 'npm', ['ci', '--no-audit', '--no-fund'])
  }
  // Detect edits since the last successful build from each checkout's own git state, so a single
  // `npm run dev` rebuilds whatever changed without the caller choosing --plugins or --rebuild.
  const fingerprintFile = join(development, 'build-fingerprint.json')
  const stored = (() => { try { return JSON.parse(readFileSync(fingerprintFile, 'utf8')) } catch { return {} } })()
  const fingerprints = { harness: gitFingerprint(harness, [], ['apps/desktop/.desktop-build']), plugins: gitFingerprint(product, ['plugins']) }
  // A checkout with no recorded baseline yet (first run after adopting this check) defers to the
  // existing missing-artifact checks instead of forcing a rebuild of artifacts that already exist.
  const harnessChanged = stored.harness !== undefined && fingerprints.harness !== undefined && fingerprints.harness !== stored.harness
  const pluginsChanged = stored.plugins !== undefined && fingerprints.plugins !== undefined && fingerprints.plugins !== stored.plugins
  const buildHarness = rebuild || harnessChanged || harnessArtifacts.some(file => !existsSync(join(harness, file)))
    || missingDependencies(harness, ['devDependencies'])
    || missingDependencies(join(harness, 'apps/desktop'), ['dependencies', 'devDependencies'])
  const buildPlugins = buildHarness || plugins || pluginsChanged || !pluginsReady(product, harness)
  if (buildHarness) add('准备底座依赖', 'pnpm', ['install', '--frozen-lockfile'], harness)
  if (buildHarness || !electronReady(harness)) {
    add('准备 Electron', 'pnpm', ['--filter', '@deepseek-ai/dsh-desktop', 'exec', 'node', 'node_modules/electron/install.js'], harness)
  }
  if (buildHarness) {
    node('应用 TP Cowork 品牌', 'scripts/desktop-branding.mjs')
    add('构建底座', 'pnpm', ['run', 'build', '--artifacts-only'], harness)
    add('构建桌面程序', 'pnpm', ['run', 'build:desktop'], harness)
  }
  if (buildPlugins) {
    for (const name of ['browser', 'toolbox']) {
      const directory = join(product, 'plugins', `tpcowork-${name}`)
      if (missingDependencies(directory, ['dependencies', 'devDependencies'])) {
        add(`安装 ${name} 插件依赖`, 'npm', ['ci', '--legacy-peer-deps', '--no-audit', '--no-fund'], directory)
      }
    }
    for (const name of builtPlugins) {
      node(`构建 ${name} 插件`, `plugins/tpcowork-${name}/build.mjs`, name === 'browser' ? ['--install-native'] : [])
    }
  }
  const profile = join(env.DSH_HOME, 'profiles/desktop')
  const missingLinks = missingPluginLinks(product, profile)
  if (missingLinks.length > 0) {
    // The plugin CLI needs the bundled package manager before the first launch.
    add('准备插件安装环境', 'pnpm', ['--filter', '@deepseek-ai/dsh-desktop', 'run', 'prepare:primary-runtime'], harness)
    node('初始化桌面配置', 'scripts/initialize-desktop-profile.mjs')
    if (missingLinks.length === pluginNames.length) {
      node('安装产品插件链接', 'scripts/desktop-plugin.mjs', ['install', 'all'])
    } else {
      for (const name of missingLinks) node(`修复 ${name} 插件链接`, 'scripts/desktop-plugin.mjs', ['install', name])
    }
  }
  add('启动 TP Cowork', 'pnpm', ['run', 'start:desktop',
    ...(buildHarness && missingLinks.length === 0 ? ['--rebuild-runtime'] : [])], harness)
  return { env, steps, fingerprintFile, fingerprints }
}

/** Record the checkouts' current state once they are the state actually running, so the next launch can tell what changed. */
function saveFingerprints(fingerprintFile, fingerprints) {
  const { harness, plugins } = fingerprints
  if (harness === undefined && plugins === undefined) return
  mkdirSync(join(fingerprintFile, '..'), { recursive: true })
  writeFileSync(fingerprintFile, JSON.stringify({ harness, plugins }))
}

/** Electron's singleton marker prevents rebuilding a profile used by a live desktop. */
export function assertDesktopStopped(userData, kill = process.kill) {
  let marker
  try { marker = readlinkSync(join(userData, 'SingletonLock')) }
  catch (error) {
    if (['ENOENT', 'EINVAL', 'UNKNOWN'].includes(error.code)) return
    throw error
  }
  const pid = Number(marker.match(/-(\d+)$/u)?.[1])
  if (!Number.isSafeInteger(pid) || pid <= 0) return
  try { kill(pid, 0) }
  catch (error) {
    if (error.code === 'ESRCH') return
    throw error
  }
  throw new Error('TP Cowork 已在运行，请先完整退出桌面程序，再执行 npm run dev。')
}

/** Stop on a failed build or install; launch only after all product bundles are ready. */
export async function runDesktop(options = {}, { run = runCommand, log = console.log } = {}) {
  const { env, steps, fingerprintFile, fingerprints } = desktopPlan(options)
  assertDesktopStopped(env.DSH_DESKTOP_USER_DATA_DIR)
  if (steps.length === 1) log('复用已有构建：未检测到插件或底座改动。')
  for (const [index, step] of steps.entries()) {
    if (step.label === '初始化桌面配置') assertDesktopStopped(env.DSH_DESKTOP_USER_DATA_DIR)
    log(`\n[${index + 1}/${steps.length}] ${step.label}`)
    const started = performance.now()
    try { await run(step.command, step.args, { cwd: step.cwd, env }) }
    catch (error) { throw new Error(`${step.label}失败：${error.message}`, { cause: error }) }
    if (index < steps.length - 1) log(`完成，用时 ${((performance.now() - started) / 1000).toFixed(1)} 秒`)
  }
  saveFingerprints(fingerprintFile, fingerprints)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { plan: { type: 'boolean' }, help: { type: 'boolean' },
      rebuild: { type: 'boolean' }, plugins: { type: 'boolean' } } })
    if (values.help) console.log('npm run dev           一键启动：自动检测插件或底座自上次构建以来的改动并重建，其余复用已有构建\nnpm run dev:plugins   强制重建产品插件并启动\nnpm run dev:rebuild   强制完整重建底座和插件并启动\nnpm run dev -- --plan 查看启动步骤，不执行构建或启动')
    else if (values.plan) console.log(JSON.stringify(desktopPlan(values).steps, null, 2))
    else {
      if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('本地启动需要 Node.js 24 或更新版本。')
      if (!['darwin', 'win32'].includes(process.platform)) throw new Error('本地桌面启动支持 macOS 和 Windows。')
      await runDesktop(values)
    }
  } catch (error) {
    console.error(`TP Cowork: ${error.message}`)
    process.exitCode = 1
  }
}
