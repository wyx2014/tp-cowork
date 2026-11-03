import { registerHooks } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, seedSession } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = join(root, 'artifacts/workspace-removal')
const SEED = join(root, '../deepseek-harness/snapshots/web/seeded-history/session.v3.jsonl')
const SEED_ID = 'tpcowork-workspace-removal-seed'

it('shows no 未分组, hides a removed workspace\'s sessions with it, as ZCode does, and gives them back when the folder is added again', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => hooks.deregister())
  const scaffold = await launchWebScaffold({
    profile: { hmr: false, packages: ['tpcowork-ui', 'tpcowork-archives'].map(name => ({ dir: join(root, 'plugins', name), enabled: true })) },
  })
  onTestFinished(() => scaffold.close())
  // One workspace with one stored conversation, as after real use.
  const registry = scaffold.ctx.workspaceRegistry
  const first = await registry.create(scaffold.workspaceCwd)
  await seedSession(scaffold, await readFile(SEED, 'utf8'), SEED_ID)
  await first.attachSession(SEED_ID)
  const { title } = await scaffold.ctx.sessionController.rename({ sessionId: SEED_ID, title: '季度报告整理' })

  const browser = await chromium.launch({ executablePath: process.env.TPCOWORK_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, locale: 'zh-CN' })
  await page.addInitScript(() => localStorage.setItem('tpcowork.first-run-guide.v1', 'done'))
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await mkdir(artifacts, { recursive: true })
  await page.goto(scaffold.authenticatedUrl)
  const session = page.getByRole('treeitem').filter({ has: page.getByText(title, { exact: true }) })
  await session.waitFor()
  const name = first.title
  await page.screenshot({ path: join(artifacts, '1-before.png') })

  // Remove it from the sidebar: the confirmation says the sessions leave with the workspace.
  // The row's actions appear on hover, as for a person.
  await page.getByRole('treeitem', { name: new RegExp(name) }).first().hover()
  await page.getByRole('button', { name: `工作区“${name}”的操作` }).click()
  await page.getByRole('menuitem', { name: '删除工作区' }).click()
  const dialog = page.getByRole('dialog', { name: '删除工作区' })
  await dialog.waitFor()
  await expect.poll(() => dialog.textContent()).toContain('其会话会随工作区一起隐藏，重新添加此文件夹即可恢复。')
  expect(await dialog.textContent()).not.toContain('未分组')
  await page.screenshot({ path: join(artifacts, '2-confirm.png') })
  await dialog.getByRole('button', { name: '删除工作区' }).click()
  await dialog.waitFor({ state: 'hidden' })

  // The conversation is kept but not listed, not even under 未分组.
  await expect.poll(() => registry.list().length).toBe(0)
  await expect.poll(() => session.isVisible()).toBe(false)
  // As in ZCode there is no 未分组: not even the removed workspace's blank draft leaves one behind.
  const ungrouped = page.getByRole('treeitem').filter({ hasText: '未分组' })
  await expect.poll(() => ungrouped.evaluateAll(rows => rows.filter(row => row.checkVisibility()).length)).toBe(0)
  expect((await scaffold.ctx.sessionQuery.listSessions()).some(record => record.header.id === SEED_ID)).toBe(true)
  await page.screenshot({ path: join(artifacts, '3-removed.png') })
  // Still hidden after a reload.
  await page.reload()
  await page.getByRole('button', { name: '设置', exact: true }).waitFor()
  await page.waitForTimeout(500)
  expect(await session.isVisible()).toBe(false)
  expect(await ungrouped.evaluateAll(rows => rows.filter(row => row.checkVisibility()).length)).toBe(0)

  // Adding the same folder again brings the conversation back into it.
  const again = await registry.create(scaffold.workspaceCwd)
  expect(again.id).not.toBe(first.id)
  await expect.poll(() => registry.get(again.id)?.sessionIds.includes(SEED_ID)).toBe(true)
  await session.waitFor()
  await page.screenshot({ path: join(artifacts, '4-restored.png') })
  expect(errors).toEqual([])
})
