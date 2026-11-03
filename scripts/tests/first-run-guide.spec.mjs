import { registerHooks } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = join(root, 'artifacts/first-run-guide')

it('walks a fresh install through DSH Desktop-style setup once, applies each choice, and reopens from General', async () => {
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, locale: 'zh-CN' })
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await mkdir(artifacts, { recursive: true })
  await page.goto(scaffold.authenticatedUrl)
  // Found by its class: its accessible name follows the language chosen inside it.
  const guide = page.locator('.tpcowork-guide[role=dialog]')
  await guide.waitFor()
  expect(await guide.getAttribute('aria-label')).toBe('设置 TP Cowork')
  const progress = () => guide.locator('.tpcowork-guide-progress > span').textContent()
  const shot = name => page.screenshot({ path: join(artifacts, `${name}.png`) })

  expect(await guide.getByRole('heading', { level: 1 }).textContent()).toBe('欢迎使用 TP Cowork')
  expect(await guide.locator('.tpcowork-guide-badge').textContent()).toMatch(/^预览版 · v/)
  expect(await guide.locator('.tpcowork-guide-card-value').textContent()).toBe('界面语言 · 界面主题 · 界面字号 · 使用场景 · 工作过程')
  expect(await progress()).toBe('1 / 7')
  expect(await guide.getByRole('button', { name: '上一步' }).count()).toBe(0)
  await shot('1-welcome')
  await guide.getByRole('button', { name: '开始设置' }).click()

  // Language applies at once: choosing English turns the guide itself into English.
  expect(await progress()).toBe('2 / 7')
  expect(await guide.getByRole('radio', { name: /系统默认/ }).count()).toBe(1)
  const languages = await guide.locator('input[name="tpcowork-guide-language"]').evaluateAll(inputs => inputs.map(input => input.value))
  const english = languages.find(id => id.startsWith('en'))
  const chinese = languages.find(id => id.startsWith('zh'))
  await guide.locator(`input[value="${english}"]`).check()
  await expect.poll(() => guide.getByRole('heading', { level: 1 }).textContent()).toBe('Choose a language')
  await shot('2-language-en')
  await guide.locator(`input[value="${chinese}"]`).check()
  await expect.poll(() => guide.getByRole('heading', { level: 1 }).textContent()).toBe('选择界面语言')
  await guide.getByRole('button', { name: '下一步' }).click()

  // Theme applies at once; 上一步 returns with the choice kept.
  expect(await progress()).toBe('3 / 7')
  await guide.getByText('深色', { exact: true }).click()
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'))
  await shot('3-theme-dark')
  await guide.getByRole('button', { name: '上一步' }).click()
  expect(await guide.locator(`input[value="${chinese}"]`).isChecked()).toBe(true)
  await guide.getByRole('button', { name: '下一步' }).click()
  expect(await guide.locator('input[value="dark"]').isChecked()).toBe(true)
  await guide.getByRole('button', { name: '下一步' }).click()

  // 界面字号 moves all interface text, the guide included.
  expect(await progress()).toBe('4 / 7')
  expect(await guide.locator('input[value="14"]').isChecked()).toBe(true)
  const title = guide.getByText('标准 · 14px')
  const before = await title.evaluate(node => parseFloat(getComputedStyle(node).fontSize))
  await guide.getByText('大 · 16px').click()
  await page.waitForFunction(() => document.body.style.getPropertyValue('--dsh-content-font-size') === '16px')
  expect(await title.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(before + 2)
  await shot('4-font')
  await guide.getByRole('button', { name: '下一步' }).click()

  // What TP Cowork is for: the product default is 办公与创作 (Developer mode off); 代码与开发 turns it on with the
  // detailed usage readout, as DSH's own onboarding does.
  const saved = ns => scaffold.ctx.settings.describe().find(row => row.ns === ns)?.value ?? {}
  expect(await progress()).toBe('5 / 7')
  expect(await guide.getByRole('heading', { level: 1 }).textContent()).toBe('你希望 TP Cowork 帮你做什么？')
  expect(await guide.locator('input[value="office"]').isChecked()).toBe(true)
  await guide.getByText('代码与开发', { exact: true }).click()
  await expect.poll(() => [saved('ui-settings').enabled, saved('ui-chat').performanceUsage]).toEqual([true, 'detailed'])
  await shot('5-purpose')
  await guide.getByText('办公与创作', { exact: true }).click()
  await expect.poll(() => [saved('ui-settings').enabled, saved('ui-chat').performanceUsage]).toEqual([false, 'compact'])
  await guide.getByRole('button', { name: '下一步' }).click()

  // How much of the work to show is the chat transcript view.
  expect(await progress()).toBe('6 / 7')
  expect(await guide.getByRole('heading', { level: 1 }).textContent()).toBe('你希望看到多少工作过程？')
  await guide.getByText('聚焦结果', { exact: true }).click()
  await expect.poll(() => saved('ui-chat').transcriptView).toBe('compact')
  await expect.poll(() => guide.locator('input[value="compact"]').isChecked()).toBe(true)
  await shot('6-process')
  await guide.getByRole('button', { name: '下一步' }).click()

  expect(await progress()).toBe('7 / 7')
  expect(await guide.getByRole('heading', { level: 1 }).textContent()).toBe('设置完成')
  expect(await guide.getByRole('button', { name: '跳过设置' }).count()).toBe(0)
  await shot('7-done')
  await guide.getByRole('button', { name: '开始使用' }).click()
  await guide.waitFor({ state: 'detached' })
  expect(await page.evaluate(() => localStorage.getItem('tpcowork.first-run-guide.v1'))).toBe('done')

  // Shown once: a reload goes straight to the app, with the choices kept.
  await page.reload()
  await page.getByRole('button', { name: '设置', exact: true }).waitFor()
  expect(await guide.count()).toBe(0)
  expect(await page.evaluate(() => [document.body.hasAttribute('data-ds-dark-theme'), document.body.style.getPropertyValue('--dsh-content-font-size')])).toEqual([true, '16px'])

  // Reopen from General settings, then skip with confirmation.
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.getByRole('button', { name: '通用设置', exact: true }).click()
  await settings.getByRole('button', { name: '重新打开', exact: true }).click()
  await guide.waitFor()
  expect(await progress()).toBe('1 / 7')
  await guide.getByRole('button', { name: '跳过设置' }).click()
  const confirm = page.getByRole('dialog', { name: '跳过设置？' })
  await confirm.waitFor()
  await page.waitForTimeout(400)
  await shot('8-skip-confirm')
  await confirm.getByRole('button', { name: '继续设置' }).click()
  expect(await guide.isVisible()).toBe(true)
  await guide.getByRole('button', { name: '跳过设置' }).click()
  await confirm.getByRole('button', { name: '跳过设置' }).click()
  await guide.waitFor({ state: 'detached' })
  expect(await page.evaluate(() => localStorage.getItem('tpcowork.first-run-guide.v1'))).toBe('skipped')
  expect(errors).toEqual([])
})
