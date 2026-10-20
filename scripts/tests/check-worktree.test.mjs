import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const directoryLinkType = process.platform === 'win32' ? 'junction' : 'dir'

async function fixture(t, separateHarness = true) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'check-worktree-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = join(base, 'product')
  const harness = join(base, 'deepseek-harness')
  await mkdir(join(root, 'scripts'), { recursive: true })
  await mkdir(harness)
  await copyFile(new URL('../check-worktree.mjs', import.meta.url), join(root, 'scripts/check-worktree.mjs'))
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', root])
  if (separateHarness) execFileSync('git', ['init', '--quiet', '--initial-branch=fork', harness])
  const check = () => spawnSync(process.execPath, [join(root, 'scripts/check-worktree.mjs')], { encoding: 'utf8' })
  return { base, root, harness, check }
}

test('accepts independent product and harness repositories in sibling directories', async (t) => {
  const { root, harness, check } = await fixture(t)
  const result = check()
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.root, root)
  assert.equal(output.branch, 'main')
  assert.equal(output.harnessRepository, harness)
  assert.equal(output.isolated, true)
})

test('rejects a sibling harness directory without its own repository', async (t) => {
  const { check } = await fixture(t, false)
  const result = check()
  assert.notEqual(result.status, 0)
})

test('accepts dependency links between the selected product and harness', async (t) => {
  const { root, harness, check } = await fixture(t)
  await mkdir(join(root, 'node_modules'))
  await symlink(harness, join(root, 'node_modules/harness'), directoryLinkType)
  const result = check()
  assert.equal(result.status, 0, result.stderr)
})

test('rejects plugin links to another worktree even when the harness is an independent fork', async (t) => {
  const { base, root, check } = await fixture(t)
  const outside = join(base, 'other-worktree')
  await mkdir(outside)
  await mkdir(join(root, 'plugins'))
  await symlink(outside, join(root, 'plugins/shared-source'), directoryLinkType)
  const result = check()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr.replaceAll('\\', '/'), /Link leaves this worktree: plugins\/shared-source/u)
})

test('rejects a harness source directory linked from another checkout', async (t) => {
  const { base, harness, check } = await fixture(t, false)
  const outside = join(base, 'other-harness')
  await mkdir(outside)
  await rm(harness, { recursive: true })
  await symlink(outside, harness, directoryLinkType)
  const result = check()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /deepseek-harness must be a local source directory/u)
})
