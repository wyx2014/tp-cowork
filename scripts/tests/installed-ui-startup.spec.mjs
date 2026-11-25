import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'
import { observeInstalledStartup, openInstalledSettings } from '../installed-ui-checks.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

it('keeps the Windows and Linux caption usable above the signed-out view', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => hooks.deregister())
  const scaffold = await launchWebScaffold({ profile: { hmr: false,
    packages: [{ dir: join(root, 'plugins/tpcowork-ui'), enabled: true }] } })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch({ executablePath: process.env.TPCOWORK_TEST_CHROME
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ locale: 'en-US' })
  await page.addInitScript(() => {
    window.dshDesktop = { tpcoworkHub: {
      state: async () => ({ status: 'signed_out', phase: 'idle' }),
      subscribe: () => () => {},
    } }
  })
  const modal = page.locator('.tpcowork-login-modal')
  const card = page.locator('.tpcowork-login-card')
  const login = page.getByRole('button', { name: 'Get started' })
  for (const [colorScheme, width, height] of [['light', 1280, 820], ['dark', 520, 600]]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme })
    await page.goto(scaffold.authenticatedUrl)
    await login.waitFor()
    await page.evaluate(() => {
      // Match the shared desktop preload's caption host and shadow DOM focus behavior.
      document.documentElement.setAttribute('data-windows-titlebar', '')
      document.documentElement.style.setProperty('--dsh-windows-titlebar-height', '40px')
      const host = document.createElement('div')
      host.setAttribute('data-windows-menu', '')
      host.style.cssText = 'position:fixed;top:0;left:var(--dsh-windows-menu-start);height:40px;z-index:1100;align-content:center'
      const button = document.createElement('button')
      button.textContent = 'Application'
      button.addEventListener('click', () => { host.dataset.testOpened = '' })
      host.attachShadow({ mode: 'open' }).append(button)
      document.body.append(host)
    })
    const menu = page.getByRole('button', { name: 'Application', exact: true })
    await expect.poll(async () => (await modal.boundingBox())?.y).toBe(40)
    expect((await modal.boundingBox())?.height).toBe(height - 40)
    const rect = await card.boundingBox()
    expect(rect.y + rect.height / 2).toBeCloseTo((height + 40) / 2, 0)
    await menu.click()
    expect(await page.locator('[data-windows-menu][data-test-opened]').count()).toBe(1)
    await login.focus()
    await page.keyboard.press('Tab')
    expect(await menu.evaluate(button => button.getRootNode().activeElement === button)).toBe(true)
    await page.keyboard.press('Shift+Tab')
    expect(await login.evaluate(button => document.activeElement === button)).toBe(true)
    expect(await page.locator('#root[hidden][inert]').count()).toBe(1)

    await page.evaluate(() => document.documentElement.setAttribute('data-fullscreen', ''))
    await expect.poll(async () => (await modal.boundingBox())?.y).toBe(0)
    expect((await modal.boundingBox())?.height).toBe(height)
    expect(await menu.isVisible()).toBe(false)
    await page.evaluate(() => document.documentElement.removeAttribute('data-fullscreen'))
    await expect.poll(async () => (await modal.boundingBox())?.y).toBe(40)
    expect(await menu.isVisible()).toBe(true)
  }
})

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
    globalThis.dshDesktop = { tpcoworkHub: {
      state: async () => ({ status: 'signed_in', phase: 'idle', user: { id: 'startup-fixture', username: 'fixture' } }),
      subscribe: () => () => {},
    } }
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
  await settings.getByRole('button', { name: 'General', exact: true }).waitFor()
  expect(await settings.getByRole('switch', { name: 'Developer mode', exact: true }).count()).toBe(0)
})
