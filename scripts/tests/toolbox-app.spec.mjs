/** Shipped Web shell and compiled toolbox/experts over real HTTP and WebSocket. */
import { createRequire, registerHooks } from 'node:module'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'
import { connectFreshWorkspaceZh } from '../../../deepseek-harness/apps/web/tests/support.ts'
import { artifactPeers } from '../../plugins/tpcowork-toolbox/tests/artifact-peers.mjs'
import { MockAdapter, textResponse, toolCallResponse } from '../../../deepseek-harness/packages/core/agent-loop/tests/mock-adapter.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = join(root, 'artifacts/toolbox-acceptance')
const toolbox = join(root, 'plugins/tpcowork-toolbox')
const requireToolbox = createRequire(join(toolbox, 'package.json'))
const migrated = JSON.parse(await readFile(join(root, 'docs/toolbox/skills-migrated.json'), 'utf8'))
const skillCount = migrated.skills.length

async function launchToolboxApp({ appearance = false, hubEndpoint = '' } = {}) {
  // requireBuilt uses require(ESM); Node's require resolver needs filesystem paths.
  const requireUrls = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => requireUrls.deregister())
  const hook = await artifactPeers()
  onTestFinished(() => hook.deregister())
  await mkdir(artifacts, { recursive: true })
  const personalSandbox = await mkdtemp(join(tmpdir(), 'toolbox-personal-skills-'))
  onTestFinished(() => rm(personalSandbox, { recursive: true, force: true }))
  const userRoot = join(personalSandbox, 'skills')
  await writeFile(join(personalSandbox, 'package.json'), JSON.stringify({ name: 'toolbox-personal-skills-fixture', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  // A bundle default keeps the test directory editable by the real settings service.
  await writeFile(join(personalSandbox, 'cordis.patch.yml'), JSON.stringify([{ id: 'tpcowork-toolbox', config: { skills: { userRoot }, tpcoworkhub: { endpoint: hubEndpoint, pageSize: 2 } } }]))
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [
      join(root, '../deepseek-harness/apps/web/tests/pin-browse-picker.overlay.yml'),
      // Explicit opt-in: exercises the Host OS opener on the local acceptance machine.
      ...(process.env.TPCOWORK_TEST_NATIVE_OPEN === '1' ? [join(root, '../deepseek-harness/apps/web/tests/fixtures/native-open-on.patch.yml')] : []),
    ],
    profile: {
      hmr: false,
      packages: [...['tpcowork-experts', 'tpcowork-toolbox', ...(appearance ? ['tpcowork-ui'] : [])].map(name => ({ dir: join(root, 'plugins', name), enabled: true })), { dir: personalSandbox, enabled: true }],
    },
  })
  onTestFinished(() => scaffold.close())
  const adapter = reportAdapter(scaffold.ctx)
  scaffold.ctx.llm.registerAdapter(['toolbox-acceptance'], adapter)
  scaffold.ctx.on('agent/disposed', async ({ agent }) => {
    await writeFile(join(artifacts, `${agent.id}.json`), JSON.stringify(agent.session.snapshotEvents(), null, 2))
  })
  scaffold.ctx.on('approval/request', () => Promise.resolve('allowed-once'), { prepend: true })
  await expect.poll(async () => {
    for (const runtime of scaffold.ctx.registry.values()) for (const fiber of runtime.fibers) await fiber.await()
    return (await scaffold.ctx.toolbox.describe()).modules
  }, { timeout: 30000 }).toEqual({ skills: true, installer: true, mcp: true, teams: true, tpcoworkhub: true })
  expect((await scaffold.ctx.toolboxTeams.inventory()).items).toHaveLength(2)
  const { chromium } = requireToolbox('playwright')
  const runtime = JSON.parse(await readFile(join(toolbox, 'runtime/playwright.json'), 'utf8'))
  const browserRoot = await mkdtemp(join(tmpdir(), 'toolbox-app-browser-'))
  const archive = join(toolbox, 'runtime', runtime.archive)
  expect(createHash('sha256').update(await readFile(archive)).digest('hex')).toBe(runtime.archiveSha256)
  await promisify(execFile)('tar', ['-xzf', archive, '-C', browserRoot])
  const browser = await chromium.launch({ executablePath: resolve(browserRoot, runtime.executable) })
  onTestFinished(async () => { await browser.close(); await rm(browserRoot, { recursive: true, force: true }) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  page.setDefaultTimeout(15000)
  const errors = []
  const traffic = []
  page.on('request', request => { if (/\/(submit|prompt|selectModel|prepareLocalImport|install)$/.test(new URL(request.url()).pathname)) traffic.push({ path: new URL(request.url()).pathname, body: request.postData() }) })
  page.on('requestfailed', request => traffic.push({ failed: new URL(request.url()).pathname, error: request.failure()?.errorText }))
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  onTestFinished(async () => {
    if (errors.length) console.error(errors)
    if (page.isClosed()) return
    await page.screenshot({ path: join(artifacts, 'toolbox-app.png'), fullPage: true })
    await writeFile(join(artifacts, 'toolbox-app.txt'), await page.locator('body').innerText())
    await writeFile(join(artifacts, 'ui-diagnostic.json'), JSON.stringify({ traffic, controls: await page.locator('[role=dialog] input, [role=dialog] button').evaluateAll(elements => elements.map(element => ({ tag: element.tagName, label: element.getAttribute('aria-label') ?? element.textContent, value: element.value, disabled: element.disabled }))), alerts: await page.evaluate(() => window.__acceptanceAlerts), editor: await page.locator('[data-composer-input]').evaluateAll(elements => elements.map(element => ({ phase: element.dataset.phase, lexical: element.__lexicalEditor?.getEditorState().toJSON() }))) }, null, 2))
    for (const session of scaffold.ctx.sessions.list()) {
      await writeFile(join(artifacts, `${session.id}.json`), JSON.stringify(session.snapshotEvents(), null, 2))
    }
  })
  await page.goto(scaffold.authenticatedUrl)
  await page.evaluate(() => {
    window.__acceptanceAlerts = []
    new MutationObserver(() => {
      for (const element of document.querySelectorAll('[role="alert"]')) if (!window.__acceptanceAlerts.includes(element.textContent)) window.__acceptanceAlerts.push(element.textContent)
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  await selectReports(page)
  await page.getByRole('button', { name: '专家 · 技能 · 连接器', exact: true }).click()
  const panel = page.locator('section.tp-toolbox')
  await panel.getByRole('heading', { name: '工具箱', exact: true }).waitFor()
  const tabs = panel.getByRole('navigation', { name: '工具箱' })
  expect(await tabs.getByRole('button').allTextContents()).toEqual(['专家团队', '技能', 'MCP', '技能商店'])
  await expect.poll(() => panel.locator('article').count()).toBe(2)
  expect((await scaffold.ctx.toolbox.describe()).modules).toEqual({ skills: true, installer: true, mcp: true, teams: true, tpcoworkhub: true })
  await page.screenshot({ path: join(artifacts, 'teams.png'), fullPage: true })

  return { scaffold, page, panel, tabs, adapter, errors, userRoot }
}

it('browses compact store rows, previews and installs skills, confirms updates and opens their personal folders', async () => {
  let version = 1
  const content = () => `---\nname: research-daily\ndescription: 整理研究材料和每日动态\n---\n# 研究简报\n这是版本 ${version} 的技能说明。\n`
  const metadata = () => ({ path: 'SKILL.md', size: Buffer.byteLength(content()), sha256: createHash('sha256').update(content()).digest('hex'), contentType: 'text/markdown' })
  const shared = { id: 'research', slug: 'research-daily', displayName: '每日研究', summary: '整理研究材料和每日动态', tags: ['深度研究', 'AI'], visibility: 'public', approvalStatus: 'approved' }
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
    const json = value => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)) }
    if (request.headers.authorization !== 'Bearer isolated-store-token') { response.statusCode = 401; json({ code: 401 }); return }
    if (request.url === '/tpcoworkapi/convex/query') {
      if (body.path === 'users:me') { json({ id: 'store-user', username: 'store-fixture' }); return }
      json({ isDone: true, page: [
        { skill: { ...shared, latestVersionId: `v${version}` } },
        { skill: { id: 'pending', slug: 'weekly-report', summary: '生成每周研究报告', tags: '办公, 报告', visibility: 'public', approvalStatus: 'pending' } },
        { skill: { id: 'rejected', slug: 'source-checker', summary: '核验资料来源', approvalStatus: 'rejected', visibility: 'private' } },
        { skill: { id: 'private', slug: 'private-draft', visibility: 'private', approvalStatus: 'approved' } },
      ] }); return
    }
    if (request.url === '/tpcoworkapi/skills/research') { json({ code: 200, data: { skill: shared, latestVersion: { id: `v${version}`, version: `${version}.0.0` }, files: [metadata()] } }); return }
    if (request.url === '/tpcoworkapi/skills/pending') { json({ code: 200, data: { skill: { id: 'pending', slug: 'weekly-report', description: '生成每周研究报告', approvalStatus: 'pending', visibility: 'public' }, latestVersion: null, files: [] } }); return }
    if (request.url.startsWith('/tpcoworkapi/skill-versions/files?')) { json({ code: 200, data: { ...metadata(), content: content() } }); return }
    response.statusCode = 404; json({ code: 404 })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  onTestFinished(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const { scaffold, page, panel, tabs, userRoot, errors } = await launchToolboxApp({ appearance: true, hubEndpoint: `http://127.0.0.1:${server.address().port}` })
  await scaffold.ctx.toolboxTpcoworkHub.acceptBrowserSession({ token: 'isolated-store-token' })
  await tabs.getByRole('button', { name: '技能商店', exact: true }).click()
  await panel.getByText('已登录', { exact: true }).waitFor()
  const cards = panel.locator('.tp-store-card')
  await expect.poll(() => cards.count()).toBe(2)
  await panel.getByText('审核中', { exact: true }).waitFor()
  expect(await panel.getByRole('button', { name: '下载到我的技能: /weekly-report', exact: true }).count()).toBe(0)
  await panel.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect.poll(() => cards.count()).toBe(3)
  await panel.getByText('已拒绝', { exact: true }).waitFor()
  expect(await panel.getByText('/private-draft', { exact: true }).count()).toBe(0)
  await panel.getByRole('button', { name: '详情: /weekly-report', exact: true }).click()
  await panel.getByText('未读取到技能内容', { exact: true }).waitFor()
  expect(await panel.getByRole('alert').count()).toBe(0)
  expect(await panel.getByRole('button', { name: '下载到我的技能', exact: true }).count()).toBe(0)
  await panel.getByRole('button', { name: '返回列表', exact: true }).click()
  const review = join(root, 'artifacts/skill-store-nanobot-20261019')
  await mkdir(review, { recursive: true })
  for (const width of [1440, 560, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(() => panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: join(review, `store-${width}.png`), fullPage: true, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(true)
  await page.screenshot({ path: join(review, 'store-dark.png'), fullPage: true, animations: 'disabled' })
  await page.emulateMedia({ colorScheme: 'light' })
  const search = panel.getByRole('searchbox', { name: '搜索名称或描述' })
  await search.fill('深度研究')
  await expect.poll(() => cards.count()).toBe(1)
  await panel.getByRole('button', { name: '详情: /research-daily', exact: true }).waitFor()
  const download = page.waitForResponse(response => new URL(response.url()).pathname === '/api/toolboxTpcoworkHub/install')
  await panel.getByRole('button', { name: '下载到我的技能: /research-daily', exact: true }).click()
  expect((await (await download).json()).result).toMatchObject({ ok: true, value: { state: 'installed' } })
  await panel.getByText('已下载到我的技能', { exact: true }).waitFor()
  await panel.getByText('已安装', { exact: true }).waitFor()
  expect(await readFile(join(userRoot, 'research-daily/SKILL.md'), 'utf8')).toBe(content())
  await panel.getByRole('button', { name: '更新技能: /research-daily', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: '更新技能', exact: true })
  await confirm.waitFor()
  expect(await readFile(join(userRoot, 'research-daily/SKILL.md'), 'utf8')).toContain('版本 1')
  version = 2
  const update = page.waitForResponse(response => new URL(response.url()).pathname === '/api/toolboxTpcoworkHub/install')
  await confirm.getByRole('button', { name: '更新技能', exact: true }).click()
  expect((await (await update).json()).result).toMatchObject({ ok: true, value: { state: 'installed' } })
  await confirm.waitFor({ state: 'hidden' })
  expect(await readFile(join(userRoot, 'research-daily/SKILL.md'), 'utf8')).toBe(content())
  await panel.getByRole('button', { name: '详情: /research-daily', exact: true }).click()
  await expect.poll(() => panel.locator('pre.tp-toolbox-content').textContent()).toBe(content())
  await panel.getByText('版本 2.0.0', { exact: true }).waitFor()
  await page.screenshot({ path: join(review, 'store-detail.png'), fullPage: true, animations: 'disabled' })
  await panel.getByRole('button', { name: '返回列表', exact: true }).click()
  expect(await search.inputValue()).toBe('深度研究')
  await scaffold.ctx.toolboxTpcoworkHub.logout()
  await panel.getByText('未登录', { exact: true }).waitFor()
  expect(await panel.getByRole('button', { name: /^(登录|退出登录)$/ }).count()).toBe(0)
  expect(await panel.getByRole('alert').count()).toBe(0)
  expect(await panel.innerText()).not.toMatch(/TP Cowork Hub|会话已失效|服务地址/)
  await page.screenshot({ path: join(review, 'store-signed-out.png'), fullPage: true, animations: 'disabled' })

  await tabs.getByRole('button', { name: '技能', exact: true }).click()
  await panel.getByRole('navigation', { name: '技能来源' }).getByRole('button', { name: /^我的技能/ }).click()
  const personal = panel.locator('.tp-toolbox-card').filter({ has: page.getByRole('heading', { name: '/research-daily', exact: true }) })
  await personal.waitFor()
  const personalDirectory = await realpath(join(userRoot, 'research-daily'))
  expect(await personal.innerText()).not.toContain(userRoot)
  expect(await personal.innerText()).not.toContain(personalDirectory)
  await personal.getByRole('button', { name: '详情', exact: true }).click()
  await panel.getByText(join(personalDirectory, 'SKILL.md'), { exact: true }).waitFor()
  // Mock only the OS launch; keep the real Client dependency, Host RPC and path validation.
  const opener = vi.spyOn(scaffold.ctx.sessionController, 'openPath').mockResolvedValue(undefined)
  onTestFinished(() => opener.mockRestore())
  const opened = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session/openWorkspacePath')
  await panel.getByRole('button', { name: '打开技能目录', exact: true }).click()
  expect((await (await opened).json()).result).toMatchObject({ ok: true, value: { opened: true } })
  expect(opener).toHaveBeenCalledWith(personalDirectory, expect.any(AbortSignal))
  expect(await panel.getByRole('alert').count()).toBe(0)
  expect(errors).toEqual([])
})

it('opens team and skill details as breadcrumb pages and restores the catalog', async () => {
  const { scaffold, page, panel, tabs, errors } = await launchToolboxApp({ appearance: true })
  const review = join(root, 'artifacts/toolbox-detail-pages-2026-10-19')
  await mkdir(review, { recursive: true })
  const team = (await scaffold.ctx.toolboxTeams.inventory()).items[0]
  const search = panel.getByRole('searchbox', { name: '搜索名称或描述' })
  const breadcrumb = panel.getByRole('navigation', { name: '返回工具箱' })
  const checkGeometry = async width => {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(() => panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    const bounds = await breadcrumb.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
  }
  await search.fill(team.name)
  const teamButton = panel.locator('.tp-toolbox-card').getByRole('button', { name: '详情', exact: true })
  await teamButton.click()
  const teamDetail = panel.getByRole('article', { name: team.name, exact: true })
  await teamDetail.waitFor()
  expect(await breadcrumb.getByRole('button').allTextContents()).toEqual(['工具箱', '专家团队'])
  expect(await breadcrumb.locator('[aria-current=page]').innerText()).toBe(team.name)
  expect(await page.getByRole('dialog').count()).toBe(0)
  expect(await search.count()).toBe(0)
  await teamDetail.getByRole('heading', { name: '团队成员', exact: true }).waitFor()
  for (const member of team.members) {
    await teamDetail.getByRole('heading', { name: member.name, exact: true }).waitFor()
    await teamDetail.getByText(member.goal, { exact: true }).waitFor()
  }
  expect(scaffold.ctx.sessions.list().every(session => session.snapshotEvents().every(event => event.type !== 'user/message'))).toBe(true)
  for (const width of [1440, 560, 390]) {
    await checkGeometry(width)
    await page.screenshot({ path: join(review, `team-detail-${width}.png`), fullPage: true })
  }
  await checkGeometry(1440)
  await breadcrumb.getByRole('button', { name: '专家团队', exact: true }).click()
  await expect.poll(() => search.inputValue()).toBe(team.name)
  await expect.poll(() => teamButton.evaluate(element => document.activeElement === element)).toBe(true)
  await search.fill('')
  await tabs.getByRole('button', { name: '技能', exact: true }).click()
  await expect.poll(() => panel.locator('.tp-toolbox-card').count()).toBe(skillCount)
  const sources = panel.getByRole('navigation', { name: '技能来源' })
  await sources.getByRole('button', { name: /^内置技能/ }).click()
  const skillButton = panel.locator('.tp-toolbox-card').filter({ has: page.getByRole('heading', { name: '/summarize', exact: true }) }).getByRole('button', { name: '详情', exact: true })
  await skillButton.scrollIntoViewIfNeeded()
  const catalogScroll = await panel.evaluate(element => element.scrollTop)
  expect(catalogScroll).toBeGreaterThan(300)
  await skillButton.click()
  const skillDetail = panel.getByRole('article', { name: '/summarize', exact: true })
  await skillDetail.waitFor()
  expect(await breadcrumb.getByRole('button').allTextContents()).toEqual(['工具箱', '技能'])
  const skill = (await scaffold.ctx.toolboxSkills.inventory({})).items.find(item => item.name === 'summarize')
  const expectedDetail = await scaffold.ctx.toolboxSkills.detail({ id: skill.id })
  await expect.poll(() => skillDetail.locator('.tp-toolbox-content').textContent()).toBe(expectedDetail.content)
  expect(await page.getByRole('dialog').count()).toBe(0)
  expect(await panel.evaluate(element => element.scrollTop)).toBe(0)
  for (const width of [1440, 560, 390]) {
    await checkGeometry(width)
    await page.screenshot({ path: join(review, `skill-detail-${width}.png`), fullPage: true })
  }
  await checkGeometry(1440)
  await panel.getByRole('button', { name: '返回列表', exact: true }).click()
  await expect.poll(() => sources.getByRole('button', { name: /^内置技能/ }).getAttribute('aria-pressed')).toBe('true')
  await expect.poll(() => skillButton.evaluate(element => document.activeElement === element)).toBe(true)
  await expect.poll(async () => Math.abs(await panel.evaluate(element => element.scrollTop) - catalogScroll)).toBeLessThanOrEqual(1)
  await search.fill('summarize')
  await skillButton.click()
  await skillDetail.waitFor()
  await breadcrumb.getByRole('button', { name: '工具箱', exact: true }).click()
  await expect.poll(() => search.inputValue()).toBe('summarize')
  await search.fill('')
  await tabs.getByRole('button', { name: '专家团队', exact: true }).click()
  await panel.locator('.tp-toolbox-card').filter({ has: page.getByRole('heading', { name: team.name, exact: true }) }).getByRole('button', { name: '详情', exact: true }).click()
  await teamDetail.getByRole('button', { name: '使用团队', exact: true }).click()
  const input = page.locator('[data-composer-input]').first()
  await expect.poll(() => input.locator('[data-reference-kind=team]').innerText()).toBe(team.name)
  expect(scaffold.ctx.sessions.list().every(session => session.snapshotEvents().every(event => event.type !== 'user/message'))).toBe(true)
  await page.getByRole('button', { name: '添加文件或调用指令', exact: true }).click()
  await page.locator('[data-trigger-menu]').getByRole('option', { name: /技能/ }).click()
  const picker = page.getByRole('listbox', { name: /^\/task-skills 匹配项$/ })
  await picker.getByRole('option', { name: /summarize/ }).waitFor()
  for (const name of ['corporate-ppt', 'docx', 'pdf']) {
    expect(await picker.getByRole('option', { name: new RegExp(`^/?${name}(?:\\s|$)`) }).count()).toBe(0)
  }
  await page.screenshot({ path: join(root, 'artifacts/remove-three-skills-2026-10-19/skills-plus-menu.png'), fullPage: true })
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

it('shows rich team profiles and prepares drafts from task examples and use cases', async () => {
  const { scaffold, page, panel, tabs, adapter, errors } = await launchToolboxApp({ appearance: true })
  const review = join(root, 'artifacts/team-detail-showcase-2026-10-19')
  await mkdir(review, { recursive: true })
  const teams = (await scaffold.ctx.toolboxTeams.inventory()).items
  const input = page.locator('[data-composer-input]').first()
  for (const [index, team] of teams.entries()) {
    await tabs.getByRole('button', { name: '专家团队', exact: true }).click()
    await panel.locator('.tp-toolbox-card').filter({ has: page.getByRole('heading', { name: team.name, exact: true }) }).getByRole('button', { name: '详情', exact: true }).click()
    const detail = panel.getByRole('article', { name: team.name, exact: true })
    await detail.waitFor()
    for (const heading of ['团队帮你做', '使用案例', '团队成员', '如何协作']) await detail.getByRole('heading', { name: heading, exact: true }).waitFor()
    expect(await detail.getByRole('heading', { name: '更多', exact: true }).count()).toBe(0)
    for (const member of team.members) {
      expect(member.goal.length).toBeGreaterThan(10)
      await detail.getByText(member.goal, { exact: true }).waitFor()
    }
    expect(await detail.locator('.tp-team-examples button').count()).toBe(3)
    expect(await detail.locator('.tp-team-case').count()).toBe(2)
    expect(await page.getByRole('dialog').count()).toBe(0)
    for (const width of [1440, 560, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await panel.evaluate(element => { element.scrollTop = 0 })
      await expect.poll(() => panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      const bounds = await detail.locator('.tp-toolbox-editor-heading').boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
      await page.screenshot({ path: join(review, `${team.id}-${width}.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await detail.locator('.tp-team-cases').screenshot({ path: join(review, `${team.id}-cases.png`) })
    await detail.locator('.tp-team-members').screenshot({ path: join(review, `${team.id}-members.png`) })
    const firstCase = detail.locator('.tp-team-case').first()
    const caseTitle = await firstCase.getAttribute('aria-label')
    await firstCase.focus()
    await firstCase.press('Enter')
    const report = detail.getByRole('region', { name: caseTitle, exact: true })
    await report.waitFor()
    expect(await firstCase.getAttribute('aria-expanded')).toBe('true')
    expect(await report.innerText()).toContain('这里展示报告结构')
    expect(adapter.requests).toHaveLength(0)
    await report.screenshot({ path: join(review, `${team.id}-report-example.png`) })
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(true)
    await panel.evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ path: join(review, `${team.id}-dark.png`), fullPage: true })
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(false)
    if (index === 0) await detail.locator('.tp-team-examples button').nth(2).click()
    else await report.getByRole('button', { name: '用此任务开始', exact: true }).click()
    await expect.poll(() => input.locator('[data-reference-kind=team]').innerText()).toBe(team.name)
    await expect.poll(() => input.innerText()).toContain(index === 0 ? '应收账款' : '先进封装')
    expect(await input.innerText()).toContain('Markdown')
    expect(await input.innerText()).toContain('HTML')
    expect(adapter.requests).toHaveLength(0)
    if (index < teams.length - 1) {
      await page.getByRole('button', { name: '专家 · 技能 · 连接器', exact: true }).click()
      await panel.waitFor()
      const back = panel.getByRole('button', { name: '返回列表', exact: true })
      if (await back.count()) await back.click()
    }
  }
  expect(scaffold.ctx.sessions.list().every(session => session.snapshotEvents().every(event => event.type !== 'user/message'))).toBe(true)
  expect(errors).toEqual([])
})

it('manages four real toolbox pages through the native browser', async () => {
  const { scaffold, page, panel, tabs, errors, userRoot } = await launchToolboxApp()
  await tabs.getByRole('button', { name: '技能', exact: true }).click()
  await expect.poll(() => panel.locator('article').count(), { timeout: 30000 }).toBe(skillCount)
  for (const name of ['corporate-ppt', 'docx', 'pdf']) {
    expect(await panel.getByRole('heading', { name: `/${name}`, exact: true }).count()).toBe(0)
    expect(await scaffold.ctx.skills.get(name)).toBeUndefined()
  }
  const skill = panel.locator('article').filter({ has: page.getByRole('heading', { name: '/summarize', exact: true }) })
  await skill.getByRole('button', { name: '停用', exact: true }).click()
  await skill.getByRole('button', { name: '启用', exact: true }).waitFor()
  await panel.getByText('已保存', { exact: true }).waitFor()
  await expect.poll(() => panel.getByRole('button', { name: '刷新', exact: true }).isEnabled(), { timeout: 30000 }).toBe(true)
  expect(await scaffold.ctx.skills.get('summarize')).toBeUndefined()
  await skill.getByRole('button', { name: '启用', exact: true }).click()
  await skill.getByRole('button', { name: '停用', exact: true }).waitFor()
  expect(await scaffold.ctx.skills.get('summarize')).toBeDefined()
  await page.screenshot({ path: join(artifacts, 'skills.png'), fullPage: true })

  await panel.getByRole('button', { name: '手动创建技能', exact: true }).click()
  const manual = page.getByRole('form', { name: '手动创建技能', exact: true })
  await manual.getByLabel('技能名称', { exact: true }).fill('review-skill')
  await manual.getByLabel('触发描述', { exact: true }).fill('核验报告中的来源和日期。')
  await manual.getByLabel('技能说明（Markdown）', { exact: true }).fill('# 核验报告\n逐项检查来源、日期和证据缺口。')
  await page.screenshot({ path: join(artifacts, 'manual-skill.png'), fullPage: true })
  await manual.getByRole('button', { name: '创建技能', exact: true }).click()
  await manual.waitFor({ state: 'hidden' })
  expect((await scaffold.ctx.skills.get('review-skill'))?.content).toContain('逐项检查来源')
  await panel.getByRole('navigation', { name: '技能来源' }).getByRole('button', { name: /^我的技能/ }).click()
  await expect.poll(() => panel.locator('article').count()).toBe(1)
  expect(await panel.getByRole('heading', { name: '/review-skill', exact: true }).count()).toBe(1)

  expect(await panel.locator('.tp-toolbox-skill-directory').count()).toBe(0)
  expect(await panel.locator('.tp-toolbox-section-toolbar').getByRole('button', { name: '技能商店', exact: true }).count()).toBe(0)
  const sourceDirectory = join(scaffold.workspaceCwd, 'review-archive')
  await mkdir(join(sourceDirectory, 'references'), { recursive: true })
  await writeFile(join(sourceDirectory, 'SKILL.md'), '---\nname: review-archive\ndescription: 文件夹导入验收\n---\nRead [source](references/source.txt).\n')
  await writeFile(join(sourceDirectory, 'references/source.txt'), '完整资源文件。')
  let folderPicks = 0
  // The native chooser renders outside the page; script only this OS response.
  await page.exposeFunction('__acceptancePickSkillDirectory', async () => { folderPicks++; return sourceDirectory })
  await page.evaluate(() => { window.__DSH_DIRECTORY_PICKER__ = { pick: () => window.__acceptancePickSkillDirectory() } })
  const importPrepared = page.waitForResponse(response => new URL(response.url()).pathname === '/api/toolboxInstaller/prepareLocalImport')
  await panel.getByRole('button', { name: '导入技能', exact: true }).click()
  await page.getByRole('menuitem', { name: '从技能文件夹导入', exact: true }).click()
  expect((await (await importPrepared).json()).result).toMatchObject({ ok: true, value: { name: 'review-archive' } })
  await panel.getByText('安装已完成', { exact: true }).waitFor()
  expect(folderPicks).toBe(1)
  expect((await scaffold.ctx.skills.get('review-archive'))?.content).toContain('references/source.txt')
  expect(await readFile(join(userRoot, 'review-archive/references/source.txt'), 'utf8')).toBe('完整资源文件。')
  expect(await readFile(join(sourceDirectory, 'references/source.txt'), 'utf8')).toBe('完整资源文件。')
  await expect.poll(() => panel.locator('article').count()).toBe(2)
  const imported = panel.locator('article').filter({ has: page.getByRole('heading', { name: '/review-archive', exact: true }) })
  await imported.getByRole('button', { name: '详情', exact: true }).click()
  await panel.getByRole('button', { name: '打开技能目录', exact: true }).waitFor()
  if (process.env.TPCOWORK_TEST_NATIVE_OPEN === '1') {
    const opened = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session/openWorkspacePath')
    await panel.getByRole('button', { name: '打开技能目录', exact: true }).click()
    expect((await (await opened).json()).result).toMatchObject({ ok: true, value: { opened: true } })
  }
  await page.screenshot({ path: join(artifacts, 'personal-skill-detail.png'), fullPage: true })
  await panel.getByRole('button', { name: '返回列表', exact: true }).click()
  for (const name of ['review-skill', 'review-archive']) {
    const card = panel.locator('article').filter({ has: page.getByRole('heading', { name: '/' + name, exact: true }) })
    await card.getByRole('button', { name: '移除', exact: true }).click()
    const confirm = page.getByRole('dialog')
    await confirm.getByRole('button', { name: '移除', exact: true }).click()
    await confirm.waitFor({ state: 'hidden' })
    expect(await scaffold.ctx.skills.get(name)).toBeUndefined()
    await expect.poll(() => panel.getByRole('heading', { name: '/' + name, exact: true }).count(), { timeout: 30000 }).toBe(0)
  }
  await panel.getByRole('navigation', { name: '技能来源' }).getByRole('button', { name: /^全部技能/ }).click()
  await expect.poll(() => panel.locator('article').count(), { timeout: 30000 }).toBe(skillCount)

  await tabs.getByRole('button', { name: 'MCP', exact: true }).click()
  await expect.poll(() => panel.locator('article').count()).toBe(3)
  expect((await scaffold.ctx.toolboxMcp.inventory()).items.map(row => row.id)).toEqual(['juyuan', 'caihui_mcp', 'playwright'])
  await panel.getByRole('button', { name: '新增 MCP', exact: true }).click()
  const editor = page.getByRole('form', { name: '添加 MCP 服务', exact: true })
  expect(await page.getByRole('dialog').count()).toBe(0)
  expect(await editor.getByRole('navigation', { name: '返回工具箱' }).innerText()).toContain('MCP')
  await editor.getByText('高级设置', { exact: true }).click()
  await editor.getByLabel('服务标识', { exact: true }).fill('acceptance-local')
  await editor.getByLabel('服务名称', { exact: true }).fill('验收本地 MCP')
  await editor.getByRole('button', { name: '本地程序', exact: true }).click()
  await editor.getByLabel('启动程序', { exact: true }).fill(process.execPath)
  await editor.getByRole('button', { name: '添加参数', exact: true }).click()
  await editor.getByLabel('参数 1', { exact: true }).fill(join(root, '../deepseek-harness/packages/mcp/mcp-client/tests/fixtures/toolbox-server.mjs'))
  await page.screenshot({ path: join(artifacts, 'mcp-editor.png'), fullPage: true })
  await editor.getByRole('button', { name: '保存并连接', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  const server = panel.locator('article').filter({ hasText: '验收本地 MCP' })
  await server.getByRole('button', { name: '探测连接', exact: true }).click()
  await panel.getByText('探测完成，请查看连接状态。', { exact: true }).waitFor({ timeout: 60000 })
  expect((await scaffold.ctx.toolboxMcp.inventory()).items.find(row => row.id === 'acceptance-local')?.toolCount).toBeGreaterThan(0)
  expect(scaffold.ctx.tools.schemas().some(row => row.name.startsWith('mcp__'))).toBe(false)
  await page.screenshot({ path: join(artifacts, 'mcp.png'), fullPage: true })
  await server.getByRole('button', { name: '移除', exact: true }).click()
  const removal = page.getByRole('dialog')
  await removal.getByRole('button', { name: '移除', exact: true }).click()
  await removal.waitFor({ state: 'hidden' })
  await expect.poll(async () => (await scaffold.ctx.toolboxMcp.inventory()).items.length).toBe(3)

  await tabs.getByRole('button', { name: '技能商店', exact: true }).click()
  expect(await scaffold.ctx.toolboxTpcoworkHub.account()).toMatchObject({ configured: false, state: 'unconfigured' })
  await panel.getByText('未登录', { exact: true }).waitFor()
  expect(await panel.getByRole('button', { name: '登录', exact: true }).count()).toBe(0)
  expect(await panel.getByRole('button', { name: '退出登录', exact: true }).count()).toBe(0)
  expect(await panel.getByRole('button', { name: '上传技能', exact: true }).count()).toBe(0)
  await page.screenshot({ path: join(artifacts, 'store.png'), fullPage: true })
  expect(errors).toEqual([])
})

it('integrates capabilities into the native Add menu and delivers both teams', async () => {
  const { scaffold, page, panel, adapter, errors } = await launchToolboxApp()
  await panel.getByRole('button', { name: '使用团队', exact: true }).first().click()
  const input = page.locator('[data-composer-input]').first()
  await expect.poll(() => input.innerText()).toContain('个股研究')
  expect(scaffold.ctx.sessions.list().every(session => session.snapshotEvents().every(event => event.type !== 'user/message'))).toBe(true)
  expect(await page.getByRole('button', { name: '聊天能力', exact: true }).count()).toBe(0)
  const plus = page.getByRole('button', { name: '添加文件或调用指令', exact: true })
  const nativeMenu = page.locator('[data-trigger-menu]')
  const choices = page.getByRole('listbox', { name: /^\/(expert-team|task-skills|connectors) 匹配项$/ })
  const showNativeMenu = async () => {
    if (!(await nativeMenu.isVisible())) await plus.click()
    await nativeMenu.waitFor()
  }
  const openChoices = async (category = '专家团队') => {
    await showNativeMenu()
    await nativeMenu.getByRole('option', { name: new RegExp(category) }).click()
    await choices.waitFor()
  }
  const chips = input.locator('[data-composer-chip="toolbox-capabilities"]')
  const teamRef = input.locator('[data-reference-kind="team"]')
  const prose = () => input.evaluate(element => {
    const copy = element.cloneNode(true)
    copy.querySelectorAll('[data-composer-chip]').forEach(node => node.remove())
    return copy.textContent.trim()
  })
  await expect.poll(() => teamRef.filter({ hasText: '个股研究' }).count(), { timeout: 30000 }).toBe(1)
  const prepared = (await input.innerText()).split('\n')
  expect(prepared[0]).toContain('资产投研团队 · 个股研究')
  expect(prepared.slice(1).join('\n')).toContain('请深度研究【公司名称或股票代码】')
  expect(await input.innerText()).not.toContain('请使用「')
  const originalDraft = await prose()
  await showNativeMenu()
  for (const name of ['文件', '专家团队', '技能', '连接器']) {
    await expect.poll(() => nativeMenu.getByRole('option', { name: new RegExp(name) }).count(), { message: 'native Add entry: ' + name }).toBeGreaterThan(0)
  }
  expect(await page.getByRole('dialog').count()).toBe(0)
  await page.screenshot({ path: join(artifacts, 'composer-plus.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await openChoices()
  await choices.getByRole('option', { name: /重新读取选择/ }).click()
  await openChoices('连接器')
  expect(await choices.getByRole('option', { name: /聚源/ }).getAttribute('aria-disabled')).toBe('true')
  await page.keyboard.press('Escape')
  expect(await teamRef.filter({ hasText: '个股研究' }).count()).toBe(1)
  await teamRef.filter({ hasText: '个股研究' }).click()
  await openChoices('技能')
  const skillSearch = page.getByRole('textbox', { name: '筛选选项', exact: true })
  await skillSearch.fill('does-not-exist')
  await page.getByText('没有匹配结果', { exact: true }).waitFor()
  await skillSearch.fill('summarize')
  await choices.getByRole('option', { name: /^\/summarize/ }).click()
  await chips.locator('[data-reference-kind="skill"]').getByText('summarize', { exact: true }).click()
  await showNativeMenu()
  const [filePicker] = await Promise.all([
    page.waitForEvent('filechooser'),
    nativeMenu.getByRole('option', { name: /^文件/ }).click(),
  ])
  await filePicker.setFiles([])
  expect(await prose()).toBe(originalDraft)
  await page.setViewportSize({ width: 560, height: 900 })
  await openChoices('技能')
  const popupBounds = await page.getByLabel('/task-skills 选项', { exact: true }).boundingBox()
  expect(popupBounds.x).toBeGreaterThanOrEqual(0)
  expect(popupBounds.x + popupBounds.width).toBeLessThanOrEqual(560)
  expect(popupBounds.y).toBeGreaterThanOrEqual(0)
  await page.screenshot({ path: join(artifacts, 'composer-narrow.png'), fullPage: true })
  await page.keyboard.press('Escape')
  expect(await input.evaluate(element => document.activeElement === element)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openChoices()
  await choices.getByRole('option', { name: /个股研究/ }).click()
  await page.screenshot({ path: join(artifacts, 'composer-selection.png'), fullPage: true })
  for (const [index, teamId] of ['asset-research-team', 'supply-chain-bottleneck-team'].entries()) {
    if (index) {
      const previous = new Set(scaffold.ctx.sessions.list().map(session => session.id))
      await page.getByRole('button', { name: '专家 · 技能 · 连接器', exact: true }).click()
      await panel.getByRole('button', { name: '使用团队', exact: true }).nth(index).click()
      await expect.poll(() => scaffold.ctx.sessions.list().filter(session => session.header.origin !== 'subagent' && !previous.has(session.id)).length, { timeout: 30000 }).toBe(1)
      await expect.poll(() => teamRef.filter({ hasText: '供应链瓶颈' }).count(), { timeout: 30000 }).toBe(1)
    }
    const session = scaffold.ctx.sessions.list().findLast(session => session.header.origin !== 'subagent')
    expect(session).toBeDefined()
    if (index) await selectReports(page)
    await openChoices()
    await expect.poll(() => choices.getByRole('option', { name: index ? /供应链瓶颈/ : /个股研究/ }).getAttribute('aria-disabled'), { timeout: 15000 }).not.toBe('true')
    await page.keyboard.press('Escape')
    await input.click()
    await input.fill(`研究隔离验收材料 ${index + 1}，明确没有实时金融数据。生成两份报告并核对最终计划。`)
    await expect.poll(() => teamRef.count()).toBe(0)
    await openChoices()
    await choices.getByRole('option', { name: index ? /供应链瓶颈/ : /个股研究/ }).click()
    await expect.poll(() => teamRef.count()).toBe(1)
    const admission = page.waitForResponse(response => new URL(response.url()).pathname === '/api/toolboxTasks/submit')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    const submitted = await admission
    expect((await submitted.json()).result).toMatchObject({ ok: true })
    expect(submitted.request().postDataJSON().payload.args.request.message.sessionId).toBe(session.id)
    await expect.poll(() => scaffold.ctx.toolboxTasks.context({ sessionId: session.id, taskId: session.id }), { timeout: 15000 }).not.toBeNull()
    await expect.poll(async () => {
      const snapshot = await scaffold.ctx.experts.snapshot({ sessionId: session.id })
      if (snapshot.status === 'failed') throw new Error(`team failed: ${snapshot.run?.code}`)
      return snapshot.status
    }, { timeout: 60000 }).toBe('completed')
    await scaffold.ctx.agents.get(session.id).whenIdle()
    const { run } = await scaffold.ctx.experts.snapshot({ sessionId: session.id })
    expect(run.context.team.id).toBe(teamId)
    expect(run.context.mcp).toEqual([])
    expect(run.settlement).toEqual({ execution: 'succeeded', delivery: 'delivered', plan: 'reconciled' })
    await openChoices()
    const fixedTeam = choices.getByRole('option', { name: index ? /供应链瓶颈/ : /个股研究/ })
    expect(await fixedTeam.getAttribute('aria-disabled')).toBe('true')
    await page.keyboard.press('Escape')
    const fixedTeamReference = teamRef.filter({ hasText: index ? '供应链瓶颈' : '个股研究' })
    await fixedTeamReference.click()
    expect(await fixedTeamReference.count()).toBe(1)
    await page.keyboard.press('Escape')
    const progress = page.locator('[data-workflow-run]').last()
    await expect.poll(() => progress.getAttribute('data-run-status')).toBe('completed')
    expect(await page.getByRole('group', { name: '专家团队', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: '取消团队', exact: true }).count()).toBe(0)
    const runHeader = progress.locator('[data-disclosure-row]').first()
    if (await runHeader.getAttribute('aria-expanded') !== 'true') await runHeader.click()
    const phases = index ? ['发现机会', '验证证据', '综合研究结论', '独立审阅报告'] : ['并行研究', '综合研究结论', '独立审阅报告']
    for (const phase of phases) {
      const header = progress.getByRole('button', { name: new RegExp('^' + phase) })
      if (await header.getAttribute('aria-expanded') !== 'true') await header.click()
    }
    expect(await progress.locator('[data-member-label]').count()).toBe(index ? 7 : 6)
    const todos = page.getByTestId('todo-panel')
    await todos.waitFor()
    const todoHeader = todos.getByRole('button').first()
    if (await todoHeader.getAttribute('aria-expanded') !== 'true') await todoHeader.click()
    expect(await todos.locator('li').count()).toBe(index ? 8 : 7)
    expect(await todos.locator('li[data-status=completed]').count()).toBe(index ? 8 : 7)
    const reports = run.artifacts.filter(row => row.kind !== 'member' && row.sessionEventId)
    expect(reports).toHaveLength(2)
    for (const report of reports) {
      expect(await readFile(report.path, 'utf8')).toContain('缺少实时金融数据')
      await cp(report.path, join(artifacts, `${teamId}.${report.kind === 'html' ? 'html' : 'md'}`))
    }
    await writeFile(join(artifacts, `${teamId}.json`), JSON.stringify(run, null, 2) + '\n')
    await page.screenshot({ path: join(artifacts, `${teamId}.png`), fullPage: true })
  }
  expect(adapter.requests.length).toBeGreaterThan(25)
  expect(adapter.requests.every(request => request.provider === 'toolbox-acceptance' && request.model === 'reports')).toBe(true)
  expect(errors).toEqual([])
})

it('edits capabilities in an existing chat as inline references with the TP Cowork appearance', async () => {
  const { scaffold, page, panel, adapter, errors } = await launchToolboxApp({ appearance: true })
  await panel.getByRole('button', { name: '使用团队', exact: true }).first().click()
  const input = page.locator('[data-composer-input]').first()
  const card = page.locator('[data-composer-card]').first()
  const chips = input.locator('[data-composer-chip="toolbox-capabilities"]')
  await page.getByRole('button', { name: '添加文件或调用指令', exact: true }).click()
  await page.locator('[data-trigger-menu]').getByRole('option', { name: /专家团队/ }).click()
  await page.getByRole('listbox', { name: /^\/expert-team 匹配项$/ }).getByRole('option', { name: /个股研究/ }).waitFor()
  await page.keyboard.press('Escape')
  await input.locator('[data-reference-kind="team"]').click()
  await expect.poll(() => chips.count()).toBe(0)
  const prose = () => input.evaluate(element => {
    const copy = element.cloneNode(true)
    copy.querySelectorAll('[data-composer-chip]').forEach(node => node.remove())
    return copy.textContent.trim()
  })
  const fill = async text => {
    await input.fill(text)
    await expect.poll(prose).toBe(text)
  }
  await fill('普通聊天第一条，不选择能力。')
  const plain = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session/prompt')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  expect((await (await plain).json()).result).toMatchObject({ ok: true })
  const session = scaffold.ctx.sessions.list().findLast(session => session.header.origin !== 'subagent')
  const agent = scaffold.ctx.agents.get(session.id)
  await agent.whenIdle()
  expect(await scaffold.ctx.toolboxTasks.context({ sessionId: session.id, taskId: session.id })).toBeNull()
  await scaffold.ctx.toolboxMcp.create({ expectedRevision: (await scaffold.ctx.toolboxMcp.inventory()).revision,
    definition: { id: 'toolbar-local', label: '验收 MCP', origin: 'custom', enabled: true, transport: 'stdio', command: process.execPath, args: [join(root, '../deepseek-harness/packages/mcp/mcp-client/tests/fixtures/toolbox-server.mjs')], credentials: [] } })
  await scaffold.ctx.toolboxMcp.probe({ id: 'toolbar-local' }, new AbortController().signal)
  const plus = page.getByRole('button', { name: '添加文件或调用指令', exact: true })
  const choices = page.getByRole('listbox', { name: /^\/(expert-team|task-skills|connectors) 匹配项$/ })
  const open = async category => {
    await plus.click()
    await page.locator('[data-trigger-menu]').getByRole('option', { name: new RegExp(category) }).click()
    await choices.waitFor()
  }
  const pick = async (category, name) => {
    await open(category)
    const option = choices.getByRole('option', { name })
    expect(await option.getAttribute('aria-disabled')).not.toBe('true')
    await option.click()
  }
  await fill('第二条消息，检查能力选择。')
  await pick('技能', /^\/summarize/)
  await pick('技能', /^\/skill-creator/)
  await pick('连接器', /验收 MCP/)
  await expect.poll(() => chips.count()).toBe(3)
  expect(await prose()).toBe('第二条消息，检查能力选择。')
  expect(await card.locator('[data-composer-selection]').innerText()).toBe('')
  const permission = card.getByRole('button', { name: /工作区内修改/ }).first()
  const checkGeometry = async width => {
    await page.setViewportSize({ width, height: 1000 })
    const composer = await card.boundingBox(), editor = await input.boundingBox(), mode = await permission.boundingBox()
    for (const chip of await chips.all()) {
      const box = await chip.boundingBox()
      expect(box.y).toBeGreaterThanOrEqual(editor.y)
      expect(box.y + box.height).toBeLessThanOrEqual(mode.y)
      expect(box.x).toBeGreaterThanOrEqual(composer.x)
      expect(box.x + box.width).toBeLessThanOrEqual(composer.x + composer.width)
      const style = await chip.locator('[data-reference-kind]').evaluate(element => {
        const css = getComputedStyle(element)
        return { background: css.backgroundColor, radius: css.borderRadius, color: css.color }
      })
      expect(style.background).toBe('rgba(0, 0, 0, 0)')
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  const review = join(root, 'artifacts/composer-inline-capabilities')
  await checkGeometry(1440)
  const summarize = input.locator('[data-reference-kind="skill"]').getByText('summarize', { exact: true })
  await page.screenshot({ path: join(review, 'inline-capabilities-wide.png'), fullPage: true })
  await checkGeometry(560)
  await page.screenshot({ path: join(review, 'inline-capabilities-narrow.png'), fullPage: true })
  await checkGeometry(390)
  await checkGeometry(1440)
  await input.focus()
  await input.evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    const selection = getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.keyboard.insertText(' /task-skills')
  await page.locator('[data-trigger-menu]').getByRole('option', { name: /task-skills/ }).click()
  await choices.getByRole('option', { name: /^\/skill-creator/ }).click()
  await expect.poll(() => chips.count()).toBe(2)
  expect(await input.innerText()).not.toContain('/task-skills')
  await pick('技能', /^\/skill-creator/)
  await expect.poll(() => chips.count()).toBe(3)
  expect(await prose()).toBe('第二条消息，检查能力选择。')
  const reviewedCatalog = await scaffold.ctx.toolboxTasks.selection({ sessionId: session.id })
  const accepted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/toolboxTasks/submit')
  const before = adapter.requests.length
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  expect((await (await accepted).json()).result).toMatchObject({ ok: true, value: { context: { team: null } } })
  await agent.whenIdle()
  expect(JSON.stringify(adapter.requests[before])).toContain('mcp__toolbar-local__ping')
  await writeFile(join(review, 'selection-observation.json'), JSON.stringify({
    reviewedCatalog,
    catalogAfterSend: await scaffold.ctx.toolboxTasks.selection({ sessionId: session.id }),
    context: await scaffold.ctx.toolboxTasks.context({ sessionId: session.id, taskId: session.id }),
  }, null, 2) + '\n')
  await expect.poll(() => card.getByRole('alert').count(), { timeout: 15000 }).toBe(0)
  await input.focus()
  await input.evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    const selection = getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.keyboard.insertText('继续使用相同技能与 MCP。')
  const continued = page.waitForResponse(response => new URL(response.url()).pathname === '/api/toolboxTasks/submit')
  const continuedAt = adapter.requests.length
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  expect((await (await continued).json()).result).toMatchObject({ ok: true, value: { context: { team: null, mcp: [{ id: 'toolbar-local' }] } } })
  await agent.whenIdle()
  expect(JSON.stringify(adapter.requests[continuedAt])).toContain('mcp__toolbar-local__ping')
  await expect.poll(() => chips.count()).toBe(3)
  await expect.poll(() => card.getByRole('alert').count()).toBe(0)
  await card.screenshot({ path: join(review, 'inline-capabilities-selected.png') })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(true)
  await card.screenshot({ path: join(review, 'inline-capabilities-dark.png') })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(false)
  await page.reload()
  await input.waitFor()
  await summarize.waitFor()
  await expect.poll(() => chips.count()).toBe(3)
  await expect.poll(() => card.getByRole('alert').count()).toBe(0)
  await input.focus()
  await input.evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    const selection = getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.keyboard.insertText('第三条消息，撤下之前选择的能力。')
  await expect.poll(prose).toBe('第三条消息，撤下之前选择的能力。')
  await open('技能')
  expect(await choices.getByRole('option', { name: /^\/summarize/ }).getAttribute('aria-disabled')).not.toBe('true')
  await page.keyboard.press('Escape')
  await summarize.click()
  await expect.poll(() => chips.count()).toBe(2)
  const creator = input.locator('[data-composer-chip="toolbox-capabilities"]').filter({ hasText: 'skill-creator' })
  const backspaceCreator = async () => {
    await input.focus()
    await creator.evaluate(element => {
      const next = element.nextSibling
      const range = document.createRange()
      if (next?.nodeType === Node.TEXT_NODE && next.textContent.startsWith(' ')) range.setStart(next, 1)
      else range.setStartAfter(element)
      range.collapse(true)
      const selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    })
    await page.keyboard.press('Backspace')
  }
  await backspaceCreator()
  await expect.poll(() => chips.count()).toBe(1)
  await input.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect.poll(() => chips.count()).toBe(2)
  await backspaceCreator()
  await expect.poll(() => chips.count()).toBe(1)
  await input.locator('[data-reference-kind="mcp"]').click()
  await expect.poll(() => chips.count()).toBe(0)
  expect(await input.evaluate(element => document.activeElement === element)).toBe(true)
  expect(await prose()).toBe('第三条消息，撤下之前选择的能力。')
  const cleared = page.waitForResponse(response => new URL(response.url()).pathname === '/api/toolboxTasks/submit')
  const after = adapter.requests.length
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  expect((await (await cleared).json()).result).toMatchObject({ ok: true, value: { context: { skills: [], mcp: [] } } })
  await agent.whenIdle()
  expect(adapter.requests[after].tools?.map(tool => tool.name)).not.toContain('mcp__toolbar-local__ping')
  expect(session.snapshotEvents().filter(event => event.type === 'plugin:tpcowork-toolbox/selection')).toHaveLength(3)
  await page.screenshot({ path: join(review, 'inline-capabilities-cleared.png'), fullPage: true })

  const clearedContext = await scaffold.ctx.toolboxTasks.context({ sessionId: session.id, taskId: session.id })
  const skills = await scaffold.ctx.toolboxSkills.inventory({})
  await scaffold.ctx.toolboxSkills.setEnabled({ id: skills.items.find(item => item.name === 'summarize').id, enabled: false, expectedRevision: skills.revision })
  expect((await scaffold.ctx.toolboxTasks.selection({ sessionId: session.id })).revision).not.toBe(clearedContext.catalogRevision)
  await page.reload()
  await input.waitFor()
  await expect.poll(() => card.locator('[data-composer-selection]').innerText()).toBe('')
  expect(await chips.count()).toBe(0)
  await fill('一句话介绍自己。')
  const ordinary = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session/prompt')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  expect((await (await ordinary).json()).result).toMatchObject({ ok: true })
  await agent.whenIdle()
  expect(session.snapshotEvents().filter(event => event.type === 'plugin:tpcowork-toolbox/selection')).toHaveLength(3)
  expect(await card.getByRole('alert').count()).toBe(0)
  await page.screenshot({ path: join(review, 'ordinary-chat-after-catalog-change.png'), fullPage: true })
  expect(errors).toEqual([])
})

it('continues a brainstorming session after unrelated catalog changes and reopening while blocking a disabled selected skill', async () => {
  const { scaffold, page, panel, adapter, errors } = await launchToolboxApp({ appearance: true })
  await panel.getByRole('button', { name: '使用团队', exact: true }).first().click()
  const input = page.locator('[data-composer-input]').first()
  const card = page.locator('[data-composer-card]').first()
  await page.getByRole('button', { name: '添加文件或调用指令', exact: true }).click()
  await page.locator('[data-trigger-menu]').getByRole('option', { name: /技能/ }).click()
  const choices = page.getByRole('listbox', { name: /^\/task-skills 匹配项$/ })
  await choices.getByRole('option', { name: /^\/brainstorming/ }).waitFor()
  await page.keyboard.press('Escape')
  await input.locator('[data-reference-kind="team"]').click()
  await expect.poll(() => input.locator('[data-composer-chip]').count()).toBe(0)
  await input.fill('帮我梳理这个产品的设计方案。')
  await page.getByRole('button', { name: '添加文件或调用指令', exact: true }).click()
  await page.locator('[data-trigger-menu]').getByRole('option', { name: /技能/ }).click()
  await choices.getByRole('option', { name: /^\/brainstorming/ }).click()
  const brainstorming = input.locator('[data-reference-kind="skill"]').getByText('brainstorming', { exact: true })
  await brainstorming.waitFor()
  const send = async (afterClick = () => {}) => {
    const accepted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/toolboxTasks/submit')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    afterClick()
    const result = (await (await accepted).json()).result
    expect(result.ok).toBe(true)
    const session = scaffold.ctx.sessions.list().findLast(session => session.header.origin !== 'subagent')
    await scaffold.ctx.agents.get(session.id).whenIdle()
    return { session, context: result.value.context }
  }
  const first = await send()
  const oldContext = structuredClone(first.context)
  expect(oldContext.skills).toHaveLength(1)
  const toggle = async (name, enabled) => {
    const inventory = await scaffold.ctx.toolboxSkills.inventory({})
    await scaffold.ctx.toolboxSkills.setEnabled({ id: inventory.items.find(item => item.name === name).id, enabled, expectedRevision: inventory.revision })
  }
  await toggle('summarize', false)
  const current = await scaffold.ctx.toolboxTasks.selection({ sessionId: first.session.id })
  expect(current.revision).not.toBe(oldContext.catalogRevision)
  expect(current.skills.items.find(item => item.name === 'brainstorming')).toMatchObject({ ...oldContext.skills[0], enabled: true, readiness: { state: 'ready' } })
  let resumeSelection
  const restoring = new Promise(resolve => { resumeSelection = resolve })
  await page.route('**/api/toolboxTasks/selection', async route => { await restoring; await route.continue() })
  await page.reload()
  await brainstorming.waitFor()
  await expect.poll(() => card.getByRole('alert').count()).toBe(0)
  const append = async text => {
    await input.focus()
    await input.evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element); range.collapse(false)
      const selection = getSelection()
      selection.removeAllRanges(); selection.addRange(range)
    })
    await page.keyboard.insertText(text)
  }
  await append('继续补充方案的权衡。')
  const continued = await send(resumeSelection)
  await page.unroute('**/api/toolboxTasks/selection')
  expect(continued.context).toMatchObject({ catalogRevision: current.revision, skills: oldContext.skills })
  expect(JSON.stringify(adapter.requests.at(-1))).toContain('本次消息的技能：' + oldContext.skills[0].id)
  const records = first.session.snapshotEvents().filter(event => event.type === 'plugin:tpcowork-toolbox/selection')
  expect(records).toHaveLength(2)
  expect(records[0].data.context).toEqual(oldContext)
  await expect.poll(() => card.getByRole('alert').count()).toBe(0)
  await brainstorming.waitFor()
  const review = join(root, 'artifacts/composer-inline-capabilities')
  await mkdir(review, { recursive: true })
  await page.screenshot({ path: join(review, 'brainstorming-after-catalog-change.png'), fullPage: true })
  await toggle('brainstorming', false)
  await expect.poll(() => card.locator('.tp-toolbox-selection-error').innerText()).toBe('所选能力不可用或缺少必需技能，请检查后重新选择。')
  await toggle('brainstorming', true)
  await expect.poll(() => card.getByRole('alert').count()).toBe(0)
  expect(errors).toEqual([])
})

async function selectReports(page) {
  const trigger = page.getByRole('button', { name: /^(选择模型|请选择模型)/ })
  await trigger.click()
  const drill = page.getByRole('menuitem', { name: /^模型/ })
  if (await drill.count()) await drill.click()
  await page.getByRole('menuitemradio', { name: '验收报告', exact: true }).click()
  await expect.poll(() => trigger.getAttribute('title'), { timeout: 15000 }).toMatch(/^验收报告/)
}

// Only model output is scripted; native workflow, tools, files and Session events run normally.
function reportAdapter(ctx) {
  let serial = 0
  const adapter = new MockAdapter(Array.from({ length: 180 }, () => request => {
    const start = request.messages.findLastIndex(message => JSON.stringify(message).includes('团队研究状态：'))
    const current = start < 0 ? request.messages : request.messages.slice(start)
    const messages = JSON.stringify(current)
    const paths = [...new Set([...messages.matchAll(/reports\/experts\/[a-zA-Z0-9_.-]+\/(?:[a-z-]+\.md|report\.html)/g)].map(match => match[0]))]
    const calls = current.filter(message => message.role === 'tool').length
    if (messages.includes('团队研究状态：')) {
      if (calls === 0) return toolCallResponse('present-' + ++serial, 'present', { files: paths.filter(path => /report\.(md|html)$/.test(path)).map(path => ({ path })) })
      if (calls === 1) {
        const parent = ctx.sessions.list().findLast(session => session.header.origin !== 'subagent')
        const plan = parent?.snapshotEvents().findLast(event => event.type === 'todo/write')
        return toolCallResponse('todo-' + ++serial, 'todo_write', { todos: plan.data.todos.map(item => item.content === '交付 Markdown/HTML 报告' ? { ...item, status: 'completed' } : item) })
      }
      return textResponse('已交付验收报告；缺少实时金融数据。')
    }
    const targets = messages.includes('综合并交叉质证；') ? paths.filter(path => /report\.(md|html)$/.test(path)) : paths.slice(-1)
    if (calls < targets.length) {
      const path = targets[calls]
      return toolCallResponse('write-' + ++serial, 'write', { file_path: path, content: path.endsWith('.html')
        ? '<!doctype html><html lang="zh"><meta charset="utf-8"><title>隔离验收报告</title><h1>隔离验收报告</h1><p>来源：测试材料。日期：2026-10-15。缺少实时金融数据，置信度低。</p></html>'
        : '# 隔离验收报告\n\n来源：测试材料。日期：2026-10-15。缺少实时金融数据，置信度低。\n' })
    }
    return textResponse('已写入验收文件，数据缺口已注明。')
  }))
  adapter.providerInfo = provider => ({ id: provider, name: '验收脚本' })
  adapter.listModels = async provider => [{ provider, id: 'reports', name: '验收报告' }]
  return adapter
}
