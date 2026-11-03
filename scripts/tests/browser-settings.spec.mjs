import { registerHooks } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = join(root, 'artifacts/browser-settings')

it('uses the ZCode globe icon in the real browser settings navigation', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => hooks.deregister())
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [join(root, '../deepseek-harness/apps/web/tests/pin-browse-picker.overlay.yml')],
    profile: { hmr: false, packages: [
      { dir: join(root, 'plugins/tpcowork-ui'), enabled: true },
      { dir: join(root, 'plugins/tpcowork-browser'), enabled: true },
    ] },
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch({ executablePath: process.env.TPCOWORK_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  // Existing profiles have finished the first-run guide; first-run-guide.spec.mjs covers it.
  await page.addInitScript(() => localStorage.setItem('tpcowork.first-run-guide.v1', 'done'))
  page.setDefaultTimeout(20000)
  await page.goto(scaffold.authenticatedUrl)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const button = page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '浏览器控制', exact: true })
  await button.click()
  const icon = button.locator('svg')
  await page.waitForFunction(() => document.querySelector('svg[data-tpcowork-nav-icon="browser"]'))
  const mask = await icon.evaluate(node => getComputedStyle(node).maskImage)
  expect(mask).not.toBe('none')
  expect(decodeURIComponent(mask)).toContain('<circle cx="12" cy="12" r="10"')
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ path: join(artifacts, 'navigation-globe.png'), fullPage: true })
})
