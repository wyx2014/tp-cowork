/** Private stdio launcher; materializes the shipped browser in a profile cache without downloading it. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, access, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const root = fileURLToPath(new URL('../', import.meta.url))
let active
let stopped = false
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopped = true; active?.kill(signal) })
async function ready(directory, manifest) {
  try {
    return await readFile(join(directory, '.ready'), 'utf8') === manifest.archiveSha256
      && (await access(join(directory, manifest.executable)), true)
  } catch { return false }
}
async function browser(manifest) {
  const offset = process.argv.indexOf('--cache-dir')
  const cache = offset < 0 ? join(tmpdir(), 'tpcowork-toolbox-playwright') : process.argv[offset + 1]
  if (!cache) throw new Error('missing cache')
  const target = resolve(cache, manifest.archiveSha256)
  if (await ready(target, manifest)) return join(target, manifest.executable)
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(join(root, 'runtime', manifest.archive))) hash.update(bytes)
  if (hash.digest('hex') !== manifest.archiveSha256 || stopped) throw new Error('invalid archive')
  await mkdir(cache, { recursive: true, mode: 0o700 })
  const staging = await mkdtemp(join(cache, '.prepare-'))
  try {
    await new Promise((ok, fail) => {
      active = spawn('tar', ['-xzf', join(root, 'runtime', manifest.archive), '-C', staging], { stdio: 'ignore' })
      active.once('error', fail); active.once('exit', code => code === 0 ? ok() : fail(new Error('extract failed')))
    })
    if (stopped) throw new Error('cancelled')
    await access(join(staging, manifest.executable))
    await writeFile(join(staging, '.ready'), manifest.archiveSha256, { mode: 0o600 })
    try { await rename(staging, target) }
    catch (error) { if (!(await ready(target, manifest))) throw error }
  } finally { await rm(staging, { recursive: true, force: true }) }
  return join(target, manifest.executable)
}
try {
  const manifest = JSON.parse(await readFile(join(root, 'runtime/playwright.json'), 'utf8'))
  const dependency = JSON.parse(await readFile(join(root, 'node_modules/@playwright/mcp/package.json'), 'utf8'))
  if (dependency.version !== '0.0.30' || manifest.version !== dependency.version || manifest.platform !== process.platform || manifest.arch !== process.arch
    || manifest.archive !== 'browsers.tar.gz' || !/^[a-f0-9]{64}$/.test(manifest.archiveSha256)
    || typeof manifest.executable !== 'string' || manifest.executable.includes('..') || manifest.executable.startsWith('/')) throw new Error('invalid runtime')
  const executable = await browser(manifest)
  if (stopped) throw new Error('cancelled')
  active = spawn(process.execPath, [join(root, 'node_modules/@playwright/mcp/cli.js'), '--headless', '--isolated', '--browser', 'chromium', '--executable-path', executable], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  active.once('error', () => { process.stderr.write('toolbox/playwright-launch-failed\n'); process.exitCode = 1 })
  active.once('exit', code => { process.exitCode = code ?? 1 })
} catch {
  process.stderr.write('toolbox/playwright-needs-configuration: prepare the platform runtime and a writable profile cache before use.\n')
  process.exitCode = stopped ? 0 : 1
}
