import { registerHooks } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = join(root, 'artifacts/shortcut-settings')

it('matches the shortcut table geometry and keycap typography in both themes', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => hooks.deregister())
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [join(root, '../deepseek-harness/apps/web/tests/pin-browse-picker.overlay.yml')],
    profile: { hmr: false, packages: [{ dir: join(root, 'plugins/tpcowork-ui'), enabled: true }] },
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch({ executablePath: process.env.TPCOWORK_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  // Existing profiles have finished the first-run guide; first-run-guide.spec.mjs covers it.
  await page.addInitScript(() => localStorage.setItem('tpcowork.first-run-guide.v1', 'done'))
  page.setDefaultTimeout(20000)
  await mkdir(artifacts, { recursive: true })
  await page.goto(scaffold.authenticatedUrl)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  await dialog.getByRole('button', { name: '键盘快捷键', exact: true }).click()
  await page.locator('.tpcowork-kbd').first().waitFor()
  const reset = await page.getByRole('button', { name: '全部恢复默认', exact: true }).boundingBox()
  const search = await page.getByRole('searchbox', { name: '搜索快捷键', exact: true }).boundingBox()
  expect(reset.x + reset.width).toBeLessThan(search.x)
  expect(search.width).toBe(256)
  expect(reset.height).toBe(28)
  const toolbar = await page.evaluate(() => {
    const reset = document.querySelector('.tpcowork-shortcut-bar > button')
    const input = document.querySelector('.tpcowork-shortcut-input')
    return { gap: getComputedStyle(reset).gap, icon: reset.querySelector('svg').getBoundingClientRect().width,
      radius: getComputedStyle(input).borderRadius, font: getComputedStyle(input).fontFamily,
      sectionGap: getComputedStyle(document.querySelector('.tpcowork-shortcuts')).gap }
  })
  expect(toolbar.gap).toBe('4px')
  expect(toolbar.icon).toBe(14)
  expect(toolbar.radius).toBe('12px')
  expect(toolbar.font).not.toContain('monospace')
  expect(toolbar.sectionGap).toBe('24px')
  for (const dark of [false, true]) {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await page.waitForFunction(value => document.body.hasAttribute('data-ds-dark-theme') === value, dark)
    const styles = await page.evaluate(() => {
      const kbd = document.querySelector('.tpcowork-kbd')
      const input = document.querySelector('.tpcowork-shortcut-input')
      const row = document.querySelector('.tpcowork-shortcut-row')
      const style = getComputedStyle(kbd)
      return { font: style.fontFamily, height: kbd.getBoundingClientRect().height,
        width: kbd.getBoundingClientRect().width, inputHeight: input.getBoundingClientRect().height,
        inputBg: getComputedStyle(input).backgroundColor, rowHeight: row.getBoundingClientRect().height }
    })
    expect(styles.font).toContain('sans-serif')
    expect(styles.height).toBe(16)
    expect(styles.width).toBeGreaterThanOrEqual(16)
    expect(styles.inputHeight).toBe(36)
    expect(styles.inputBg).toBe(dark ? 'rgb(43, 43, 43)' : 'rgb(255, 255, 255)')
    expect(styles.rowHeight).toBe(54)
    await page.screenshot({ path: join(artifacts, dark ? 'dark.png' : 'light.png'), fullPage: true })
  }
  await page.getByRole('searchbox', { name: '搜索快捷键', exact: true }).fill('no-matching-shortcut-xyz')
  expect(await page.getByRole('status').last().innerText()).toBe('没有匹配的命令')
  await page.getByRole('button', { name: '清除搜索', exact: true }).click()
  expect(await page.getByRole('searchbox', { name: '搜索快捷键', exact: true }).inputValue()).toBe('')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'))
  // The supplied 1984px reference has a 256px search rendered at approximately 1.65x.
  await page.setViewportSize({ width: 1200, height: 772 })
  const reference = await page.evaluate(() => {
    const table = document.querySelector('.tpcowork-shortcut-table').getBoundingClientRect()
    const input = document.querySelector('.tpcowork-shortcut-input').getBoundingClientRect()
    return { width: table.width, left: table.x, top: table.y, inputRight: input.right, tableRight: table.right, sidebarRight: document.querySelector('[data-shortcut-modal="settings"] > nav').getBoundingClientRect().right }
  })
  expect(reference.width).toBe(832)
  expect(reference.left - reference.sidebarRight).toBe(1200 - 4 - reference.tableRight)
  expect(reference.inputRight).toBe(reference.tableRight)
  await page.screenshot({ path: join(artifacts, 'reference-layout.png'), fullPage: true })
  await page.setViewportSize({ width: 600, height: 900 })
  const narrow = await page.evaluate(() => {
    const bar = document.querySelector('.tpcowork-shortcut-bar').getBoundingClientRect()
    const input = document.querySelector('.tpcowork-shortcut-input').getBoundingClientRect()
    const reset = document.querySelector('.tpcowork-shortcut-bar > button').getBoundingClientRect()
    return { width: input.width, barWidth: bar.width, inputY: input.y, resetBottom: reset.bottom }
  })
  expect(narrow.width).toBe(narrow.barWidth)
  expect(narrow.inputY).toBeGreaterThan(narrow.resetBottom)
  await page.screenshot({ path: join(artifacts, 'narrow.png'), fullPage: true })
})
