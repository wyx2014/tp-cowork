/** Own an installed Electron process, collect renderer failures and retain evidence before teardown. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'

export async function inspectInstalledUi(check) {
  const [executable, homeArgument, outputArgument] = process.argv.slice(2)
  if (!executable || !homeArgument || !outputArgument) throw new Error('Expected executable, private home and evidence directory')
  const home = resolve(homeArgument), output = resolve(outputArgument)
  await mkdir(home, { recursive: true })
  await mkdir(output, { recursive: true })
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/iu.test(name)))
  delete env.ELECTRON_RUN_AS_NODE
  const redact = value => String(value).replace(/token=[^\s&"']+/giu, 'token=[redacted]')
  const log = [], errors = [], networkFailures = [], observers = [], pendingRequests = new Map()
  let app, page, failure
  async function waitForPageAssets(window) {
    await window.waitForLoadState('load', { timeout: 60_000 })
    await window.waitForFunction(() => document.fonts.status === 'loaded'
      && [...document.images].every(image => image.complete), null, { timeout: 20_000 })
  }
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
      const request = request => pendingRequests.set(request, { url: redact(request.url()), resourceType: request.resourceType() })
      const requestfinished = request => pendingRequests.delete(request)
      const requestfailed = request => {
        pendingRequests.delete(request)
        networkFailures.push({ kind: 'requestfailed', url: redact(request.url()),
          error: redact(request.failure()?.errorText), resourceType: request.resourceType(), window: redact(window.url()) })
      }
      const events = { pageerror, console: consoleError, response, request, requestfinished, requestfailed }
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
    await page.locator('body[data-tpcowork-ui]').waitFor({ timeout: 60_000 })
    await waitForPageAssets(page)
    page.setDefaultTimeout(20_000)
    await check(page)
    await waitForPageAssets(page)
  } catch (error) {
    failure = error
  } finally {
    const windows = []
    if (app) {
      for (const window of app.windows()) {
        try {
          windows.push(await window.evaluate(async () => ({ url: location.protocol + '//' + location.host + location.pathname,
            title: document.title, text: document.body?.innerText,
            productAppearance: document.body?.hasAttribute('data-tpcowork-ui'),
            productModules: window.__DSH_BOOT__?.entries?.filter(entry => entry.id.startsWith('@tpcowork/')).map(entry => entry.id) })))
          await captureWindow(window, join(output, `window-${windows.length}.png`))
        } catch (error) { log.push(`Window evidence: ${redact(error)}`) }
      }
      let profile
      try { profile = JSON.parse(await readFile(join(home, 'profiles/desktop/package.json'), 'utf8')) }
      catch (error) { log.push(`Profile evidence: ${redact(error)}`) }
      app.removeAllListeners('window')
      for (const { window, events } of observers) {
        for (const [event, listener] of Object.entries(events)) window.off(event, listener)
      }
      if (!failure) {
        try { assert.deepEqual([...errors], [], 'Installed renderer reported errors') }
        catch (error) { failure = error }
      }
      const pendingNetwork = [...pendingRequests.values()]
      try {
        await writeFile(join(output, 'report.json'), JSON.stringify({ passed: !failure, error: failure && redact(failure.stack), windows, profile, errors, networkFailures, pendingNetwork, log }, null, 2) + '\n')
        console.log(JSON.stringify({ windows, profile, errors, networkFailures, pendingNetwork }, null, 2))
      } finally {
        const timer = setTimeout(() => app.process().kill(), 10_000)
        try { await app.close() } finally { clearTimeout(timer) }
      }
    } else {
      await writeFile(join(output, 'report.json'), JSON.stringify({ passed: false, error: redact(failure?.stack), windows, errors, log }, null, 2) + '\n')
    }
  }
  if (failure) throw failure
}
