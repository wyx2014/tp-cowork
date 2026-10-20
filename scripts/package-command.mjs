/** Run build tools through their JavaScript entries on Windows, without a command shell. */
import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const productRoot = fileURLToPath(new URL('../', import.meta.url))
export const harnessRoot = resolve(productRoot, '../deepseek-harness')

/** Find npm even when the enclosing pnpm command owns npm_execpath. */
export function npmCli(environment = process.env) {
  const candidates = [environment.TPCOWORK_NPM_CLI,
    environment.npm_execpath?.endsWith('npm-cli.js') ? environment.npm_execpath : undefined,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')]
  for (const directory of (environment.PATH ?? environment.Path ?? '').split(delimiter)) {
    candidates.push(join(directory, 'node_modules/npm/bin/npm-cli.js'), join(directory, '../npm/bin/npm-cli.js'))
    const bin = join(directory, 'npm')
    if (existsSync(bin)) {
      const target = realpathSync(bin)
      if (target.endsWith('npm-cli.js')) candidates.push(target)
    }
  }
  const path = candidates.find(candidate => candidate && existsSync(candidate))
  if (!path) throw new Error('TP Cowork: npm CLI not found; run this build with npm run build:win')
  return resolve(path)
}

/** Run one build stage and reject startup, signal, and nonzero-exit failures. */
export function runCommand(command, args, { cwd = productRoot, env = process.env, capture = false } = {}) {
  if (command === 'npm') { args = [npmCli(env), ...args]; command = process.execPath }
  if (command === 'pnpm') {
    const cli = [join(productRoot, 'node_modules/pnpm/bin/pnpm.cjs'), join(harnessRoot, 'node_modules/pnpm/bin/pnpm.cjs')]
      .find(path => existsSync(path))
    if (!cli) throw new Error('TP Cowork: run npm ci in the product directory first')
    args = [cli, ...args]; command = process.execPath
  }
  return new Promise((ok, fail) => {
    let stdout = ''
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' })
    child.stdout?.on('data', bytes => { stdout += bytes })
    child.once('error', fail)
    child.once('close', (code, signal) => code === 0 ? ok(stdout) : fail(new Error(`TP Cowork: build stage exited ${code ?? signal}`)))
  })
}
