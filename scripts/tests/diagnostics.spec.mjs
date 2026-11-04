import { registerHooks } from 'node:module'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = join(root, 'artifacts/diagnostics')
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

it('keeps masked Host log files in a real DSH Host and exports from General settings through the desktop bridge', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => hooks.deregister())
  const scaffold = await launchWebScaffold({
    profile: { hmr: false, packages: ['tpcowork-ui', 'tpcowork-diagnostics'].map(name => ({ dir: join(root, 'plugins', name), enabled: true })) },
  })
  onTestFinished(() => scaffold.close())

  // Host half: the real Host's own records reach $DSH_HOME/logs/host, secrets masked.
  const logs = join(scaffold.harnessHome, 'logs', 'host')
  scaffold.ctx.logger('probe').warn('hub call failed: Authorization: Bearer hub-secret-token-value')
  const files = await readdir(logs)
  expect(files).toEqual(expect.arrayContaining([`dsh-${today()}.log`, `dsh-${today()}.error.log`]))
  const all = await readFile(join(logs, `dsh-${today()}.log`), 'utf8')
  expect(all).toMatch(/^--- TP Cowork Host pid \d+ /u)
  expect(all).toContain('[W] [probe] hub call failed: Authorization: Bearer ****')
  expect(all).not.toContain('hub-secret-token-value')
  // Start-up records logged before the plugin loaded are replayed from Cordis' buffer; host.spec.ts covers that, since
  // this scaffold silences the buffer's default level.

  const browser = await chromium.launch({ executablePath: process.env.TPCOWORK_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  await page.addInitScript(() => localStorage.setItem('tpcowork.first-run-guide.v1', 'done'))
  // The browser plugin's desktop payload, as the main process answers (desktop.spec.ts covers the main-process half).
  await page.addInitScript(() => {
    window.__diagnostics = []
    window.dshDesktop = { browserAutomation: { version: 1, subscribe: () => () => {}, request: async (op, payload) => {
      if (op === 'windowZoom') return { level: 0, min: -3, max: 5 }
      if (op !== 'diagnostics') throw new Error(`unexpected ${op}`)
      window.__diagnostics.push(payload)
      await new Promise(resolve => setTimeout(resolve, 300))
      return { status: 'exported', path: '/tmp/diagnostics-1.zip' }
    } } }
  })
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await mkdir(artifacts, { recursive: true })
  await page.goto(scaffold.authenticatedUrl)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.getByRole('button', { name: '通用设置', exact: true }).click()
  const exportButton = settings.getByRole('button', { name: '导出…', exact: true })
  await exportButton.scrollIntoViewIfNeeded()
  await expect.poll(() => settings.getByText('诊断信息', { exact: true }).count()).toBe(1)
  // It is the last row of the last card, after the guide row.
  const order = await settings.locator('.tpcowork-setting-title').allTextContents()
  expect(order.slice(-2)).toEqual(['新手引导', '诊断信息'])
  await page.screenshot({ path: join(artifacts, 'general-diagnostics-row.png') })
  await exportButton.click()
  await settings.getByRole('button', { name: '正在导出…', exact: true }).waitFor()
  await settings.getByRole('button', { name: '导出…', exact: true }).waitFor()
  expect(await page.evaluate(() => window.__diagnostics)).toEqual([{ action: 'export', locale: 'zh' }])
  expect(errors).toEqual([])
})
