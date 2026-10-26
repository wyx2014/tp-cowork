import { registerHooks } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'
import { connectFreshWorkspaceZh } from '../../../deepseek-harness/apps/web/tests/support.ts'
import { artifactPeers } from '../../plugins/tpcowork-toolbox/tests/artifact-peers.mjs'
import { npmCli } from '../package-command.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

it('keeps the packaged desktop default off with a model key and preserves an explicit opt-in after reload', async () => {
  const requireUrls = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => requireUrls.deregister())
  const peers = await artifactPeers()
  onTestFinished(() => peers.deregister())
  const packaged = await mkdtemp(join(tmpdir(), 'tpcowork-packaged-defaults-'))
  onTestFinished(() => rm(packaged, { recursive: true, force: true }))
  const run = promisify(execFile)
  const { stdout } = await run(process.execPath, [npmCli(), 'pack', '--ignore-scripts', '--json', '--pack-destination', packaged], {
    cwd: join(root, 'plugins/tpcowork-ui'),
  })
  await run('tar', ['-xzf', join(packaged, JSON.parse(stdout)[0].filename), '-C', packaged])
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [join(root, '../deepseek-harness/apps/web/tests/pin-browse-picker.overlay.yml')],
    profile: { hmr: false, packages: [{ dir: join(packaged, 'package'), enabled: true }] },
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch({ executablePath: process.env.TPCOWORK_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  page.setDefaultTimeout(20000)
  await page.addInitScript(() => {
    window.dshDesktop = {}
    window.dshOnboarding = { hasApiKey: async () => true }
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const settings = () => scaffold.ctx.settings.describe().find(row => row.ns === 'ui-settings').value
  const onboarding = () => scaffold.ctx.settings.describe().find(row => row.ns === 'ui-settings-account').value
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  await expect.poll(() => onboarding().step).toBe('done')
  expect(settings().enabled).toBe(false)
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  const openSettings = () => page.getByRole('button', { name: '设置', exact: true }).click()
  const toggle = dialog.getByRole('switch', { name: '开发者模式', exact: true })
  await openSettings()
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
  expect(await dialog.getByRole('button', { name: 'Agent 预设', exact: true }).count()).toBe(0)
  await toggle.click()
  await expect.poll(() => settings().enabled).toBe(true)
  await page.reload()
  await page.locator('[data-conversation-content]').first().waitFor()
  await openSettings()
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
  expect(await dialog.getByRole('button', { name: 'Agent 预设', exact: true }).count()).toBe(1)
  expect(errors).toEqual([])
})

it('offers preset controls only in Developer mode and preserves existing task compositions', async () => {
  const requireUrls = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => requireUrls.deregister())
  const peers = await artifactPeers()
  onTestFinished(() => peers.deregister())
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
  const output = join(root, 'artifacts/preset-mode')
  await mkdir(output, { recursive: true })
  onTestFinished(async () => {
    if (page.isClosed()) return
    await page.screenshot({ path: join(output, 'last.png'), fullPage: true })
    await writeFile(join(output, 'page.txt'), await page.locator('body').innerText())
    await writeFile(join(output, 'errors.json'), JSON.stringify(errors, null, 2))
  })
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  const presetControls = page.locator('[data-slot="conversation.hero.agentPreset"] button')
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  const openSettings = () => page.getByRole('button', { name: '设置', exact: true }).click()
  const closeSettings = () => settings.getByRole('button', { name: '关闭', exact: true }).last().click()
  const toggle = settings.getByRole('switch', { name: '开发者模式', exact: true })
  const defaultPreset = () => scaffold.ctx.agentPresets.defaultId
  const sessionId = () => page.locator('[data-conversation-content]').first().getAttribute('data-conversation-session')

  await openSettings()
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
  expect(await settings.getByRole('button', { name: 'Agent 预设', exact: true }).count()).toBe(0)
  expect(await presetControls.count()).toBe(0)
  expect(defaultPreset()).toBe('standard')
  await page.screenshot({ path: join(output, 'ordinary-settings.png'), fullPage: true })

  await toggle.click()
  await settings.getByRole('button', { name: 'Agent 预设', exact: true }).click()
  for (const name of ['标准模式', 'PTC 模式', '极简模式', '创造模式']) {
    expect(await settings.getByRole('button', { name: `查看配置: ${name}`, exact: true }).count()).toBe(1)
  }
  await settings.getByRole('button', { name: '设为新任务默认: 创造模式', exact: true }).click()
  await expect.poll(defaultPreset).toBe('cordis')
  await closeSettings()
  await page.getByRole('button', { name: '创造模式', exact: true }).waitFor()
  const existingId = await sessionId()
  const existing = scaffold.ctx.agents.list().find(agent => agent.id === existingId)
  expect(scaffold.ctx.agentPresets.composedPreset(existing.ctx)).toBe('cordis')

  await openSettings()
  await settings.getByRole('button', { name: '通用设置', exact: true }).click()
  await toggle.click()
  await expect.poll(defaultPreset).toBe('standard')
  expect(await settings.getByRole('button', { name: 'Agent 预设', exact: true }).count()).toBe(0)
  await closeSettings()
  expect(await presetControls.count()).toBe(0)
  expect(scaffold.ctx.agentPresets.composedPreset(existing.ctx)).toBe('cordis')

  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await expect.poll(sessionId).not.toBe(existingId)
  const nextId = await sessionId()
  const next = scaffold.ctx.agents.list().find(agent => agent.id === nextId)
  expect(scaffold.ctx.agentPresets.composedPreset(next.ctx)).toBe('standard')
  expect(scaffold.ctx.tools.schemas(next).map(tool => tool.name)).toEqual(expect.arrayContaining(['skill', 'subagent', 'schedule_create']))
  await page.reload()
  await page.locator('[data-conversation-content]').first().waitFor()
  await openSettings()
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
  expect(await settings.getByRole('button', { name: 'Agent 预设', exact: true }).count()).toBe(0)
  await toggle.click()
  await settings.getByRole('button', { name: 'Agent 预设', exact: true }).click()
  await settings.getByRole('button', { name: '新任务默认: 标准模式', exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'developer-settings.png'), fullPage: true })
  expect(errors).toEqual([])
})
