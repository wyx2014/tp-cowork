import { registerHooks } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'
import { connectFreshWorkspaceZh } from '../../../deepseek-harness/apps/web/tests/support.ts'
import { artifactPeers } from '../../plugins/tpcowork-toolbox/tests/artifact-peers.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = join(root, 'artifacts/sidebar-navigation')

it('navigates native pages and sessions and keeps the lowered home usable across window sizes', async () => {
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
  const consoleMessages = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleMessages.push(message.text()) })
  onTestFinished(async () => {
    if (page.isClosed()) return
    await writeFile(join(artifacts, 'errors.json'), JSON.stringify(errors, null, 2))
    await writeFile(join(artifacts, 'console.json'), JSON.stringify(consoleMessages, null, 2))
    await writeFile(join(artifacts, 'overlay.html'), await page.locator('[data-shell-overlay]').evaluateAll(elements => elements.map(element => element.innerHTML).join('\n')))
    await writeFile(join(artifacts, 'page.txt'), await page.locator('body').innerText())
    await page.screenshot({ path: join(artifacts, 'last.png'), fullPage: true })
  })
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  const back = page.getByRole('button', { name: '后退', exact: true })
  const forward = page.getByRole('button', { name: '前进', exact: true })
  await back.waitFor()
  const content = page.locator('[data-conversation-content]').first()
  const session = () => content.getAttribute('data-conversation-session')
  const first = await session()
  expect(first).toBeTruthy()
  await page.getByRole('button', { name: '专家 · 技能 · 连接器', exact: true }).click()
  await page.locator('section.tp-toolbox').waitFor()
  expect(await back.isEnabled()).toBe(true)
  expect(await forward.isEnabled()).toBe(false)
  await back.click()
  await expect.poll(session).toBe(first)
  expect(await forward.isEnabled()).toBe(true)
  await forward.click()
  await page.locator('section.tp-toolbox').waitFor()
  await back.click()
  await expect.poll(session).toBe(first)
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await expect.poll(session).not.toBe(first)
  const second = await session()
  expect(await forward.isEnabled()).toBe(false)
  await back.click()
  await expect.poll(session).toBe(first)
  await forward.click()
  await expect.poll(session).toBe(second)
  await page.locator('[data-testid="task-suggestions"]').waitFor()
  const box = () => page.locator('[data-composer-input]').first().boundingBox()
  const before = await box()
  expect(before.y).toBeGreaterThan(340)
  await page.locator('[data-testid="task-suggestions"]').evaluate(element => { element.hidden = true })
  expect(Math.abs((await box()).y - before.y)).toBeLessThan(1)
  await page.locator('[data-testid="task-suggestions"]').evaluate(element => { element.hidden = false })
  await page.screenshot({ path: join(artifacts, 'home-light.png'), fullPage: true })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: join(artifacts, 'home-dark.png'), fullPage: true })
  await page.emulateMedia({ colorScheme: 'light' })
  for (const viewport of [{ width: 1000, height: 600 }, { width: 390, height: 540 }]) {
    await page.setViewportSize(viewport)
    await page.locator('[data-suggested-task]').last().scrollIntoViewIfNeeded()
    expect(await page.locator('[data-suggested-task]').last().isVisible()).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: join(artifacts, `home-${viewport.width}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '专家 · 技能 · 连接器', exact: true }).click()
  await page.locator('section.tp-toolbox').waitFor()
  await page.keyboard.press('Meta+Alt+BracketLeft')
  await content.waitFor()
  await page.keyboard.press('Meta+Alt+BracketRight')
  await page.locator('section.tp-toolbox').waitFor()
  await back.click()
  await content.waitFor()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.locator('[data-shortcut-modal="settings"]').waitFor()
  await page.keyboard.press('Meta+Alt+BracketLeft')
  await page.locator('[data-shortcut-modal="settings"]').waitFor({ state: 'hidden' })
  // Switch only the renderer chrome; retain Web's real keyboard service and storage.
  await page.evaluate(() => { document.documentElement.dataset.platform = 'darwin' })
  const toggle = page.getByRole('button', { name: '收起侧边栏', exact: true })
  await toggle.click()
  await page.locator('[data-shell-leading] .tpcowork-navigation').waitFor()
  expect(await back.isVisible()).toBe(true)
  await forward.click()
  await page.locator('section.tp-toolbox').waitFor()
  await page.screenshot({ path: join(artifacts, 'mac-collapsed.png'), fullPage: true })
  await page.evaluate(() => document.documentElement.setAttribute('data-fullscreen', ''))
  await page.screenshot({ path: join(artifacts, 'mac-fullscreen.png'), fullPage: true })
  await page.locator('[data-shell-leading]').getByRole('button', { name: '打开侧边栏', exact: true }).click()
  await toggle.waitFor()
  await page.evaluate(() => document.documentElement.removeAttribute('data-fullscreen'))
  await back.click()
  await content.waitFor()
  await page.screenshot({ path: join(artifacts, 'mac-expanded.png'), fullPage: true })
  await page.evaluate(() => {
    document.documentElement.dataset.platform = 'win32'
    document.documentElement.setAttribute('data-windows-titlebar', '')
    document.documentElement.style.setProperty('--dsh-windows-titlebar-height', '40px')
  })
  await toggle.click()
  await expect.poll(() => page.locator('[data-shell-leading]').count()).toBe(0)
  const navigationBox = await page.locator('.tpcowork-navigation').boundingBox()
  const newSessionBox = await page.getByRole('button', { name: '新建会话', exact: true }).first().boundingBox()
  expect(navigationBox.x + navigationBox.width).toBeLessThanOrEqual(newSessionBox.x)
  await page.screenshot({ path: join(artifacts, 'windows-collapsed.png'), fullPage: true })
  expect(errors).toEqual([])
  expect(consoleMessages).toEqual([])
})
