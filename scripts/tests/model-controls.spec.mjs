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
