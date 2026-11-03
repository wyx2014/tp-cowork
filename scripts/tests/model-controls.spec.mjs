import { registerHooks } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'
import { connectFreshWorkspaceZh } from '../../../deepseek-harness/apps/web/tests/support.ts'
import { artifactPeers } from '../../plugins/tpcowork-toolbox/tests/artifact-peers.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = join(root, 'artifacts/model-controls')

it('replaces the composer model seat with the combined model and effort picker', async () => {
  const requireUrls = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => requireUrls.deregister())
  const hook = await artifactPeers()
  onTestFinished(() => hook.deregister())
  await mkdir(artifacts, { recursive: true })
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [join(root, '../deepseek-harness/apps/web/tests/pin-browse-picker.overlay.yml')],
    // The replay catalog declares reasoning levels for the vision model; this fixture records no model calls.
    replayFixture: join(root, '../deepseek-harness/snapshots/web/plan-narrow-viewport/session.v3.jsonl'),
    replayProvidersOnly: true,
    profile: { hmr: false, packages: ['tpcowork-ui', 'tpcowork-toolbox', 'tpcowork-experts']
      .map(name => ({ dir: join(root, 'plugins', name), enabled: true })) },
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch({ executablePath: process.env.TPCOWORK_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  // Existing profiles have finished the first-run guide; first-run-guide.spec.mjs covers it.
  await page.addInitScript(() => localStorage.setItem('tpcowork.first-run-guide.v1', 'done'))
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  const controls = page.locator('[data-tpcowork-model-controls]')
  await controls.waitFor()
  const model = page.locator('[data-tpcowork-model-trigger]')
  await expect.poll(() => model.textContent()).toContain('DeepSeek-V4-Flash')
  const modelBox = await model.boundingBox()
  await model.click()
  const menu = page.locator('[data-tpcowork-model-menu]')
  await menu.waitFor()
  await expect.poll(() => menu.evaluate(element => getComputedStyle(element).visibility)).toBe('visible')
  // The 288px menu opens above the trigger, centered on it, and the trigger reads "Select model" meanwhile.
  const menuBox = await menu.boundingBox()
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(modelBox.y)
  expect(Math.round(menuBox.width)).toBe(288)
  expect(await model.textContent()).toBe('选择模型')
  expect(await menu.getByTestId('composer-provider-trigger').textContent()).toContain('API')
  // The provider submenu opens beside the menu (right, or left when the right lacks room), inside the window, so
  // other providers can be clicked.
  await menu.getByTestId('composer-provider-trigger').click()
  const providers = page.locator('[data-composer-provider-list]')
  await expect.poll(() => providers.evaluate(element => getComputedStyle(element).visibility)).toBe('visible')
  const providersBox = await providers.boundingBox()
  expect(providersBox.x >= menuBox.x + menuBox.width || providersBox.x + providersBox.width <= menuBox.x).toBe(true)
  expect(providersBox.x).toBeGreaterThanOrEqual(0)
  expect(providersBox.x + providersBox.width).toBeLessThanOrEqual(page.viewportSize().width)
  expect(providersBox.y).toBeGreaterThanOrEqual(0)
  const crossProviderGap = async () => {
    const parent = await menu.boundingBox()
    const trigger = await menu.getByTestId('composer-provider-trigger').boundingBox()
    const child = await providers.boundingBox()
    const leftSide = child.x < parent.x
    const gapX = leftSide ? (child.x + child.width + parent.x) / 2 : (parent.x + parent.width + child.x) / 2
    const y = trigger.y + trigger.height / 2
    await page.mouse.move(trigger.x + trigger.width / 2, y)
    await page.mouse.move(gapX, y, { steps: 16 })
    await page.waitForTimeout(400)
    expect(await providers.isVisible()).toBe(true)
    const target = await providers.getByRole('menuitemradio').first().boundingBox()
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 16 })
    await page.waitForTimeout(400)
    expect(await providers.isVisible()).toBe(true)
    const alignment = await providers.getByRole('menuitemradio').evaluateAll(rows => rows.map(row => {
      const icon = row.querySelector('.tpcowork-provider-logo').getBoundingClientRect()
      const label = row.querySelector('.tpcowork-menu-label').getBoundingClientRect()
      return Math.abs(icon.y + icon.height / 2 - label.y - label.height / 2)
    }))
    expect(alignment.every(delta => delta < 1)).toBe(true)
  }
  await crossProviderGap()
  await page.screenshot({ path: join(artifacts, 'provider-menu-hover.png'), fullPage: true })
  await page.mouse.move(menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height - 8)
  await providers.waitFor({ state: 'hidden' })
  // Pin the parent near the right edge to exercise the real left-opening geometry.
  await menu.evaluate(node => { node.style.left = `${window.innerWidth - node.offsetWidth - 16}px` })
  await menu.getByTestId('composer-provider-trigger').hover()
  await providers.waitFor()
  await expect.poll(async () => (await providers.boundingBox()).x < (await menu.boundingBox()).x).toBe(true)
  await crossProviderGap()
  await page.screenshot({ path: join(artifacts, 'provider-menu-left-hover.png'), fullPage: true })
  await page.mouse.move(10, 10)
  await providers.waitFor({ state: 'hidden' })
  await menu.evaluate((node, left) => { node.style.left = `${left}px` }, menuBox.x)
  // Escape from the row closes the whole menu; open it again for the model checks.
  await page.keyboard.press('Escape')
  await expect.poll(() => menu.count()).toBe(0)
  await model.click()
  await menu.waitFor()
  // A model without levels has no effort section; choosing one with levels adds it without closing the menu.
  expect(await page.getByTestId('composer-thought-slider').count()).toBe(0)
  await menu.getByRole('menuitemradio', { name: /Vision-Exp/ }).click()
  const slider = page.getByTestId('composer-thought-slider')
  await expect.poll(() => slider.count()).toBe(1)
  await expect.poll(() => page.getByTestId('composer-thought-value').textContent()).toBe('高')
  expect(await menu.getByRole('menuitemradio', { name: /Vision-Exp/ }).textContent()).toContain('视觉')
  await page.screenshot({ path: join(artifacts, 'menu-high.png'), clip: { x: menuBox.x - 24, y: menuBox.y - 24, width: 340, height: menuBox.height + 120 } })
  // The slider takes the keyboard; the greatest level fills with the gradient and its bubbles.
  await slider.focus()
  await page.keyboard.press('End')
  await expect.poll(() => page.getByTestId('composer-thought-value').textContent()).toBe('最高')
  await page.getByTestId('composer-thought-bubbles').waitFor()
  await page.waitForTimeout(600)
  const maxBox = await menu.boundingBox()
  await page.screenshot({ path: join(artifacts, 'menu-max.png'), clip: { x: maxBox.x - 24, y: maxBox.y - 24, width: 340, height: maxBox.height + 120 } })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(artifacts, 'menu-max-dark.png'), clip: { x: maxBox.x - 24, y: maxBox.y - 24, width: 340, height: maxBox.height + 120 } })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.keyboard.press('Escape')
  await expect.poll(() => menu.count()).toBe(0)
  await expect.poll(() => model.getAttribute('aria-label')).toBe('DeepSeek-V4-Flash-Vision-Exp 最高')
  // The cycle shortcut (Control+T on desktop, Command+Option+T in a macOS browser) wraps past the greatest level.
  await page.locator('[data-composer-input]').first().click()
  await page.keyboard.press('Meta+Alt+KeyT')
  await expect.poll(() => model.getAttribute('aria-label')).toBe('DeepSeek-V4-Flash-Vision-Exp 关闭')
  await page.keyboard.press('Meta+Alt+KeyT')
  await expect.poll(() => model.getAttribute('aria-label')).toBe('DeepSeek-V4-Flash-Vision-Exp 低')
  // The level is the Session's saved selection, so it survives a reload.
  await page.reload()
  await expect.poll(() => page.locator('[data-tpcowork-model-trigger]').getAttribute('aria-label')).toBe('DeepSeek-V4-Flash-Vision-Exp 低')
  const card = await page.locator('[data-composer-card]').first().boundingBox()
  await page.screenshot({ path: join(artifacts, 'composer.png'), clip: { x: card.x - 8, y: card.y - 8, width: card.width + 16, height: card.height + 16 } })
  // Narrow rows collapse the trigger to the model glyph and the fill meter.
  await page.setViewportSize({ width: 400, height: 860 })
  await page.locator('[data-model-compact]').first().waitFor()
  await expect.poll(() => page.locator('.tpcowork-thought-meter').evaluate(element => getComputedStyle(element).display)).not.toBe('none')
  expect(await page.locator('.tpcowork-composer-thought-label').evaluate(element => getComputedStyle(element).display)).toBe('none')
  await page.screenshot({ path: join(artifacts, 'composer-400.png') })
  expect(errors).toEqual([])
})
