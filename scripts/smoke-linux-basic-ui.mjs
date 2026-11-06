/** Open the packaged Basic GUI with the Chromium sandbox enabled and retain startup evidence. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'

const [executable, homeArgument, outputArgument] = process.argv.slice(2)
if (!executable || !homeArgument || !outputArgument) throw new Error('Expected Basic executable, private home and evidence directory')
const home = resolve(homeArgument), output = resolve(outputArgument)
await mkdir(home, { recursive: true })
await mkdir(output, { recursive: true })
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/iu.test(name)
  && !name.startsWith('DSH_') && name !== 'ELECTRON_RUN_AS_NODE'))
const redact = value => String(value).replace(/token=[^\s&"']+/giu, 'token=[redacted]')
const errors = [], logs = [], observed = new Set()
let app, page, failure, state
const observe = window => {
  if (observed.has(window)) return
  observed.add(window)
  window.on('pageerror', error => errors.push(redact(error.message)))
  window.on('console', message => { if (message.type() === 'error') errors.push(redact(message.text())) })
}
try {
  app = await _electron.launch({ executablePath: resolve(executable), chromiumSandbox: true,
    args: [`--user-data-dir=${join(home, 'electron')}`],
    env: { ...env, HOME: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'),
      XDG_DATA_HOME: join(home, 'data'), DSH_AGENTS_HOME: join(home, 'agents'), DSH_TELEMETRY_DISABLED: '1',
      DSH_DESKTOP_OPEN_DEVTOOLS: '0', DSH_DESKTOP_DIAGNOSTIC_FILE: join(output, 'startup-error.log') },
    timeout: 90_000 })
  for (const stream of [app.process().stdout, app.process().stderr]) {
    stream?.on('data', bytes => { logs.push(redact(bytes)); if (logs.length > 300) logs.shift() })
  }
  app.on('window', observe)
  for (const window of app.windows()) observe(window)
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    page = app.windows().find(window => window.url().startsWith('dsh-app://app'))
    if (page) break
    await new Promise(done => setTimeout(done, 200))
  }
  assert.ok(page, 'Basic did not open its main window')
  await page.waitForFunction(() => document.body.classList.contains('dsh-startup-ready')
    && window.__DSH_BOOT__?.entries?.length > 0 && document.querySelector('#root')?.childElementCount > 0,
  null, { timeout: 90_000 })
  await page.getByRole('button').first().waitFor({ state: 'visible', timeout: 30_000 })
  const native = await app.evaluate(({ app, BrowserWindow }) => ({
    name: app.name, userData: app.getPath('userData'), home: process.env.DSH_HOME, argv: process.argv,
    visibleWindows: BrowserWindow.getAllWindows().filter(window => window.isVisible()).length,
    versions: process.versions,
  }))
  assert.equal(native.name, 'TP Cowork Basic')
  assert.equal(native.home, join(native.userData, 'harness'), 'Basic must isolate its default Harness profile')
  assert.equal(native.argv.includes('--no-sandbox'), false, 'GUI check must exercise the normal Chromium sandbox')
  assert.ok(native.visibleWindows > 0, 'Basic must show a real window')
  const renderer = await page.evaluate(() => ({ title: document.title, text: document.body.innerText.slice(0, 4000),
    productModules: window.__DSH_BOOT__.entries.filter(entry => entry.id.startsWith('@tpcowork/')).map(entry => entry.id) }))
  assert.deepEqual(renderer.productModules, [], 'Basic renderer must not load product plugins')
  await page.screenshot({ path: join(output, 'basic-window.png') })
  assert.deepEqual(errors, [], 'Basic renderer must start without errors')
  state = { native, renderer }
  console.log('TP Cowork Basic: real GUI displayed, sandbox enabled, isolated home, zero product Client modules')
} catch (error) { failure = error }
finally {
  if (page && !page.isClosed() && failure) {
    await page.screenshot({ path: join(output, 'failed-window.png'), timeout: 10_000 }).catch(error => logs.push(redact(error)))
  }
  try {
    await writeFile(join(output, 'report.json'), JSON.stringify({ passed: !failure, error: failure && redact(failure.stack), state, errors, logs }, null, 2) + '\n')
  } finally {
    if (app) {
      const timer = setTimeout(() => app.process().kill('SIGKILL'), 10_000)
      try { await app.close() } finally { clearTimeout(timer) }
    }
  }
}
if (failure) throw failure
