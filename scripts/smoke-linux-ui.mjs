/** Open the selected Linux installer GUI, verify its product surfaces, and retain startup evidence. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import { finishFirstRunGuide, checkInstalledProductUi, observeInstalledStartup } from './installed-ui-checks.mjs'

const [executable, homeArgument, outputArgument, configArgument] = process.argv.slice(2)
if (!executable || !homeArgument || !outputArgument) throw new Error('Expected Linux executable, private home and evidence directory')
const config = JSON.parse(await readFile(configArgument ?? new URL('../desktop-product.linux-basic.json', import.meta.url), 'utf8'))
const hasBrowser = config.bundles.includes('@tpcowork/dsh-browser')
const expectedClients = []
for (const name of config.bundles) {
  const manifest = JSON.parse(await readFile(new URL(`../plugins/${name.replace('@tpcowork/dsh-', 'tpcowork-')}/package.json`, import.meta.url), 'utf8'))
  if (manifest.dsh?.client) expectedClients.push(name)
}
const home = resolve(homeArgument), output = resolve(outputArgument)
await mkdir(home, { recursive: true })
await mkdir(output, { recursive: true })
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/iu.test(name)
  && !name.startsWith('DSH_') && name !== 'ELECTRON_RUN_AS_NODE'))
const redact = value => String(value).replace(/token=[^\s&"']+/giu, 'token=[redacted]')
const errors = [], logs = [], observed = new Map()
let app, page, failure, state
const observe = window => {
  if (observed.has(window)) return
  observed.set(window, observeInstalledStartup(window))
  window.on('pageerror', error => errors.push(redact(error.message)))
  window.on('console', message => { if (message.type() === 'error') errors.push(redact(message.text())) })
}
const nativeState = () => app.evaluate(({ app, BrowserWindow }) => ({
  name: app.name, userData: app.getPath('userData'), home: process.env.DSH_HOME, argv: process.argv,
  visibleWindows: BrowserWindow.getAllWindows().filter(window => window.isVisible()).length,
  windows: BrowserWindow.getAllWindows().map(window => ({ url: window.webContents.getURL(), visible: window.isVisible() })),
  versions: process.versions,
}))
const rendererState = () => page.evaluate(() => ({ title: document.title, text: document.body.innerText.slice(0, 4000),
  bodyClass: document.body.className, readyState: document.readyState, visibility: document.visibilityState,
  rootChildren: document.querySelector('#root')?.childElementCount,
  bootEntries: window.__DSH_BOOT__?.entries?.length,
  productModules: window.__DSH_BOOT__?.entries?.filter(entry => entry.id.startsWith('@tpcowork/')).map(entry => entry.id) }))
async function capture(filename, show = false) {
  const native = await app.browserWindow(page)
  let timer
  try {
    const png = await Promise.race([
      native.evaluate(async (window, show) => {
        if (show) window.show()
        window.focus()
        const image = await window.capturePage(undefined, { stayAwake: true })
        if (image.isEmpty()) throw new Error('Linux window capture is empty')
        return image.toPNG().toString('base64')
      }, show),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Linux window capture timed out')), 20_000) }),
    ])
    await writeFile(join(output, filename), Buffer.from(png, 'base64'))
  } finally { clearTimeout(timer); await native.dispose() }
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
  assert.ok(page, `${config.productName} did not open its main window`)
  state = { productName: config.productName, expectedClients }
  // A fresh profile displays Welcome while the already loaded workspace remains hidden.
  // Follow its public no-credentials flow before checking that the workspace is usable.
  let welcome, workspaceShown = false, shownFailure
  // Chromium reruns this wait across startup navigation. Repeated main-process evaluations
  // can instead lose Electron's inspector context while its first windows are being created.
  const shown = page.waitForFunction(() => document.body.classList.contains('dsh-startup-visible'),
    null, { timeout: 90_000, polling: 250 }).then(async handle => {
    workspaceShown = true
    await handle.dispose()
  }).catch(error => { shownFailure = error })
  while (Date.now() < deadline) {
    welcome = app.windows().find(window => window.url().endsWith('/renderer/welcome.html'))
    if (welcome) break
    if (shownFailure) throw shownFailure
    if (workspaceShown) break
    await new Promise(done => setTimeout(done, 200))
  }
  if (config.bundles.length === 0) assert.ok(welcome, 'A fresh Basic profile must display Welcome')
  if (welcome) {
    await welcome.locator('#api-key').click({ timeout: 30_000 })
    await welcome.locator('#skip-key').click({ timeout: 30_000 })
  }
  await shown
  if (shownFailure) throw shownFailure
  await page.waitForFunction(() => !document.getElementById('dsh-startup')
    && window.__DSH_BOOT__?.entries?.length > 0 && document.querySelector('#root')?.childElementCount > 0,
  null, { timeout: 90_000, polling: 250 })
  await page.getByRole('button').first().waitFor({ state: 'visible', timeout: 30_000 })
  const native = await nativeState()
  assert.equal(native.name, config.productName)
  assert.equal(native.home, join(native.userData, 'harness'), 'Linux variants must isolate their Harness profile')
  assert.equal(native.argv.includes('--no-sandbox'), false, 'GUI check must exercise the normal Chromium sandbox')
  assert.ok(native.visibleWindows > 0, 'Linux package must show a real window')
  assert.ok(native.windows.some(window => window.url.startsWith('dsh-app://app') && window.visible),
    'Linux package must reveal its workspace after first-run setup')
  const renderer = await rendererState()
  assert.deepEqual([...renderer.productModules].sort(), expectedClients.sort(), 'Renderer must load exactly the selected product Client modules')
  if (config.bundles.length > 0) {
    await page.locator('body[data-tpcowork-ui]').waitFor({ timeout: 30_000 })
    page.setDefaultTimeout(30_000)
    await finishFirstRunGuide(page)
    const zoom = await page.evaluate(() => window.dshDesktop.browserAutomation.request('windowZoom', { action: 'get' }))
    assert.equal(zoom.level, 0, 'Interface zoom must work with the selected plugin set')
    if (hasBrowser) {
      await page.waitForFunction(async () => (await window.dshDesktop.browserAutomation.request('snapshot')).enabled === true,
        null, { timeout: 30_000, polling: 250 })
    }
    const browser = await page.evaluate(() => window.dshDesktop.browserAutomation.request('snapshot'))
    assert.equal(browser.enabled, hasBrowser, 'Browser automation must match the selected plugin set')
    const originalDialog = await app.evaluateHandle(({ dialog }) => dialog.showMessageBox)
    try {
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
      const diagnostics = await page.evaluate(() => window.dshDesktop.browserAutomation.request('diagnostics', { action: 'export', locale: 'en' }))
      assert.equal(diagnostics.status, 'cancelled', 'Diagnostics must retain its privacy confirmation')
    } finally {
      await app.evaluate(({ dialog }, original) => { dialog.showMessageBox = original }, originalDialog)
      await originalDialog.dispose()
    }
    await checkInstalledProductUi(page, { startup: observed.get(page),
      clientPlugins: expectedClients.map(name => name.replace('@tpcowork/dsh-', '')),
      capture: name => capture(`${name}.png`) })
    await page.getByTestId('toolbox-navigation').click()
    await page.getByTestId('toolbox-page').waitFor({ state: 'visible' })
    await capture('toolbox.png')
  }
  await capture(config.bundles.length === 0 ? 'basic-window.png' : 'linux-window.png')
  assert.deepEqual(errors, [], 'Linux renderer must start without errors')
  state = { native, renderer }
  console.log(`${config.productName}: real GUI displayed, sandbox enabled, isolated home, ${expectedClients.length} selected product Client modules`)
} catch (error) { failure = error }
finally {
  if (page && !page.isClosed() && failure) {
    state = { ...state, native: await nativeState().catch(error => ({ error: redact(error) })),
      renderer: await rendererState().catch(error => ({ error: redact(error) })) }
    await capture('failed-window.png', true).catch(error => logs.push(redact(error)))
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
