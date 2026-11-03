import { registerHooks } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = join(root, 'artifacts/usage-stats')

it('opens Usage stats under Data and statistics with the reference layout', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => hooks.deregister())
  const scaffold = await launchWebScaffold({
    profile: { hmr: false, packages: ['tpcowork-ui', 'tpcowork-usage'].map(name => ({ dir: join(root, 'plugins', name), enabled: true })) },
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch({ executablePath: process.env.TPCOWORK_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  // Existing profiles have finished the first-run guide; first-run-guide.spec.mjs covers it.
  await page.addInitScript(() => localStorage.setItem('tpcowork.first-run-guide.v1', 'done'))
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await mkdir(artifacts, { recursive: true })
  await page.goto(scaffold.authenticatedUrl)
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  const profile = page.getByRole('button', { name: /账号菜单/ })
  expect(await profile.locator('[data-icon="user"]').count()).toBe(1)
  expect(await profile.locator('.tpcowork-profile-avatar').evaluate(node => getComputedStyle(node).cornerShape)).toBe('round')
  await profile.click()
  const usageEntry = page.getByRole('menuitem', { name: '使用统计', exact: true })
  await usageEntry.waitFor()
  expect(await usageEntry.locator('[data-icon="chart-column"]').count()).toBe(1)
  await page.screenshot({ path: join(artifacts, 'account-usage-menu.png'), fullPage: true })
  await usageEntry.click()
  const nav = dialog.getByRole('button', { name: '使用统计', exact: true })
  expect(await nav.getAttribute('aria-current')).toBe('true')
  const usage = dialog.locator('[data-tpcowork-usage]')
  await usage.waitFor()
  // The row sits under 数据与统计 with the bar chart icon, and the page draws its own title beside the App usage pill.
  const grouped = await nav.evaluate(button => {
    const heading = [...button.parentElement.children].find(node => node.textContent === '数据与统计')
    return { headingOrder: Number(heading?.style.order), rowOrder: Number(button.style.order), icon: button.querySelector('svg')?.dataset.tpcoworkNavIcon }
  })
  expect(grouped.icon).toBe('usage')
  expect(grouped.rowOrder).toBeGreaterThan(grouped.headingOrder)
  expect(await usage.locator('.tpu-title').textContent()).toBe('使用统计')
  expect(await usage.locator('.tpu-pill').textContent()).toBe('应用用量')
  expect(await dialog.evaluate(panel => [...panel.querySelectorAll('*')].filter(node => getComputedStyle(node, '::before').content.includes('使用统计')).length)).toBe(0)
  // A fresh profile has no usage: the lifetime strip reads zero and both charts show the empty state.
  await expect.poll(() => usage.locator('.tpu-summary-value').allTextContents()).toEqual(['0', '0', '0 分钟', '0 天', '0 天'])
  expect(await usage.locator('.tpu-heatmap-column').count()).toBe(52)
  expect(await usage.getByRole('tab', { name: '近 7 日' }).getAttribute('aria-selected')).toBe('true')
  expect(await usage.locator('.tpu-empty-title').allTextContents()).toEqual(['还没有可展示的数据', '还没有可展示的数据'])
  // The palette layer resolves for both modes.
  expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--tpu-chart-1').trim())).toBe('#0b7fff')
  await usage.getByRole('tab', { name: '近 30 日' }).click()
  await expect.poll(() => usage.getByRole('tab', { name: '近 30 日' }).getAttribute('aria-selected')).toBe('true')
  await page.screenshot({ path: join(artifacts, 'usage.png'), fullPage: true })
  // Reopening shows the last numbers at once, as the reference does, while a fresh snapshot loads quietly.
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await profile.click()
  await page.getByRole('menuitem', { name: '使用统计', exact: true }).click()
  const reopened = await usage.evaluate(node => ({ values: [...node.querySelectorAll('.tpu-summary-value')].map(item => item.textContent),
    loading: node.textContent.includes('正在统计中'), selected: node.querySelector('[role=tab][aria-selected=true]')?.textContent }))
  expect(reopened).toEqual({ values: ['0', '0', '0 分钟', '0 天', '0 天'], loading: false, selected: '每日' })
  await dialog.getByRole('button', { name: '通用设置', exact: true }).click()
  await dialog.locator('.tpcowork-settings-footer').getByRole('button', { name: /账号菜单/ }).click()
  await page.getByRole('menuitem', { name: '使用统计', exact: true }).click()
  await usage.waitFor()
  await usage.getByRole('button', { name: /刷新/ }).click()
  await expect.poll(() => usage.locator('.tpu-summary-value').allTextContents()).toEqual(['0', '0', '0 分钟', '0 天', '0 天'])
  expect(errors).toEqual([])
})
