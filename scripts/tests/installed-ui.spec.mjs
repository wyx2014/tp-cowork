import { registerHooks } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'
import { artifactPeers } from '../../plugins/tpcowork-toolbox/tests/artifact-peers.mjs'
import { finishFirstRunGuide, checkInstalledProductUi, observeInstalledStartup } from '../installed-ui-checks.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

it('checks required login before setup, then authenticated settings and reload in English and Chinese', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => hooks.deregister())
  const peers = await artifactPeers()
  onTestFinished(() => peers.deregister())
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [join(root, '../deepseek-harness/apps/web/tests/pin-browse-picker.overlay.yml')],
    profile: { hmr: true, packages: ['ui', 'browser', 'toolbox', 'automation', 'experts', 'memory', 'archives', 'usage']
      .map(name => ({ dir: join(root, 'plugins', `tpcowork-${name}`), enabled: true })) },
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch({ executablePath: process.env.TPCOWORK_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  onTestFinished(() => browser.close())
  const output = join(root, 'artifacts/installed-ui')
  await mkdir(output, { recursive: true })
  for (const locale of ['en-US', 'zh-CN']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, locale })
    onTestFinished(() => context.close())
    await context.addInitScript(() => {
      const listeners = new Set()
      let signedIn = sessionStorage.getItem('installed-ui-signed-in') === 'true'
      const state = () => ({ status: signedIn ? 'signed_in' : 'signed_out', phase: 'idle',
        ...(signedIn ? { user: { id: 'installed-ui-fixture', username: 'fixture' } } : {}) })
      window.dshDesktop = { tpcoworkHub: {
        state: async () => state(),
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
      } }
      // This browser fixture supplies the same safe account bridge; no product authentication bypass is installed.
      window.signInFixture = () => {
        signedIn = true
        sessionStorage.setItem('installed-ui-signed-in', 'true')
        for (const listener of listeners) listener(state())
      }
    })
    const page = await context.newPage()
    page.setDefaultTimeout(20000)
    let startup = observeInstalledStartup(page)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('dialog', { name: locale === 'en-US' ? 'Welcome to TP Cowork' : '欢迎来到 TP Cowork' }).waitFor()
    await finishFirstRunGuide(page)
    expect(await checkInstalledProductUi(page, { startup,
      capture: name => page.screenshot({ path: join(output, `${locale}-${name}.png`) }) })).toEqual({ authenticated: false })
    await page.evaluate(() => window.signInFixture())
    const guide = page.locator('.tpcowork-guide[role="dialog"]')
    await guide.waitFor()
    expect(await guide.getAttribute('aria-label')).toBe(locale === 'en-US' ? 'Set up TP Cowork' : '设置 TP Cowork')
    await finishFirstRunGuide(page)
    expect(await guide.count()).toBe(0)
    expect(await checkInstalledProductUi(page, { startup,
      capture: name => page.screenshot({ path: join(output, `${locale}-${name}.png`) }) })).toEqual({ authenticated: true })
    await page.screenshot({ path: join(output, `${locale}-first-launch.png`) })
    startup = observeInstalledStartup(page)
    await page.reload()
    await page.locator('body[data-tpcowork-ui]').waitFor()
    await finishFirstRunGuide(page)
    expect(await guide.count()).toBe(0)
    expect(await checkInstalledProductUi(page, { startup })).toEqual({ authenticated: true })
    expect(errors).toEqual([])
    await context.close()
  }
})
