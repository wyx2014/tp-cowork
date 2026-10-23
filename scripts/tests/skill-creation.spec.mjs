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

it('prepares AI skill creation with a readable skill reference and editable instructions', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => hooks.deregister())
  const peers = await artifactPeers()
  onTestFinished(() => peers.deregister())
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [join(root, '../deepseek-harness/apps/web/tests/pin-browse-picker.overlay.yml')],
    profile: { hmr: false, packages: ['tpcowork-ui', 'tpcowork-toolbox'].map(name => ({ dir: join(root, 'plugins', name), enabled: true })) },
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch({ executablePath: process.env.TPCOWORK_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const output = join(root, 'artifacts/skill-creation')
  await mkdir(output, { recursive: true })
  onTestFinished(async () => {
    await page.screenshot({ path: join(output, 'last.png'), fullPage: true })
    await writeFile(join(output, 'page.txt'), await page.locator('body').innerText())
    await writeFile(join(output, 'errors.json'), JSON.stringify(errors, null, 2))
  })
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  await page.getByRole('button', { name: '专家 · 技能 · 连接器', exact: true }).click()
  await page.getByTestId('toolbox-tab-skills').click()
  await page.getByRole('button', { name: 'AI 创建技能', exact: true }).click()
  const input = page.locator('[data-composer-input][contenteditable="true"]').first()
  await input.getByText('技能创建与优化', { exact: true }).waitFor()
  expect(await input.innerText()).toContain('协助我创建一个新的 TP Cowork 技能')
  expect(await input.innerText()).not.toContain('/skill-creator')
  expect(await input.locator('[data-reference-ref]').first().getAttribute('data-reference-ref')).toContain('skill-creator')
  expect(await input.getAttribute('contenteditable')).toBe('true')
  expect(errors).toEqual([])
})
