import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import ComputerUseRegistry from '@deepseek-ai/dsh-computer-use'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import { expect, it, onTestFinished, vi } from 'vitest'

// This Mac may be older than the driver supports; the test covers the provider wiring, with a stand-in driver.
vi.mock('../src/support.ts', () => ({ computerUseSupport: () => ({ supported: true, platform: 'win32' }) }))
const Host = await import('../src/host.ts')

const FAKE = `export class CuaDriver {
  static create() { return new CuaDriver() }
  async callTool(name, json) {
    const reply = value => ({ rawJson: JSON.stringify(value) })
    if (name === 'list_apps') return reply({ structuredContent: { apps: [{ pid: 4242, name: '记事本', running: true, kind: 'desktop' }] } })
    if (name === 'list_windows') return reply({ structuredContent: { windows: [{ window_id: 7, pid: 4242, app_name: '记事本', title: '无标题', bounds: { x: 0, y: 0, width: 400, height: 300 }, is_on_screen: true, z_index: 1 }] } })
    if (name === 'get_window_state') return reply({ structuredContent: { snapshot_id: 's00000001', tree_markdown: '- [0] edit "正文"', window_bounds: { x: 0, y: 0, width: 400, height: 300 }, screenshot_width: 400, screenshot_height: 300, elements_complete: true } })
    if (name === 'set_value') return reply({ structuredContent: { route: 'accessibility', args: JSON.parse(json) } })
    if (name === 'check_permissions') return reply({ structuredContent: { accessibility: true } })
    return reply({ isError: true, content: [{ type: 'text', text: 'unexpected ' + name }] })
  }
  async shutdown() {}
  uniffiDestroy() {}
}`

async function setup(enabled: boolean, choice = 'Allow for this task') {
  const directory = await mkdtemp(join(tmpdir(), 'tpcowork-cu-host-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const driverPath = join(directory, 'driver.mjs')
  await writeFile(driverPath, FAKE)
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(UserQuestions)
  await ctx.plugin(ComputerUseRegistry)
  const questions: string[] = []
  ctx.on('user-questions/request', async (request: { questions: { question: string }[] }) => {
    questions.push(...request.questions.map(item => item.question))
    return { answers: [{ id: 'cua-app-access', selected: [choice] }] }
  })
  await ctx.plugin(Host, { enabled, driverPath })
  const owner = await ctx.agents.create({ sessionId: SessionId('computer-use-test') })
  const cua = (method: string, params: Record<string, unknown> = {}) => ctx.tools.execute({
    name: 'cua', callId: ToolCallId(`call-${method}`), arguments: { method, params }, signal: new AbortController().signal, agent: owner.agent,
  } as never)
  return { ctx, cua, questions }
}

it('provides the cua tool through the helper process when switched on, asking before it controls an app', async () => {
  const { ctx, cua, questions } = await setup(true)
  expect(ctx.computerUse.providerName).toBe('dsh-cua')
  expect(ctx.tools.schemas().map(tool => tool.name)).toContain('cua')
  const app = await cua('getApp', { selector: '记事本' })
  expect(app.isError).toBe(false)
  expect(questions).toEqual(['Allow Computer Use to launch if needed, read, capture, and control 记事本?'])
  const { appHandle } = app.value as { appHandle: string }
  const state = await cua('getState', { appHandle })
  expect(state.value).toMatchObject({ windowId: 7, snapshotId: 's00000001', tree: expect.stringContaining('[0] edit "正文"') })
  const set = await cua('setValue', { appHandle, snapshotId: 's00000001', elementIndex: 0, value: '你好' })
  expect(set.value).toEqual({ dispatched: true, verified: false })
})

it('stops at the consent refusal, and offers nothing while the switch is off', async () => {
  const denied = await setup(true, 'Deny')
  const refused = await denied.cua('getApp', { selector: '记事本' })
  expect(refused.isError).toBe(true)
  expect(JSON.stringify(refused.content)).toContain('APP_ACCESS_DENIED')
  const off = await setup(false)
  expect(off.ctx.tools.schemas().map(tool => tool.name)).not.toContain('cua')
  expect(off.ctx.computerUse.providerName).toBeUndefined()
})
