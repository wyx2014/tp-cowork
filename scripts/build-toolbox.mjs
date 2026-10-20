/** Reproducible build from a worktree with no lib directories. Run from any cwd. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const harness = resolve(root, '../deepseek-harness')
async function run(command, args, cwd = harness) {
  await new Promise((ok, fail) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', fail)
    child.once('exit', code => code === 0 ? ok() : fail(new Error(`${command} exited ${code}`)))
  })
}
const pnpm = args => run(process.execPath, [resolve(harness, 'node_modules/pnpm/bin/pnpm.cjs'), ...args])
await run(process.execPath, ['scripts/check-worktree.mjs'], root)
if (process.argv.includes('--install')) await run('npx', ['--yes', 'pnpm@11.28.5', 'install', '--frozen-lockfile', '--ignore-scripts', '--store-dir', '.pnpm-store', '--package-import-method=copy'])
await pnpm(['run', 'build:native-system'])
await pnpm(['run', 'build:lib:host'])
const client = ['client/connection', 'typert/registry', 'api/gateway', 'client/store', 'client/ui-primitives', 'client/ui-layout', 'client/ui-sidebar', 'client/ui-workspace', 'client/locale']
await pnpm(['exec', 'tsc', '-b', ...client.map(pkg => `packages/${pkg}${pkg === 'api/gateway' ? '/tsconfig.client.json' : ''}`)])
await pnpm(['exec', 'tsc', '-b', 'packages/client/ui-conversation/tsconfig.client.json'])
for (const pkg of client) await run(process.execPath, [resolve(harness, 'node_modules/tsdown/dist/run.mjs'), '--config-loader', 'native'], resolve(harness, 'packages', pkg))
await run(process.execPath, ['plugins/tpcowork-toolbox/build.mjs'], root)
await run(process.execPath, ['plugins/tpcowork-experts/build.mjs'], root)
if (process.argv.includes('--smoke')) {
  for (const test of ['artifact-smoke', 'bootstrap-artifact-smoke']) await run(process.execPath, [`plugins/tpcowork-toolbox/tests/${test}.mjs`], root)
  await run(process.execPath, ['plugins/tpcowork-experts/tests/artifact-smoke.mjs'], root)
}
console.log('Toolbox clean build completed (targeted Client programs, not the Client aggregate).')
