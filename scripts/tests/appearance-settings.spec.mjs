import { registerHooks } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = join(root, 'artifacts/appearance-settings')

it('moves appearance out of General and persists theme and independent font settings', async () => {
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
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(scaffold.authenticatedUrl)
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  const open = async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await dialog.getByRole('button', { name: '外观', exact: true }).click()
    await dialog.getByRole('button', { name: '界面主题', exact: true }).waitFor()
  }
  const homeFooter = await page.locator('.tpcowork-settings-launcher').evaluate(node => {
    const avatar = node.querySelector('.tpcowork-profile-avatar').getBoundingClientRect()
    const gear = node.querySelector('.tpcowork-settings-button').getBoundingClientRect()
    return { avatarX: avatar.x, avatarY: avatar.y, gearX: gear.x, gearY: gear.y }
  })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  expect(await dialog.getByRole('button', { name: '浅色', exact: true }).count()).toBe(0)
  expect(await dialog.getByRole('spinbutton').count()).toBe(0)
  await dialog.getByRole('button', { name: '外观', exact: true }).click()
  await dialog.getByRole('button', { name: '界面主题', exact: true }).click()
  for (const label of ['浅色', '深色', '跟随系统']) expect(await page.getByRole('menuitem', { name: label, exact: true }).locator('svg').count()).toBeGreaterThan(0)
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ path: join(artifacts, 'theme-options.png'), fullPage: true })
  await page.getByRole('menuitem', { name: '深色', exact: true }).click()
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'))
  const code = dialog.getByRole('spinbutton', { name: '代码字号', exact: true })
  await code.fill('14')
  await code.press('Enter')
  await page.waitForFunction(() => document.body.style.getPropertyValue('--dsh-code-font-size') === '14px')
  // 界面字号 moves all interface text by the same pixels, as in the reference product; icons, layout and code keep theirs.
  const uiSize = dialog.getByRole('spinbutton', { name: '界面字号', exact: true })
  expect(await uiSize.inputValue()).toBe('14')
  const navigation = dialog.getByRole('button', { name: '外观', exact: true })
  const measure = () => navigation.evaluate(node => ({ text: getComputedStyle(node).fontSize, icon: node.querySelector('svg').getBoundingClientRect().width,
    title: getComputedStyle(node.closest('[role=dialog]').querySelector('[class*="options"]'), '::before').fontSize }))
  const base = await measure()
  expect(base).toMatchObject({ text: '14px', title: '30px' })
  await uiSize.fill('18')
  await uiSize.press('Enter')
  await page.waitForFunction(() => document.body.style.getPropertyValue('--dsh-content-font-size') === '18px')
  expect(await measure()).toEqual({ text: '18px', icon: base.icon, title: '34px' })
  expect(await page.evaluate(() => document.body.style.getPropertyValue('--dsh-code-font-size'))).toBe('14px')
  await page.screenshot({ path: join(artifacts, 'interface-font-18.png'), fullPage: true })
  // The reference product's 12–20px range.
  await uiSize.fill('22')
  await uiSize.press('Enter')
  expect(await uiSize.inputValue()).toBe('18')
  await uiSize.fill('14')
  await uiSize.press('Enter')
  await page.waitForFunction(() => document.body.style.getPropertyValue('--dsh-content-font-size') === '14px')
  expect(await measure()).toEqual(base)
  await dialog.getByRole('button', { name: '界面主题', exact: true }).click()
  await page.getByRole('menuitem', { name: '浅色', exact: true }).click()
  await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'))
  await mkdir(artifacts, { recursive: true })
  const footer = dialog.locator('.tpcowork-settings-footer')
  expect(await footer.getByRole('button', { name: '设置', exact: true }).isVisible()).toBe(true)
  expect(await footer.innerText()).toContain('连接使用')
  const settingsFooter = await footer.evaluate(node => {
    const avatar = node.querySelector('.tpcowork-profile-avatar').getBoundingClientRect()
    const gear = node.querySelector('.tpcowork-settings-button').getBoundingClientRect()
    return { avatarX: avatar.x, avatarY: avatar.y, gearX: gear.x, gearY: gear.y }
  })
  expect(settingsFooter).toEqual(homeFooter)

  expect(await dialog.getByRole('heading', { name: '基础设置', exact: true }).isVisible()).toBe(true)
  const back = dialog.getByRole('button', { name: '返回工作区', exact: true })
  await back.hover()
  await page.getByRole('tooltip', { name: '返回工作区', exact: true }).waitFor()
  await page.screenshot({ path: join(artifacts, 'settings-sidebar.png'), fullPage: true })
  await page.mouse.move(900, 500)
  const appearanceNavigation = dialog.getByRole('button', { name: '外观', exact: true })
  await appearanceNavigation.hover()
  const navigationHint = page.getByRole('tooltip', { name: '外观', exact: true })
  await navigationHint.waitFor()
  const hintBox = await navigationHint.boundingBox()
  const navigationBox = await appearanceNavigation.boundingBox()
  expect(hintBox.x).toBeGreaterThanOrEqual(navigationBox.x + navigationBox.width)
  await page.mouse.move(900, 500)
  await navigationHint.waitFor({ state: 'hidden' })

  await page.screenshot({ path: join(artifacts, 'light.png'), fullPage: true })
  await page.reload()
  await open()
  expect(await dialog.getByRole('spinbutton', { name: '代码字号', exact: true }).inputValue()).toBe('14')
  expect(await dialog.getByRole('button', { name: '界面主题', exact: true }).innerText()).toBe('浅色')
  const icon = dialog.getByRole('button', { name: '外观', exact: true }).locator('svg')
  expect(await icon.getAttribute('data-tpcowork-nav-icon')).toBe('appearance')
  await footer.getByRole('button', { name: '设置', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await open()
  await page.setViewportSize({ width: 600, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.screenshot({ path: join(artifacts, 'narrow.png'), fullPage: true })
  expect(errors).toEqual([])
})
