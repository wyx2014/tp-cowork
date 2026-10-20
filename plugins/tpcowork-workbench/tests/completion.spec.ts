import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '../../../../deepseek-harness/vendor/cordis/src/index.ts'
import Loader from '../../../../deepseek-harness/vendor/loader/src/index.ts'
import Include from '../../../../deepseek-harness/vendor/include/src/index.ts'
import LlmRuntime, { createUserMessage } from '../../../../deepseek-harness/packages/llm/llm/src/index.ts'
import SessionStore, { SessionId, type SessionEvent } from '../../../../deepseek-harness/packages/core/session/src/index.ts'
import SessionProjections from '../../../../deepseek-harness/packages/session/session-projection/src/index.ts'
import SystemPrompt from '../../../../deepseek-harness/packages/core/system-prompt/src/index.ts'
import Tools from '../../../../deepseek-harness/packages/core/tools/src/index.ts'
import Agents from '../../../../deepseek-harness/packages/core/agent/src/index.ts'
import AgentLoop from '../../../../deepseek-harness/packages/core/agent-loop/src/index.ts'
import FsLocal from '../../../../deepseek-harness/packages/fs/fs-local/src/index.ts'
import WorkingDirectory from '../../../../deepseek-harness/packages/session/working-directory/src/index.ts'
import * as Todo from '../../../../deepseek-harness/packages/todo/tool-todo/src/index.ts'
import * as Present from '../../../../deepseek-harness/packages/deliverables/tool-present/src/index.ts'
import { MockAdapter, textResponse, toolCallResponse, maxTokensResponse } from '../../../../deepseek-harness/packages/core/agent-loop/tests/mock-adapter.ts'
import * as Workbench from '../index.js'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const active = [
  { content: '生成并校验 PPT', status: 'completed' },
  { content: '交付最终 pptx', status: 'in_progress' },
]
const completed = active.map(todo => ({ ...todo, status: 'completed' }))
const plan = () => toolCallResponse('plan', 'todo_write', { todos: active })
const present = () => toolCallResponse('deliver', 'present', { files: [{ path: 'final.pptx' }] })
const finish = () => toolCallResponse('finish', 'todo_write', { todos: completed })

async function boot(script: ConstructorParameters<typeof MockAdapter>[0], fileExists = true) {
  const cwd = await mkdtemp(join(tmpdir(), 'tpcowork-todo-'))
  cleanups.push(() => rm(cwd, { recursive: true, force: true }))
  const configPath = join(cwd, 'cordis.yml')
  await copyFile(new URL('./fixtures/cordis.yml', import.meta.url), configPath)
  if (fileExists) await writeFile(join(cwd, 'final.pptx'), 'fixture deliverable')
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['llm', LlmRuntime], ['session', SessionStore], ['projections', SessionProjections],
    ['prompt', SystemPrompt], ['tools', Tools], ['agents', Agents], ['loop', AgentLoop],
    ['fs', FsLocal], ['working-directory', WorkingDirectory],
    ['todo', Todo], ['present', Present], ['workbench', Workbench],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected fixture plugin: ${specifier}`)
      return modules.get(specifier)
    },
  } as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('completion'), { provider: 'mock', model: 'mock' }, { cwd })
  const run = async () => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '完成 PPT 并交付' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    return agent.session.snapshotEvents()
  }
  return { ctx, agent, adapter, run }
}

function reminders(events: readonly SessionEvent[]) {
  return events.flatMap(event => event.type === 'user/message' && String(event.data.source.kind) === 'tpcowork-task-completion'
    ? [event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')]
    : [])
}

it('reconciles the real todo projection after the real present tool succeeds, before replying', async () => {
  const { ctx, agent, adapter, run } = await boot([plan(), present(), finish(), textResponse('PPT 已完成。')])
  const events = await run()
  expect(events.some(event => event.type === 'deliverables/presented')).toBe(true)
  expect(ctx.sessionProjections.stateOf(agent.session, 'todos')).toEqual(completed)
  expect(adapter.requests).toHaveLength(4)
  await expect(reminders(events).join('\n') + '\n')
    .toMatchFileSnapshot(new URL('./fixtures/delivery-reminder.expected.txt', import.meta.url).pathname)
})

it('continues the same turn once when a final response leaves the delivery task active', async () => {
  const { ctx, agent, run } = await boot([plan(), present(), textResponse('PPT 已完成。'), finish(), textResponse('任务已完成。')])
  const events = await run()
  expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
  expect(events.filter(event => event.type === 'turn/end').at(-1)?.data.reason).toEqual({ kind: 'completed' })
  expect(ctx.sessionProjections.stateOf(agent.session, 'todos')).toEqual(completed)
  await expect(reminders(events).join('\n\n') + '\n')
    .toMatchFileSnapshot(new URL('./fixtures/stop-reminder.expected.txt', import.meta.url).pathname)
})

it('bounds ignored stop reminders to one per turn and never fabricates completion', async () => {
  const { ctx, agent, adapter, run } = await boot([
    plan(), textResponse('完成。'), textResponse('完成。'),
    plan(), textResponse('完成。'), textResponse('完成。'),
  ])
  await run()
  const events = await run()
  expect(reminders(events)).toHaveLength(2)
  expect(adapter.requests).toHaveLength(6)
  expect(ctx.sessionProjections.stateOf(agent.session, 'todos')).toEqual(active)
})

it('does not treat a failed delivery as completed', async () => {
  const pending = active.map(todo => todo.status === 'in_progress' ? { ...todo, status: 'pending' } : todo)
  const { ctx, agent, run } = await boot([
    plan(), present(), toolCallResponse('blocked', 'todo_write', { todos: pending }), textResponse('文件不存在，交付未完成。'),
  ], false)
  const events = await run()
  expect(events.some(event => event.type === 'deliverables/presented')).toBe(false)
  expect(reminders(events)).toEqual([])
  expect(ctx.sessionProjections.stateOf(agent.session, 'todos')).toEqual(pending)
})

it('waits for the final tool outcome when another plugin rejects a delivery', async () => {
  const pending = active.map(todo => ({ ...todo, status: 'pending' }))
  const { ctx, run } = await boot([
    plan(), present(), toolCallResponse('blocked', 'todo_write', { todos: pending }), textResponse('交付被阻止。'),
  ])
  ctx.on('tools/post-execute', async (exec, _result, next) => {
    const decision = await next()
    return exec.name === 'present'
      ? { kind: 'block', feedback: [{ type: 'text', text: 'Delivery blocked by another plugin.' }] }
      : decision
  })
  const events = await run()
  expect(events.some(event => event.type === 'deliverables/presented')).toBe(false)
  expect(reminders(events)).toEqual([])
})

it.each([
  { label: 'no plan', script: [textResponse('回答。')] },
  { label: 'completed plan', script: [finish(), present(), textResponse('完成。')] },
  { label: 'token limit', script: [plan(), maxTokensResponse('尚未完成')] },
])('does not add a stop step for $label', async ({ script }) => {
  const { run } = await boot(script)
  expect(reminders(await run())).toEqual([])
})

it('does not continue a canceled turn', async () => {
  const { ctx, agent, run } = await boot([plan(), 'hang'])
  ctx.on('agent/assistant-stream', ({ frame }) => {
    if (frame.type === 'chunk' && agent.session.snapshotEvents().some(event => event.type === 'todo/write')) {
      agent.cancel({ kind: 'user' })
    }
  })
  const events = await run()
  expect(reminders(events)).toEqual([])
  expect(ctx.sessionProjections.stateOf(agent.session, 'todos')).toEqual(active)
})

it('removes both reminders when the plugin unloads', async () => {
  const { ctx, run } = await boot([plan(), present(), textResponse('完成。')])
  const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'workbench')
  expect(entry).toBeDefined()
  await entry!.fiber!.dispose()
  expect(reminders(await run())).toEqual([])
})
