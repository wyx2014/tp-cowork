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
const artifacts = join(root, 'artifacts/home-layout')

it('lays out the home as one centered column: greeting, workspace row, composer and suggestions share a left edge', async () => {
  const requireUrls = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => requireUrls.deregister())
  const hook = await artifactPeers()
  onTestFinished(() => hook.deregister())
  await mkdir(artifacts, { recursive: true })
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [join(root, '../deepseek-harness/apps/web/tests/pin-browse-picker.overlay.yml')],
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
  const suggestions = page.locator('[data-testid="task-suggestions"]')
  await suggestions.waitFor()
  // Entrance: the greeting fades in, then the workspace row and composer, then the suggestions.
  const entrance = () => page.evaluate(() => document.getAnimations()
    .filter(animation => animation.animationName === 'tpcowork-home-enter')
    .map(animation => [animation.effect.target.className.split(' ')[0].replace(/^_?(\w+?)_.*/, '$1'), animation.effect.getTiming().delay]))
  const settled = () => page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.animationName === 'tpcowork-home-enter').map(animation => animation.finished)))
  expect((await entrance()).map(([, delay]) => delay).sort((a, b) => a - b)).toEqual([0, 120, 120, 240])
  expect((await entrance()).find(([, delay]) => delay === 0)[0]).toBe('tpcowork-hero-greeting')
  // It waits under the startup cover and starts as the cover fades.
  const greetingPlayState = () => page.locator('.tpcowork-hero-greeting').evaluate(element => getComputedStyle(element).animationPlayState)
  await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<div id="dsh-startup"></div>'); document.body.classList.remove('dsh-startup-ready') })
  expect(await greetingPlayState()).toBe('paused')
  await page.evaluate(() => { document.body.classList.add('dsh-startup-ready') })
  expect(await greetingPlayState()).toBe('running')
  await page.evaluate(() => { document.getElementById('dsh-startup').remove() })
  // Reduced motion shows the home at once.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await entrance()).toEqual([])
  expect(await page.locator('.tpcowork-hero-greeting').evaluate(element => getComputedStyle(element).opacity)).toBe('1')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await settled()
  await page.mouse.move(0, 0)
  const box = selector => page.locator(selector).first().boundingBox()
  const greeting = await box('.tpcowork-greeting')
  const card = await box('[data-composer-input]')
  const list = await suggestions.boundingBox()
  const pane = await box('[data-conversation-content]')
  // The greeting sits just above the workspace row, on the composer card's left edge.
  const cardEdge = () => page.locator('[data-composer-input]').first().evaluate(element => element.closest('[class*="_card"]').getBoundingClientRect().x)
  expect(Math.abs(greeting.x - await cardEdge())).toBeLessThan(1)
  expect(card.y).toBeGreaterThan(greeting.y + greeting.height + 40)
  expect(card.y).toBeLessThan(greeting.y + greeting.height + 160)
  // Workspace row, composer and suggestions share one centered column of 82% of the pane, at most 880px.
  // Centered within the scroll body's client area, which excludes its scrollbar gutter.
  const center = await page.locator('[data-conversation-scroll]').first()
    .evaluate(element => element.getBoundingClientRect().x + element.clientWidth / 2)
  expect(Math.abs(list.x + list.width / 2 - center)).toBeLessThan(1)
  expect(list.width).toBeGreaterThan(pane.width * 0.6)
  expect(list.width).toBeLessThanOrEqual(880)
  expect(await page.locator('.tpcowork-greeting-subtitle').textContent()).toBe('以专业AI赋能规范工作')
  await suggestions.evaluate(element => { element.hidden = true })
  expect(Math.abs((await box('[data-composer-input]')).y - card.y)).toBeLessThan(1)
  await suggestions.evaluate(element => { element.hidden = false })
  await page.screenshot({ path: join(artifacts, 'home-light.png') })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: join(artifacts, 'home-dark.png') })
  await page.emulateMedia({ colorScheme: 'light' })
  // The greeting starts on the composer card's edge, and the workspace chip and suggestions keep fixed offsets from
  // it at every width, macOS full screen included.
  await page.evaluate(() => { document.documentElement.dataset.platform = 'darwin'; document.documentElement.setAttribute('data-fullscreen', '') })
  const offsets = []
  for (const width of [1280, 1512, 1728, 2560]) {
    await page.setViewportSize({ width, height: 982 })
    const [heading, chip, cardEdge, item] = await page.evaluate(() => ['.tpcowork-greeting', '[class*="heroWorkspaceRow"] button', '[data-composer-input]', '.tp-task-suggestions li']
      .map(selector => document.querySelector(selector))
      .map(element => (element.matches('[data-composer-input]') ? element.closest('[class*="_card"]') : element).getBoundingClientRect().x))
    expect(Math.abs(heading - cardEdge)).toBeLessThan(1)
    expect(chip).toBeGreaterThanOrEqual(cardEdge)
    expect(item).toBeGreaterThanOrEqual(cardEdge)
    offsets.push([Math.round(chip - cardEdge), Math.round(item - cardEdge)])
  }
  expect(new Set(offsets.map(String)).size).toBe(1)
  await page.setViewportSize({ width: 1512, height: 982 })
  await page.screenshot({ path: join(artifacts, 'fullscreen-1512.png') })
  await page.evaluate(() => { delete document.documentElement.dataset.platform; document.documentElement.removeAttribute('data-fullscreen') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  for (const viewport of [{ width: 1280, height: 778 }, { width: 1000, height: 640 }, { width: 390, height: 640 }]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    // The skyline's waterline sits at 49% of the column height; the card starts on the water, below the buildings.
    const column = await box('[data-conversation-content]')
    const top = (await box('[data-composer-input]')).y
    if (viewport.width > 600) expect(top).toBeGreaterThanOrEqual(column.y - 40 + (column.height + 40) * 0.49)
    await page.locator('[data-suggested-task]').last().scrollIntoViewIfNeeded()
    expect(await page.locator('[data-suggested-task]').last().isVisible()).toBe(true)
    await page.screenshot({ path: join(artifacts, `home-${viewport.width}.png`) })
  }
  expect(errors).toEqual([])
})
