import { registerHooks } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = join(root, 'artifacts/interface-zoom')

it('zooms the whole interface from the account menu and Command +, - and 0, like the reference product', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => hooks.deregister())
  const scaffold = await launchWebScaffold({
    profile: { hmr: false, packages: [{ dir: join(root, 'plugins/tpcowork-ui'), enabled: true }] },
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
  // The desktop payload's windowZoom operation, as the main process answers it (verified separately in Electron).
  await page.addInitScript(() => {
    let level = 1
    window.__zoomCalls = []
    window.dshDesktop = { browserAutomation: { version: 1, subscribe: () => () => {}, request: async (op, payload) => {
      if (op !== 'windowZoom') throw new Error(`unexpected ${op}`)
      window.__zoomCalls.push(payload.action)
      level = payload.action === 'reset' ? 0 : Math.max(-3, Math.min(5, level + ({ in: 1, out: -1 }[payload.action] ?? 0)))
      return { level, min: -3, max: 5 }
    } } }
  })
  await page.goto(scaffold.authenticatedUrl)
  const zoomFactor = () => page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--tpcowork-zoom')))
  // The saved level is applied at start.
  await expect.poll(zoomFactor).toBeCloseTo(1.1)

  const profile = page.getByRole('button', { name: /账号菜单/ })
  await profile.click()
  const trigger = page.getByRole('menuitem', { name: '界面缩放' })
  await trigger.hover()
  const zoomIn = page.getByRole('menuitem', { name: /^放大/ })
  await zoomIn.waitFor()
  const rows = await page.locator('[role=menuitem]').evaluateAll(items => items.map(item => ({ text: item.textContent, disabled: item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('disabled') })))
  const row = name => rows.find(entry => entry.text.startsWith(name))
  expect(row('放大')).toMatchObject({ disabled: false })
  expect(row('放大').text).toContain('=')
  expect(row('缩小').text).toContain('-')
  expect(row('实际大小')).toMatchObject({ disabled: false })
  expect(row('实际大小').text).toContain('0')
  await page.screenshot({ path: join(artifacts, 'menu.png') })
  await zoomIn.click()
  await expect.poll(zoomFactor).toBeCloseTo(1.21)

  // The keys step the zoom in order; DSH's text-size handler sees them as already handled.
  const prevented = await page.evaluate(() => new Promise(resolve => {
    window.addEventListener('keydown', event => resolve(event.defaultPrevented), { once: true })
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Minus', key: '-', metaKey: true, cancelable: true, bubbles: true }))
  }))
  expect(prevented).toBe(true)
  await expect.poll(zoomFactor).toBeCloseTo(1.1)
  await page.keyboard.press('Meta+Equal')
  await expect.poll(zoomFactor).toBeCloseTo(1.21)
  await page.keyboard.press('Meta+Digit0')
  await expect.poll(zoomFactor).toBeCloseTo(1)
  expect(await page.evaluate(() => window.__zoomCalls)).toEqual(['get', 'in', 'out', 'in', 'reset'])

  // At actual size the reset row is disabled.
  await profile.click()
  await page.getByRole('menuitem', { name: '界面缩放' }).hover()
  await page.getByRole('menuitem', { name: /^实际大小/ }).waitFor()
  expect(await page.getByRole('menuitem', { name: /^实际大小/ }).evaluate(item => item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('disabled'))).toBe(true)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // The keys are listed read-only under Menus on the shortcuts page.
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  await dialog.getByRole('button', { name: '键盘快捷键', exact: true }).click()
  await dialog.getByText('实际大小', { exact: true }).waitFor()
  const listed = await dialog.evaluate(panel => ['放大', '缩小', '实际大小'].map(name => {
    const cell = [...panel.querySelectorAll('*')].find(node => node.children.length === 0 && node.textContent === name)
    return cell?.closest('tr, [role=row]')?.textContent ?? null
  }))
  for (const text of listed) expect(text).toContain('菜单')
  await page.screenshot({ path: join(artifacts, 'shortcuts.png') })
  expect(errors).toEqual([])
})
