import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { desktopPlan, runDesktop, assertDesktopStopped } from '../dev-desktop.mjs'
import { initializeDesktopProfile } from '../initialize-desktop-profile.mjs'
import { harnessRoot, productRoot, runCommand } from '../package-command.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tp desktop dev '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = join(root, 'tp cowork')
  const harness = join(root, 'deepseek-harness')
  const manifest = async (directory, contents) => {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify(contents))
  }
  await manifest(product, { devDependencies: { pnpm: '11.28.5' } })
  await manifest(harness, {})
  await manifest(join(harness, 'apps/desktop'), {})
  for (const name of ['browser', 'toolbox']) await manifest(join(product, 'plugins', `tpcowork-${name}`), { dependencies: { dependency: '1.0.0' } })
  return { product, harness, environment: { DSH_HOME: join(root, 'custom home'), DSH_DESKTOP_USER_DATA_DIR: join(root, 'custom browser data') } }
}

async function readyFixture(t) {
  const options = await fixture(t)
  const touch = async path => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '')
  }
  await touch(join(options.product, 'node_modules/pnpm/package.json'))
  for (const file of ['apps/desktop/lib/main.js', 'apps/desktop/lib/types/project-manager.js',
    'apps/desktop-host/lib/index.js', 'apps/cli/lib/bin.js', 'apps/web/dist/index.html',
    'apps/desktop/lib/tpcowork-browser/desktop.js', 'apps/desktop/node_modules/electron/dist/electron']) {
    await touch(join(options.harness, file))
  }
  await writeFile(join(options.harness, 'apps/desktop/node_modules/electron/path.txt'), 'electron')
  const profile = join(options.environment.DSH_HOME, 'profiles/desktop')
  await mkdir(join(profile, 'node_modules/@tpcowork'), { recursive: true })
  const dependencies = {}
  for (const name of ['core', 'ui', 'workbench', 'browser', 'toolbox', 'automation', 'experts']) {
    const source = join(options.product, 'plugins', `tpcowork-${name}`)
    await mkdir(source, { recursive: true })
    await symlink(source, join(profile, 'node_modules/@tpcowork', `dsh-${name}`), process.platform === 'win32' ? 'junction' : 'dir')
    dependencies[`@tpcowork/dsh-${name}`] = `link:${source}`
  }
  for (const file of ['tpcowork-core/model.js', 'tpcowork-ui/client.js', 'tpcowork-ui/upstream.css',
    ...['browser', 'toolbox', 'automation', 'experts'].flatMap(name => [`tpcowork-${name}/lib/host.js`, `tpcowork-${name}/lib/client.js`])]) {
    await touch(join(options.product, 'plugins', file))
  }
  // An intentionally disabled bundle must not be re-enabled by ordinary startup or rebuild.
  await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies, dsh: { profile: { bundles: [] } } }))
  return options
}

test('one command builds, initializes, installs and launches in order, preserving paths with spaces', async t => {
  const options = await fixture(t)
  const calls = []
  await runDesktop(options, { run: async (command, args, context) => calls.push({ command, args, ...context }), log: () => {} })
  const find = (...args) => calls.findIndex(call => JSON.stringify(call.args) === JSON.stringify(args))
  const brand = find(join(options.product, 'scripts/desktop-branding.mjs'))
  const build = find('run', 'build', '--artifacts-only')
  const init = find(join(options.product, 'scripts/initialize-desktop-profile.mjs'))
  const install = find(join(options.product, 'scripts/desktop-plugin.mjs'), 'install', 'all')
  const launch = find('run', 'start:desktop')
  assert.ok(brand >= 0 && build > brand && init > build && install > init && launch > install)
  assert.equal(launch, calls.length - 1)
  for (const name of ['core', 'ui', 'toolbox', 'automation', 'experts']) assert.ok(find(join(options.product, `plugins/tpcowork-${name}/build.mjs`)) > build)
  assert.ok(find(join(options.product, 'plugins/tpcowork-browser/build.mjs'), '--install-native') > build)
  for (const call of calls) {
    assert.equal(call.env.DSH_HOME, options.environment.DSH_HOME)
    assert.equal(call.env.DSH_DESKTOP_USER_DATA_DIR, options.environment.DSH_DESKTOP_USER_DATA_DIR)
  }
  assert.equal(calls[launch].cwd, options.harness)
})

test('a failed build stops before profile changes, plugin installation and application launch', async t => {
  const options = await fixture(t)
  const calls = []
  await assert.rejects(runDesktop(options, { log: () => {}, run: async (_command, args) => {
    calls.push(args)
    if (args.includes('build:desktop')) throw new Error('fixture compiler failed')
  } }), /构建桌面程序失败：fixture compiler failed/u)
  assert.ok(!calls.some(args => args.some(arg => /initialize-desktop-profile|desktop-plugin|start:desktop/u.test(arg))))
})

test('installed dependencies are reused and a moved checkout still reinstalls the product links', async t => {
  const options = await fixture(t)
  for (const [directory, dependency] of [[options.product, 'pnpm'],
    [join(options.product, 'plugins/tpcowork-browser'), 'dependency'], [join(options.product, 'plugins/tpcowork-toolbox'), 'dependency']]) {
    const folder = join(directory, 'node_modules', dependency)
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'package.json'), '{}')
  }
  const { steps } = desktopPlan(options)
  assert.ok(!steps.some(step => step.command === 'npm'))
  assert.ok(steps.some(step => step.args.includes('install') && step.args.includes('all')))
})

test('a ready checkout launches without installing, compiling, preparing twice, or enabling disabled bundles', async t => {
  const options = await readyFixture(t)
  const profile = join(options.environment.DSH_HOME, 'profiles/desktop/package.json')
  const before = await readFile(profile, 'utf8')
  const calls = []
  await runDesktop(options, { run: async (command, args) => calls.push({ command, args }), log: () => {} })
  assert.deepEqual(calls, [{ command: 'pnpm', args: ['run', 'start:desktop'] }])
  assert.equal(await readFile(profile, 'utf8'), before)
})

test('plugin changes and missing plugin output rebuild plugins without compiling the harness or reinstalling links', async t => {
  const options = await readyFixture(t)
  for (const explicit of [true, false]) {
    if (!explicit) await rm(join(options.product, 'plugins/tpcowork-experts/lib/host.js'))
    const { steps } = desktopPlan({ ...options, plugins: explicit })
    assert.ok(steps.some(step => step.args[0]?.endsWith('tpcowork-experts/build.mjs')))
    assert.ok(steps.some(step => step.args.includes('--install-native')))
    assert.ok(!steps.some(step => step.args.includes('build') || step.args.includes('build:desktop') || step.args.includes('install')))
    assert.equal(steps.at(-1).args.at(-1), 'start:desktop')
  }
})

test('explicit full rebuild compiles both layers without reinstalling existing plugin choices', async t => {
  const options = await readyFixture(t)
  const { steps } = desktopPlan({ ...options, rebuild: true })
  assert.ok(steps.some(step => step.args.includes('build:desktop')))
  assert.ok(steps.some(step => step.args[0]?.endsWith('tpcowork-ui/build.mjs')))
  assert.ok(!steps.some(step => step.args[0]?.endsWith('desktop-plugin.mjs')))
  assert.ok(!steps.some(step => step.args.includes('prepare:primary-runtime')))
})

test('a broken or moved plugin link is repaired without rebuilding or reinstalling other plugins', async t => {
  const options = await readyFixture(t)
  const profile = join(options.environment.DSH_HOME, 'profiles/desktop')
  await rm(join(profile, 'node_modules/@tpcowork/dsh-experts'))
  const { steps } = desktopPlan(options)
  const installs = steps.filter(step => step.args[0]?.endsWith('desktop-plugin.mjs'))
  assert.equal(installs.length, 1)
  assert.deepEqual(installs[0].args.slice(1), ['install', 'experts'])
  assert.ok(!steps.some(step => step.args.includes('build:desktop')))
})

test('equivalent relative plugin links are reused instead of reinstalled', async t => {
  const options = await readyFixture(t)
  const profile = join(options.environment.DSH_HOME, 'profiles/desktop')
  const path = join(profile, 'package.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  for (const [name, reference] of Object.entries(manifest.dependencies)) {
    manifest.dependencies[name] = `link:${relative(profile, reference.slice(5)).replaceAll('\\', '/')}`
  }
  await writeFile(path, JSON.stringify(manifest))
  assert.deepEqual(desktopPlan(options).steps.map(step => step.args), [['run', 'start:desktop']])
})

test('a running desktop prevents build and install operations', { skip: process.platform === 'win32' }, async t => {
  const options = await fixture(t)
  await mkdir(options.environment.DSH_DESKTOP_USER_DATA_DIR)
  await symlink(`localhost-${process.pid}`, join(options.environment.DSH_DESKTOP_USER_DATA_DIR, 'SingletonLock'))
  let called = false
  await assert.rejects(runDesktop(options, { run: async () => { called = true }, log: () => {} }), /已在运行/u)
  assert.equal(called, false)
  assert.doesNotThrow(() => assertDesktopStopped(options.environment.DSH_DESKTOP_USER_DATA_DIR, () => {
    throw Object.assign(new Error('dead process'), { code: 'ESRCH' })
  }))
})

test('native Desktop initialization creates a usable profile and preserves existing settings and sessions',
  { skip: !existsSync(join(harnessRoot, 'apps/desktop/lib/types/project-manager.js')) }, async t => {
    const home = await mkdtemp(join(tmpdir(), 'tp profile '))
    t.after(() => rm(home, { recursive: true, force: true }))
    const profile = await initializeDesktopProfile({ home })
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
    assert.ok(manifest.dsh.profile.bundles.length > 0)
    const custom = JSON.stringify({ ...manifest, dependencies: { '@example/custom': '1.0.0' } })
    await writeFile(join(profile, 'package.json'), custom)
    await writeFile(join(profile, 'cordis.patch.yml'), '# personal settings\n')
    await mkdir(join(home, 'sessions'))
    await writeFile(join(home, 'sessions/existing.jsonl'), 'existing conversation\n')
    await initializeDesktopProfile({ home })
    assert.equal(await readFile(join(profile, 'package.json'), 'utf8'), custom)
    assert.equal(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), '# personal settings\n')
    assert.equal(await readFile(join(home, 'sessions/existing.jsonl'), 'utf8'), 'existing conversation\n')
  })

test('the public preview command lists the complete flow without starting the desktop', async () => {
  const output = await runCommand(process.execPath, [join(productRoot, 'scripts/dev-desktop.mjs'), '--rebuild', '--plan'], { capture: true })
  const steps = JSON.parse(output)
  assert.equal(steps.at(-1).label, '启动 TP Cowork')
  assert.ok(steps.some(step => step.args.includes('--install-native')))
})
