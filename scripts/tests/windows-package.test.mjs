import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildWindows, collectWindowsInstallers, standaloneBuildVersion } from '../build-windows.mjs'
import { runCommand } from '../package-command.mjs'
import { stageCoreBundle } from '../stage-core-bundle.mjs'
import { withStagedWindowsApplication } from '../stage-windows-smoke.mjs'

test('verifies the complete application from a private path with spaces and preserves its source', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tp-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const native = 'resources/app.asar.unpacked/dsh/node_modules/@tpcowork/dsh-toolbox/runtime/python/Lib/site-packages/lxml'
  await mkdir(join(root, native), { recursive: true })
  const files = ['TP Cowork.exe', 'resources/app.asar', `${native}/_elementpath.cp312-win_amd64.pyd`]
  for (const file of files) await writeFile(join(root, file), Buffer.from(`packaged bytes: ${file}`))
  let staged
  const result = await withStagedWindowsApplication(root, async application => {
    staged = application
    assert.notEqual(application, root)
    assert.match(application, /TP Cowork$/u)
    assert.ok(application.length < 100, 'native DLLs need a short staging directory')
    for (const file of files) assert.deepEqual(await readFile(join(application, file)), await readFile(join(root, file)))
    return 'verified'
  })
  assert.equal(result, 'verified')
  await assert.rejects(readdir(staged), { code: 'ENOENT' })
  for (const file of files) assert.equal(await readFile(join(root, file), 'utf8'), `packaged bytes: ${file}`)
})

test('a failed product smoke rejects the build and removes its private application', async t => {
  const source = await mkdtemp(join(tmpdir(), 'tp-source-'))
  t.after(() => rm(source, { recursive: true, force: true }))
  await writeFile(join(source, 'TP Cowork.exe'), 'fixture executable')
  let staged
  const failure = new Error('native Python import failed')
  await assert.rejects(withStagedWindowsApplication(source, async application => {
    staged = application
    throw failure
  }), error => error === failure)
  await assert.rejects(readdir(staged), { code: 'ENOENT' })
  assert.equal(await readFile(join(source, 'TP Cowork.exe'), 'utf8'), 'fixture executable')
})

test('standalone CI versions need only the run identity, with distinct rerun versions', () => {
  const environment = { PACKAGE_BUILD_VERSION: 'auto', GITHUB_RUN_NUMBER: '12', GITHUB_RUN_ATTEMPT: '1' }
  const now = new Date('2026-10-20T00:00:00Z')
  assert.equal(standaloneBuildVersion(environment, '0.2.1-alpha.2', now), '0.2.1-alpha.2.20261020.12.1')
  assert.equal(standaloneBuildVersion({ ...environment, GITHUB_RUN_ATTEMPT: '2' }, '0.2.1-alpha.2', now), '0.2.1-alpha.2.20261020.12.2')
  assert.equal(standaloneBuildVersion({}, '0.2.1-alpha.2'), '0.2.1-alpha.2')
  assert.throws(() => standaloneBuildVersion({ ...environment, GITHUB_RUN_NUMBER: 'bad' }, '0.2.1-alpha.2', now), /positive integer/)
})

test('copies the verified installer with its exact checksum and both source revisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tpcowork-windows-artifact-'))
  try {
    const source = join(root, 'installer.exe')
    const bytes = Buffer.from('fixture installer bytes')
    await writeFile(source, bytes)
    await writeFile(join(root, 'diagnostic.log'), 'not an installer')
    const output = join(root, 'dist/installers')
    const revisions = { productCommit: 'product-commit', harnessCommit: 'harness-commit' }
    assert.deepEqual(await collectWindowsInstallers(root, output, revisions), ['installer.exe'])
    assert.deepEqual(await readFile(join(output, 'installer.exe')), bytes)
    assert.equal(await readFile(join(output, 'installer.exe.sha256'), 'utf8'), `${createHash('sha256').update(bytes).digest('hex')}  installer.exe\n`)
    assert.deepEqual(JSON.parse(await readFile(join(output, 'build-info.json'), 'utf8')), {
      schemaVersion: 1, ...revisions, installers: ['installer.exe'],
    })
    assert.deepEqual((await readdir(output)).sort(), ['build-info.json', 'installer.exe', 'installer.exe.sha256'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('refuses missing or ambiguous installers instead of collecting an old executable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tpcowork-windows-empty-'))
  try {
    await assert.rejects(collectWindowsInstallers(root, join(root, 'out'), {}), /expected one verified installer/)
    await writeFile(join(root, 'a.exe'), '')
    await writeFile(join(root, 'b.exe'), '')
    await assert.rejects(collectWindowsInstallers(root, join(root, 'out'), {}), /found 2/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('build stages reject process failures and preserve arguments containing spaces', async () => {
  assert.equal(await runCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'a path with spaces'], { capture: true }), 'a path with spaces')
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(7)'], { capture: true }), /exited 7/)
})

test('Mac and Linux Windows builds stop before installing or preparing files', { skip: process.platform === 'win32' && process.arch === 'x64' }, async () => {
  await assert.rejects(buildWindows([]), /Windows x64/)
})

test('core staging ignores the developer deployment file but forwards an explicit deployment API key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tpcowork-core-staging-'))
  try {
    const source = join(root, 'source')
    await mkdir(source)
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@example/core', files: ['index.js', 'deployment.local.json', 'model.patch.yml', 'model.js'] }))
    await writeFile(join(source, 'index.js'), 'export const example = true\n')
    const local = JSON.stringify({ apiKey: 'local-example-secret', apiBase: 'https://local.example.com/v1' })
    await writeFile(join(source, 'deployment.local.json'), local)
    await writeFile(join(source, 'model.patch.yml'), 'local patch')
    await writeFile(join(source, 'model.js'), 'local model')
    const destination = join(root, 'release')
    await stageCoreBundle(source, destination, { TPCOWORK_DEEPSEEK_API_KEY: 'ambient-example-secret', TPCOWORK_DEEPSEEK_BASE_URL: 'https://release.example.com/v1' })
    const staged = JSON.parse(await readFile(join(destination, 'deployment.local.json'), 'utf8'))
    assert.equal(staged.apiKey, 'ambient-example-secret')
    assert.equal(staged.apiBase, 'https://release.example.com/v1')
    assert.equal(await readFile(join(source, 'deployment.local.json'), 'utf8'), local)
    assert.equal(await readFile(join(source, 'model.patch.yml'), 'utf8'), 'local patch')
    assert.equal(await readFile(join(source, 'model.js'), 'utf8'), 'local model')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('core staging stays credential-free when no deployment API key is provided', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tpcowork-core-staging-default-'))
  try {
    const source = join(root, 'source')
    await mkdir(source)
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@example/core', files: ['index.js', 'deployment.local.json', 'model.patch.yml', 'model.js'] }))
    await writeFile(join(source, 'index.js'), 'export const example = true\n')
    await writeFile(join(source, 'deployment.local.json'), JSON.stringify({ apiKey: 'local-example-secret' }))
    await writeFile(join(source, 'model.patch.yml'), 'local patch')
    await writeFile(join(source, 'model.js'), 'local model')
    const destination = join(root, 'release')
    await stageCoreBundle(source, destination, {})
    const staged = JSON.parse(await readFile(join(destination, 'deployment.local.json'), 'utf8'))
    assert.equal(staged.apiKey, undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})
