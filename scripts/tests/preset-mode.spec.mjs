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

async function seedSignedInProfile(page) {
  await page.addInitScript(() => {
    localStorage.setItem('tpcowork.first-run-guide.v1', 'done')
    window.dshDesktop = { tpcoworkHub: {
      state: async () => ({ status: 'signed_in', phase: 'idle', user: { id: 'preset-fixture', username: 'fixture' } }),
      subscribe: () => () => {},
    } }
  })
}

it('keeps Developer mode off in the packaged desktop with a model key and hides its entry after reload', async () => {
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
  await seedSignedInProfile(page)
  page.setDefaultTimeout(20000)
  await page.addInitScript(() => { window.dshOnboarding = { hasApiKey: async () => true } })
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
  expect(await toggle.count()).toBe(0)
  expect(await dialog.getByRole('button', { name: 'Agent 预设', exact: true }).count()).toBe(0)
  await page.reload()
  await page.locator('[data-conversation-content]').first().waitFor()
  await openSettings()
  expect(settings().enabled).toBe(false)
  expect(await toggle.count()).toBe(0)
  expect(await dialog.getByRole('button', { name: 'Agent 预设', exact: true }).count()).toBe(0)
  expect(errors).toEqual([])
})

it('clears legacy Developer mode while preserving existing task compositions', async () => {
  const requireUrls = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => requireUrls.deregister())
  const peers = await artifactPeers()
  onTestFinished(() => peers.deregister())
  const scaffold = await launchWebScaffold({
    developerTools: true,
    extraOverlayPath: [join(root, '../deepseek-harness/apps/web/tests/pin-browse-picker.overlay.yml')],
    profile: { hmr: false, packages: [{ dir: join(root, 'plugins/tpcowork-ui'), enabled: true }] },
  })
  onTestFinished(() => scaffold.close())
  const developerEnabled = () => scaffold.ctx.settings.describe().find(row => row.ns === 'ui-settings').value.enabled
  expect(developerEnabled()).toBe(true)
  const legacyResponse = await scaffold.hostFetch('/api/session/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request', rpcId: 'legacy-creator-session', method: 'session/create',
      payload: { args: { request: { cwd: scaffold.workspaceCwd, agentPreset: 'cordis' } } },
    }),
  })
  const { result: legacy } = await legacyResponse.json()
  expect(legacy).toMatchObject({ ok: true, value: { agentPreset: 'cordis' } })
  const existing = scaffold.ctx.agents.get(legacy.value.sessionId)
  expect(scaffold.ctx.agentPresets.composedPreset(existing.ctx)).toBe('cordis')
  const browser = await chromium.launch({ executablePath: process.env.TPCOWORK_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  await seedSignedInProfile(page)
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
  await expect.poll(developerEnabled).toBe(false)
  const presetControls = page.locator('[data-slot="conversation.hero.agentPreset"] button')
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  const openSettings = () => page.getByRole('button', { name: '设置', exact: true }).click()
  const closeSettings = () => settings.getByRole('button', { name: '返回工作区', exact: true }).click()
  const toggle = settings.getByRole('switch', { name: '开发者模式', exact: true })
  const defaultPreset = () => scaffold.ctx.agentPresets.defaultId
  const sessionId = () => page.locator('[data-conversation-content]').first().getAttribute('data-conversation-session')

  await openSettings()
  expect(await toggle.count()).toBe(0)
  expect(await settings.getByRole('button', { name: 'Agent 预设', exact: true }).count()).toBe(0)
  expect(await presetControls.count()).toBe(0)
  expect(defaultPreset()).toBe('standard')
  await page.screenshot({ path: join(output, 'ordinary-settings.png'), fullPage: true })

  await closeSettings()
  expect(scaffold.ctx.agentPresets.composedPreset(existing.ctx)).toBe('cordis')
  const previousId = await sessionId()
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await expect.poll(sessionId).not.toBe(previousId)
  const nextId = await sessionId()
  const next = scaffold.ctx.agents.list().find(agent => agent.id === nextId)
  expect(scaffold.ctx.agentPresets.composedPreset(next.ctx)).toBe('standard')
  expect(scaffold.ctx.tools.schemas(next).map(tool => tool.name)).toEqual(expect.arrayContaining(['skill', 'subagent', 'schedule_create']))
  expect(errors).toEqual([])
})
