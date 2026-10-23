import { registerHooks } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = join(root, 'artifacts/model-settings')

it('offers only custom API creation and preserves the saved endpoint and models after reload', async () => {
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
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await mkdir(artifacts, { recursive: true })
  onTestFinished(async () => {
    await writeFile(join(artifacts, 'page.txt'), await page.locator('body').innerText())
    await writeFile(join(artifacts, 'errors.json'), JSON.stringify(errors, null, 2))
    await page.screenshot({ path: join(artifacts, 'last.png'), fullPage: true })
  })
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  const openModels = async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await dialog.getByRole('button', { name: '模型', exact: true }).click()
    await dialog.getByRole('button', { name: '添加自定义模型 API', exact: true }).waitFor()
  }
  await page.goto(scaffold.authenticatedUrl)
  await openModels()
  expect(await dialog.getByRole('button', { name: '添加模型提供商', exact: true }).count()).toBe(0)
  await dialog.getByRole('button', { name: '添加自定义模型 API', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Provider ID', exact: true }).waitFor()
  expect(await dialog.getByRole('tablist', { name: '添加方式' }).count()).toBe(0)
  expect(await dialog.getByText('第三方模型提供商', { exact: true }).count()).toBe(0)
  expect(await dialog.getByRole('combobox', { name: '提供商', exact: true }).count()).toBe(0)
  await expect(await dialog.ariaSnapshot()).toMatchFileSnapshot('./expected/model-settings-custom-api.aria.txt')
  await page.screenshot({ path: join(artifacts, 'custom-api.png'), fullPage: true })
  await dialog.getByRole('textbox', { name: 'Provider ID', exact: true }).fill('tp-custom-api')
  await dialog.getByRole('textbox', { name: '显示名称', exact: true }).fill('自定义 API 测试')
  await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).fill('https://example.test/v1')
  await dialog.getByRole('combobox', { name: 'API 协议', exact: true }).selectOption('openai-completions')
  await dialog.getByLabel('API 密钥', { exact: true }).fill('sk-test-custom-api')
  await dialog.getByRole('button', { name: '添加模型', exact: true }).click()
  await dialog.getByRole('textbox', { name: '模型 ID 1', exact: true }).fill('test-model')
  await dialog.getByRole('button', { name: '创建提供商', exact: true }).click()
  const editName = '编辑 自定义 API 测试 (tp-custom-api)'
  await dialog.getByRole('button', { name: editName, exact: true }).waitFor()
  await page.reload()
  await openModels()
  await dialog.getByRole('button', { name: editName, exact: true }).click()
  await dialog.getByText('自定义设置', { exact: true }).click()
  expect(await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).inputValue()).toBe('https://example.test/v1')
  expect(await dialog.getByRole('textbox', { name: '模型 ID 1', exact: true }).inputValue()).toBe('test-model')
  expect(await dialog.getByRole('combobox', { name: 'API 协议', exact: true }).inputValue()).toBe('openai-completions')
  await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).fill('https://example.test/custom/v1')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.getByText('已保存 自定义 API 测试 (tp-custom-api)。', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: editName, exact: true }).click()
  await dialog.getByText('自定义设置', { exact: true }).click()
  expect(await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).inputValue()).toBe('https://example.test/custom/v1')
  expect(errors).toEqual([])
})
