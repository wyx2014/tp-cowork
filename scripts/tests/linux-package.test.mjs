import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildLinux, collectLinuxInstallers, linuxInstallerNames } from '../build-linux.mjs'
import { prepareDesktopBasic } from '../prepare-desktop-basic.mjs'

test('collects both Linux formats with their exact bytes, checksums and source revisions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'TP Linux packages '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  await mkdir(source)
  const names = ['tpcowork-linux-x64.AppImage', 'tpcowork-linux-x64.deb']
  for (const name of names) await writeFile(join(source, name), Buffer.from(`package bytes: ${name}`))
  await writeFile(join(source, 'builder-debug.yml'), 'not a deliverable')
  const output = join(root, 'output')
  const revisions = { productCommit: 'product-sha', harnessCommit: 'harness-sha', kylinMachineVerified: false }
  assert.deepEqual(await collectLinuxInstallers(source, output, revisions), names)
  for (const name of names) {
    const bytes = await readFile(join(source, name))
    assert.deepEqual(await readFile(join(output, name)), bytes)
    assert.equal(await readFile(join(output, `${name}.sha256`), 'utf8'), `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`)
  }
  assert.deepEqual(JSON.parse(await readFile(join(output, 'build-info.json'), 'utf8')), { schemaVersion: 1, ...revisions, installers: names })
  assert.equal((await readdir(output)).length, 5)
})

test('rejects missing and ambiguous Linux formats before writing deliverables', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tp-linux-incomplete-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(linuxInstallerNames(root), /one .AppImage package, found 0/u)
  await writeFile(join(root, 'app.AppImage'), '')
  await assert.rejects(linuxInstallerNames(root), /one .deb package, found 0/u)
  await writeFile(join(root, 'app.deb'), '')
  await mkdir(join(root, 'directory.deb'))
  assert.deepEqual(await linuxInstallerNames(root), ['app.AppImage', 'app.deb'])
  await writeFile(join(root, 'old.deb'), '')
  const output = join(root, 'out')
  await assert.rejects(collectLinuxInstallers(root, output, {}), /one .deb package, found 2/u)
  await assert.rejects(readdir(output), { code: 'ENOENT' })
})

test('Linux packaging rejects incompatible hosts before installing dependencies', { skip: process.platform === 'linux' && process.arch === 'x64' }, async () => {
  await assert.rejects(buildLinux([]), /Linux x64/u)
})

test('Basic plan selects an independent identity and no product plugins', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/build-linux.mjs', '--variant', 'basic', '--plan'])
  const basic = JSON.parse(stdout)
  assert.equal(basic.product, 'TP Cowork Basic')
  assert.equal(basic.variant, 'basic')
  assert.deepEqual(basic.bundles, [])
  assert.equal(basic.appId, 'com.tparuyi.tpcowork.dsh.basic')
  const { stdout: fullOutput } = await promisify(execFile)(process.execPath, ['scripts/build-linux.mjs', '--variant', 'full', '--plan'])
  const full = JSON.parse(fullOutput)
  assert.ok(full.bundles.length > 0)
  assert.notEqual(full.appId, basic.appId)
  await assert.rejects(buildLinux(['--variant', 'unknown', '--plan']), /variant must be full or basic/u)
})

test('Basic preparation clears old package tarballs without running product plugin builds', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tp-basic-product-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = JSON.parse(await readFile(new URL('../../desktop-product.linux-basic.json', import.meta.url), 'utf8'))
  await writeFile(join(root, 'desktop-product.linux-basic.json'), JSON.stringify(config))
  const packages = join(root, '.desktop-build/basic/packages')
  await mkdir(packages, { recursive: true })
  await writeFile(join(packages, 'old-product.tgz'), 'stale')
  assert.equal(await prepareDesktopBasic(root), packages)
  assert.deepEqual(await readdir(packages), [])
  await writeFile(join(root, 'desktop-product.linux-basic.json'), JSON.stringify({ ...config, bundles: ['@tpcowork/dsh-toolbox'] }))
  await assert.rejects(prepareDesktopBasic(root), /must not include product plugins/u)
})

test('Linux startup diagnostics preserve failures and keep sandboxing enabled', {
  skip: process.platform === 'win32' && 'Requires POSIX executable permissions and Bash',
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'TP Basic diagnostic '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const executable = join(root, 'fake basic')
  await writeFile(executable, '#!/bin/sh\nprintf "run-as-node:%s\\n" "${ELECTRON_RUN_AS_NODE-unset}"\nprintf "%s\\n" "$@"\nexit 7\n', { mode: 0o755 })
  const failure = await promisify(execFile)('bash', ['scripts/diagnose-linux-basic.sh', '--executable', executable, '--software-rendering'], {
    env: { ...process.env, TMPDIR: root, ELECTRON_RUN_AS_NODE: '1' },
  }).catch(error => error)
  assert.equal(failure.code, 7)
  assert.match(failure.stdout, /run-as-node:unset/u)
  assert.match(failure.stdout, /--disable-gpu/u)
  assert.doesNotMatch(failure.stdout, /--no-sandbox/u)
  const log = /Startup log: (.+)/u.exec(failure.stdout)[1]
  assert.match(await readFile(log, 'utf8'), /Exit code: 7/u)
})
