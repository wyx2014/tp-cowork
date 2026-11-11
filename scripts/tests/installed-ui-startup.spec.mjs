import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'
import { observeInstalledStartup, openInstalledSettings } from '../installed-ui-checks.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

it('waits for a delayed startup baseline before opening settings on an existing profile', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => hooks.deregister())
  const scaffold = await launchWebScaffold({ profile: { hmr: true,
    packages: [{ dir: join(root, 'plugins/tpcowork-ui'), enabled: true }] } })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch({ executablePath: process.env.TPCOWORK_TEST_CHROME
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ locale: 'en-US' })
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => {
    localStorage.setItem('tpcowork.first-run-guide.v1', 'skipped')
    globalThis.dshDesktop = {}
    const entries = performance.getEntriesByType.bind(performance)
    performance.getEntriesByType = type => type === 'resource' ? [] : entries(type)
  })
  const intercepted = Promise.withResolvers()
  const release = Promise.withResolvers()
  onTestFinished(() => release.resolve())
  await page.route('**/api/session/list', async route => {
    const response = await route.fetch()
    intercepted.resolve()
    await release.promise
    await route.fulfill({ response })
  })
  const startup = observeInstalledStartup(page)
  await page.goto(scaffold.authenticatedUrl)
  await page.locator('body[data-tpcowork-ui]').waitFor()
  await intercepted.promise
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  let settingsClicks = 0
  await page.exposeFunction('recordSettingsClick', () => { settingsClicks++ })
  await page.getByRole('button', { name: 'Settings', exact: true })
    .evaluate(button => button.addEventListener('click', () => { void window.recordSettingsClick() }))
  const opening = openInstalledSettings(page, startup)
  // Hold the first list response while the rest of the interface is already interactive.
  await page.waitForTimeout(250)
  expect(settingsClicks).toBe(0)
  const baseline = page.waitForResponse('**/api/session/list')
  release.resolve()
  await baseline
  await opening
  await page.waitForTimeout(250)
  expect(await settings.isVisible()).toBe(true)
  expect(settingsClicks).toBe(1)
  await settings.getByRole('switch', { name: 'Developer mode', exact: true }).waitFor()
})
