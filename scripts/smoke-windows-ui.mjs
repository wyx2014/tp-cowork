/** Launch the installed application with a private home and inspect its real renderer. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'

const [executable, homeArgument, outputArgument] = process.argv.slice(2)
if (!executable || !homeArgument || !outputArgument) throw new Error('Expected executable, private home and evidence directory')
const home = resolve(homeArgument), output = resolve(outputArgument)
await mkdir(home, { recursive: true })
await mkdir(output, { recursive: true })
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/iu.test(name)))
delete env.ELECTRON_RUN_AS_NODE
const redact = value => String(value).replace(/token=[^\s&"']+/giu, 'token=[redacted]')
const log = [], errors = [], networkFailures = [], observers = []
let app, page, failure
// Capture through Electron so the welcome window cannot leave the main compositor occluded.
async function captureWindow(window, path) {
  const native = await app.browserWindow(window)
  let timer
  try {
    const png = await Promise.race([
      native.evaluate(async browserWindow => {
        if (browserWindow.isMinimized()) browserWindow.restore()
        browserWindow.show()
        browserWindow.focus()
        const snapshot = await browserWindow.capturePage(undefined, { stayAwake: true })
        if (snapshot.isEmpty()) throw new Error('Installed window returned an empty screenshot')
        return snapshot.toPNG().toString('base64')
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Installed window capture exceeded 20 seconds')), 20_000) }),
    ])
    await writeFile(path, Buffer.from(png, 'base64'))
  } finally { clearTimeout(timer); await native.dispose() }
}
try {
  app = await _electron.launch({ executablePath: resolve(executable),
    args: [`--user-data-dir=${join(home, 'electron')}`],
    env: { ...env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_DESKTOP_OPEN_DEVTOOLS: '0' }, timeout: 60_000 })
  for (const stream of [app.process().stdout, app.process().stderr]) {
    stream?.on('data', bytes => { log.push(redact(bytes)); if (log.length > 300) log.shift() })
  }
  const observe = window => {
    if (observers.some(observer => observer.window === window)) return
    const pageerror = error => errors.push(redact(error.message))
    const consoleError = message => {
      if (message.type() !== 'error') return
      const location = message.location()
      errors.push(redact(`${message.text()}${location.url ? ` (${location.url}:${location.lineNumber})` : ''}`))
    }
    const response = response => {
      if (response.status() < 400) return
      networkFailures.push({ kind: 'response', status: response.status(), url: redact(response.url()),
        resourceType: response.request().resourceType(), window: redact(window.url()) })
    }
    const requestfailed = request => networkFailures.push({ kind: 'requestfailed', url: redact(request.url()),
      error: redact(request.failure()?.errorText), resourceType: request.resourceType(), window: redact(window.url()) })
    const events = { pageerror, console: consoleError, response, requestfailed }
    for (const [event, listener] of Object.entries(events)) window.on(event, listener)
    observers.push({ window, events })
  }
  app.on('window', observe)
  for (const window of app.windows()) observe(window)
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    page = app.windows().find(window => window.url().startsWith('dsh-app://app'))
    if (page && await page.locator('body[data-tpcowork-ui]').count()) break
    await new Promise(done => setTimeout(done, 250))
  }
  assert.ok(page, 'Installed application did not open its main page')
  // Observe a complete document load even when Electron launched before listeners attached.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('body[data-tpcowork-ui]').waitFor({ timeout: 60_000 })
  const graph = await page.evaluate(() => window.__DSH_BOOT__?.entries?.map(entry => entry.id) ?? [])
  console.log('Installed product Client modules:', graph.filter(id => id.startsWith('@tpcowork/')))
  assert.equal(await page.locator('body[data-tpcowork-ui]').count(), 1, 'TP Cowork appearance plugin did not activate')
  for (const name of ['ui', 'browser', 'toolbox', 'automation', 'experts']) {
    assert.ok(graph.includes(`@tpcowork/dsh-${name}`), `Installed Client graph omits ${name}`)
  }
  await page.waitForFunction(async () =>
    (await window.dshDesktop?.browserAutomation?.request('snapshot'))?.enabled === true,
  null, { timeout: 20_000 })
  console.log('Installed native browser bridge enabled')
  page.setDefaultTimeout(20_000)
  await page.getByRole('button', { name: /^(Experts · Skills · Connectors|专家 · 技能 · 连接器)$/ }).click()
  await page.locator('.tp-toolbox').waitFor()
  await page.getByRole('button', { name: /^(Teams|Expert teams|专家团队)$/i }).click()
  const research = page.locator('.tp-toolbox-card').filter({ has: page.getByRole('heading', { name: '资产投研团队 · 个股研究', exact: true }) })
  await research.waitFor()
  assert.equal(await research.getByRole('button', { name: /^(Use team|使用团队)$/ }).isEnabled(), true,
    'Installed stock research team is unavailable')
  await captureWindow(page, join(output, 'toolbox.png'))
  assert.deepEqual([...errors], [], 'Installed renderer reported errors')
  console.log('TP Cowork: installed appearance, Client modules and expert toolbox verified')
} catch (error) {
  failure = error
} finally {
  if (app) app.removeAllListeners('window')
  for (const { window, events } of observers) {
    for (const [event, listener] of Object.entries(events)) window.off(event, listener)
  }
  if (app) {
    const windows = []
    for (const window of app.windows()) {
      try {
        windows.push(await window.evaluate(async () => ({ url: location.protocol + '//' + location.host + location.pathname,
          title: document.title, text: document.body?.innerText,
          productAppearance: document.body?.hasAttribute('data-tpcowork-ui'),
          browserEnabled: (await window.dshDesktop?.browserAutomation?.request('snapshot'))?.enabled,
          productModules: window.__DSH_BOOT__?.entries?.filter(entry => entry.id.startsWith('@tpcowork/')).map(entry => entry.id) })))
        await captureWindow(window, join(output, `window-${windows.length}.png`))
      } catch (error) { log.push(`Window evidence: ${redact(error)}`) }
    }
    let profile
    try { profile = JSON.parse(await readFile(join(home, 'profiles/desktop/package.json'), 'utf8')) }
    catch (error) { log.push(`Profile evidence: ${redact(error)}`) }
    await writeFile(join(output, 'report.json'), JSON.stringify({ passed: !failure, error: failure && redact(failure.stack), windows, profile, errors, networkFailures, log }, null, 2) + '\n')
    console.log(JSON.stringify({ windows, profile, errors, networkFailures }, null, 2))
    const timer = setTimeout(() => app.process().kill(), 10_000)
    try { await app.close() } finally { clearTimeout(timer) }
  }
}
if (failure) throw failure
