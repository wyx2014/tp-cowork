import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildLinux, collectLinuxInstallers, linuxInstallerNames } from '../build-linux.mjs'

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
