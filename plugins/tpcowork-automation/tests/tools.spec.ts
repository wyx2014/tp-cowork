/** Real chat tools, AgentLoop, Host scheduler, Workspace and durable JSONL. Only the model is scripted. */
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { SessionId, appendPluginRecord, pluginRecordOf } from '@deepseek-ai/dsh-session'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Query from '@deepseek-ai/dsh-session-query-sqlite'
import Workspaces from '@deepseek-ai/dsh-workspace'
import Skills from '@deepseek-ai/dsh-skill'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../deepseek-harness/packages/core/agent-loop/tests/mock-adapter.ts'
import Host from '../src/host.ts'
import { chatDate } from '../src/tools.ts'
import { payloadSchema } from '../src/schemas.ts'
import { createClient } from '../src/client.ts'
import type { AutomationRemoteApi } from '../src/types.ts'
import type { ScheduledTask } from '../src/types.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function harness(script: ConstructorParameters<typeof MockAdapter>[0] = []) {
  const root = await mkdtemp(join(tmpdir(), 'automation-tools-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  await ctx.plugin(TypertRegistry)
  const backend = new JsonStorageBackend(join(root, 'storage'))
  ctx.effect(() => ctx.storage.backend.register('test', backend))
  const domains = new DomainFacility(ctx, { backend: 'test' })
  ctx.provide('storageDomain', domains)
  ctx.effect(() => async () => { await domains.closeAll(); await backend.close() })
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(Query, { path: join(root, 'query.sqlite'), openAt: 'never' })
  await ctx.plugin(Workspaces)
  await ctx.plugin(Skills)
  await ctx.plugin(DefaultModel, { provider: 'user-model', model: 'current' })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['user-model'], adapter)
  const projectPath = join(root, 'project')
  const effectivePath = join(root, 'effective')
  await mkdir(projectPath)
  await mkdir(effectivePath)
  const project = await ctx.workspaceRegistry.create(projectPath)
  const handle = await ctx.agents.create({ sessionId: SessionId('chat'), meta: { cwd: projectPath },
    agentOptions: { provider: 'user-model', model: 'current' } })
  const source = handle.agent
  await project.attachSession(source.id)
  await ctx.workingDirectory.set(source, effectivePath)
  let plugin = await ctx.plugin(Host)
  let callId = 0
  async function call(args: object, agent: Agent | undefined = source) {
    const result = await ctx.tools.execute({ name: 'cron', callId: ToolCallId(`cron-${++callId}`), arguments: args,
      ...agent ? { agent } : {}, signal: new AbortController().signal })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    return result.value as string
  }
  async function settled(task: ScheduledTask) {
    await vi.waitFor(() => expect(ctx.automation.getTask(task.id).runs[0]?.status).not.toBe('running'))
    return ctx.automation.getTask(task.id).runs[0]!
  }
  return { ctx, root, source, project, effectivePath: ctx.workingDirectory.get(source.session), adapter, call, settled,
    async reload() { await plugin.dispose(); plugin = await ctx.plugin(Host) },
    async unload() { await plugin.dispose() },
  }
}
const add = (extra: object = {}) => ({ action: 'add', message: '喝水', mode: 'reminder',
  at: new Date(Date.now() + 3_600_000).toISOString(), ...extra })

describe('automation chat tools', () => {
  it('uses the shared catalog, inherits original project/effective cwd/active skill/public MCP, and round-trips once edits', async () => {
    const h = await harness()
    h.ctx.skills.register({ name: 'report', description: '报告', source: 'runtime', content: 'skill' })
    h.source.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'skill' }],
      source: { kind: 'skill-invocation', name: 'report', form: 'instructions' } }), { surfaceOp: 'append' })
    h.ctx.tools.register({ name: 'mcp__docs__read', description: 'docs', parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] }, execute: async () => 'docs' })
    await h.call(add({ name: '日期提醒', description: '测试说明' }))
    const task = (await h.ctx.automation.list()).tasks[0]!
    expect(task).toMatchObject({ name: '日期提醒', description: '测试说明', executionMode: 'reminder',
      originSessionId: 'chat', projectId: h.project.id, workspacePath: h.effectivePath, skillName: 'report', mcpPresets: [{ name: 'docs' }],
      schedule: { frequency: 'once' } })
    expect(payloadSchema.parse(await h.ctx.automation.list()).tasks[0]).toEqual(task)
    expect(JSON.parse(await h.call({ action: 'list' }))[0]).toMatchObject({ id: task.id, mode: 'reminder', schedule: task.schedule })
    const { id, name, prompt, description, schedule, executionMode, projectId, workspacePath, skillName, mcpPresets } = task
    await h.ctx.automation.update({ id, data: { name: name + '编辑', prompt, description, schedule, executionMode, projectId, workspacePath, skillName, mcpPresets } })
    expect(h.ctx.automation.getTask(id).schedule).toEqual(schedule)
    await h.reload()
    expect(h.ctx.automation.getTask(id).schedule).toEqual(schedule)
    await h.call({ action: 'remove', job_id: id })
    expect(await h.call({ action: 'list' })).toBe('No scheduled jobs.')
  })

  it.each([
    { cron_expr: '*/7 9-17 * * MON-FRI', repeat: true },
    { cron_expr: '0 9 * * * 15 2028', repeat: true },
    { cron_expr: '@weekly', tz: 'Asia/Shanghai', repeat: true },
    { every_seconds: 75, repeat: true },
  ])('preserves an explicitly requested custom selector through edit and restart: %j', async selector => {
    const h = await harness()
    const args: Record<string, unknown> = add({ ...selector, mode: 'task' })
    delete args.at
    expect(await h.call(args)).toContain('Created job')
    const task = (await h.ctx.automation.list()).tasks[0]!
    expect(task.executionMode).toBe('agent')
    expect(task.schedule).toMatchObject('cron_expr' in selector ? { frequency: 'custom', cronExpression: selector.cron_expr }
      : { frequency: 'custom', everyMs: 75_000 })
    await h.ctx.automation.update({ id: task.id, data: { name: task.name, prompt: task.prompt, schedule: task.schedule } })
    expect(h.ctx.automation.getTask(task.id).schedule).toEqual(task.schedule)
    await h.reload()
    expect(h.ctx.automation.getTask(task.id).schedule).toEqual(task.schedule)
  })

  it.each([
    { message: '' }, { mode: undefined }, { at: '2030-02-30T09:00:00' }, { at: '2000-01-01T00:00:00Z' },
    { at: undefined }, { every_seconds: 10 }, { at: undefined, every_seconds: 10 },
    { at: undefined, every_seconds: -1, repeat: true }, { at: undefined, every_seconds: 1e15, repeat: true },
    { at: undefined, cron_expr: '0 9 * * *' }, { at: undefined, cron_expr: 'invalid', repeat: true },
    { at: undefined, cron_expr: '0 9 * * *', tz: 'No/SuchZone', repeat: true },
    { tz: 'UTC' }, { repeat: true },
  ])('rejects invalid/action-specific inputs without creating a job: %j', async fields => {
    const h = await harness()
    // JSON dispatch cannot carry undefined values.
    expect(await h.call(JSON.parse(JSON.stringify(add(fields))))).toContain('Error:')
    expect((await h.ctx.automation.list()).tasks).toEqual([])
  })

  it('guards only open automatic turns and their live fork context, retaining delegated boundaries and list/remove', async () => {
    const h = await harness()
    await h.call(add({ name: '自动化运行中的名字也可以是普通用户任务' }))
    const task = (await h.ctx.automation.list()).tasks[0]!
    const run = await h.ctx.automation.beginRun({ taskId: task.id, trigger: 'manual' })
    const owned = await h.ctx.agents.create({ sessionId: SessionId('owned'), meta: { cwd: h.project.path } })
    appendPluginRecord(owned.agent.session, 'plugin:tpcowork-automation/run', { version: 1,
      taskId: task.id, runId: run.id, sessionId: owned.agent.id, turnId: 1 })
    owned.agent.session.append('turn/start', { turn: 1 })
    owned.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'run' }],
      source: { kind: 'tpcowork-automation', taskId: task.id, runId: run.id } }), { surfaceOp: 'append' })
    expect(await h.call(add(), owned.agent)).toContain('不能在自动化')
    await h.ctx.sessions.flush(owned.agent.session)
    await owned.dispose()
    const resumed = await h.ctx.agents.resume({ resumeSessionId: SessionId('owned') })
    // Resume repairs the interrupted turn, without removing durable ownership.
    expect(resumed.agent.session.snapshotEvents().some(event => event.type === 'turn/end'
      && event.data.reason.kind === 'interrupted')).toBe(true)
    expect(await h.call(add(), resumed.agent)).toContain('Created job')
    expect(resumed.agent.session.snapshotEvents().some(event => pluginRecordOf(event)?.type === 'plugin:tpcowork-automation/run')).toBe(true)
    const sourceOnly = await h.ctx.agents.create({ sessionId: SessionId('source-only') })
    sourceOnly.agent.session.append('turn/start', { turn: 1 })
    sourceOnly.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'run' }],
      source: { kind: 'tpcowork-automation', taskId: task.id, runId: run.id } }), { surfaceOp: 'append' })
    expect(await h.call(add(), sourceOnly.agent)).toContain('不能在自动化')
    const fork = h.ctx.sessions.fork(sourceOnly.agent.session, undefined, SessionId('fork'))
    const forkEvents = fork.snapshotEvents()
    const forked = await h.ctx.agents.create({ sessionId: SessionId('forked-agent'), seed: forkEvents,
      meta: { isSeeded: true, parentSession: sourceOnly.agent.id }, inheritedEventCount: fork.inheritedEventCount })
    expect(await h.call(add(), forked.agent)).toContain('不能在自动化')
    sourceOnly.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(await h.call(add(), forked.agent)).toContain('Created job')
    const child = await h.ctx.agents.create({ sessionId: SessionId('child'), meta: { origin: 'subagent', delegationDepth: 1 } })
    expect(await h.call(add(), child.agent)).toContain('不能在自动化')
    expect(await h.call({ action: 'list' }, resumed.agent)).toContain(task.id)
    await h.ctx.automation.finishRun({ taskId: task.id, runId: run.id, status: 'completed', resultType: 'none', conversationAvailable: false })
    expect(await h.call({ action: 'remove', job_id: task.id }, resumed.agent)).toContain('Removed job')
  })

  it('real chat creates a task, the independent result Agent cannot recursively create another task, and defaults stay unchanged', async () => {
    const h = await harness([toolCallResponse('create', 'cron', add({ mode: 'task' })), textResponse('已创建'),
      toolCallResponse('recursive', 'cron', add()), textResponse('执行完成')])
    const defaults = h.ctx.agentDefaultModel.currentSelection()
    h.source.followup(createUserMessage({ content: [{ type: 'text', text: '在指定时间执行任务' }], source: { kind: 'user' } }))
    await h.source.whenIdle()
    const task = (await h.ctx.automation.list()).tasks[0]!
    expect(task, JSON.stringify(h.source.session.snapshotEvents())).toBeDefined()
    await h.ctx.automation.runNow({ id: task.id })
    const run = await h.settled(task)
    expect(run).toMatchObject({ status: 'completed', resultType: 'conversation', conversationAvailable: true, ownsSession: true })
    expect(run.sessionId).not.toBe(h.source.id)
    const handle = await h.ctx.sessionPersistence.open(run.sessionId!, 'read')
    try { expect(JSON.stringify((await handle.read()).events)).toContain('不能在自动化运行') }
    finally { await handle.close() }
    expect((await h.ctx.automation.list()).tasks).toHaveLength(1)
    expect(h.ctx.agentDefaultModel.currentSelection()).toEqual(defaults)
  })

  it.each([false, true])('pure reminder emits a committed result without inference/Session and acknowledgement survives restart; recurring=%s', async repeat => {
    const h = await harness()
    const args: Record<string, unknown> = add()
    if (repeat) { delete args.at; Object.assign(args, { every_seconds: 3600, repeat: true }) }
    await h.call(args)
    const task = (await h.ctx.automation.list()).tasks[0]!
    const sessionCount = (await h.ctx.sessionPersistence.list()).length
    let committed = false
    h.ctx.on('automation/changed', change => {
      if (change.reason === 'run_finished' && change.taskId === task.id) {
        committed = h.ctx.automation.getTask(task.id).runs[0]?.status === 'completed'
      }
    })
    await h.ctx.automation.runNow({ id: task.id })
    const run = await h.settled(task)
    expect(run).toMatchObject({ status: 'completed', resultType: 'none', conversationAvailable: false, ownsSession: false })
    expect(run.sessionId).toBeUndefined()
    expect(h.adapter.requests).toHaveLength(0)
    expect((await h.ctx.sessionPersistence.list()).length).toBe(sessionCount)
    await vi.waitFor(() => expect(committed).toBe(true))
    const before = await h.ctx.automation.list()
    let release!: (value: { ok: true; value: typeof before }) => void
    const delayed = new Promise<{ ok: true; value: typeof before }>(resolve => { release = resolve })
    const list = vi.fn().mockImplementationOnce(() => delayed).mockImplementation(async () => ({ ok: true, value: await h.ctx.automation.list() }))
    const remote = { list, markRunViewed: async (request: Parameters<typeof h.ctx.automation.markRunViewed>[0]) =>
      ({ ok: true, value: await h.ctx.automation.markRunViewed(request) }) } as unknown as AutomationRemoteApi
    const client = createClient(remote)
    const oldPoll = client.list()
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    const acknowledged = await client.markRunViewed({ taskId: task.id, runId: run.id })
    release({ ok: true, value: before })
    expect(await oldPoll).toEqual(acknowledged)
    expect(list).toHaveBeenCalledTimes(2)
    await h.reload()
    const tasks = (await h.ctx.automation.list()).tasks
    expect(tasks).toHaveLength(repeat ? 1 : 0)
    if (repeat) expect(tasks[0]).toMatchObject({ id: task.id, status: 'active', runs: [{ viewedAt: expect.any(Number) }] })
  })

  it('lists only the shared user catalog and withdraws cron on Host unload', async () => {
    const h = await harness()
    h.ctx.provide('schedule' as never, { catalog: () => [{ id: 'system-internal', title: 'dream' }] } as never)
    expect(await h.call({ action: 'list' })).toBe('No scheduled jobs.')
    expect(await h.call({ action: 'remove' })).toContain('Error:')
    await h.unload()
    expect(h.ctx.tools.schemas(h.source).some(tool => tool.name === 'cron')).toBe(false)
  })

  it.each(['ambiguous', 'too-many'])('refuses unclear or oversized public MCP bindings without silently changing them: %s', async kind => {
    const h = await harness()
    const names = kind === 'ambiguous' ? ['mcp__docs__nested__read'] : Array.from({ length: 9 }, (_, i) => `mcp__server${i}__read`)
    for (const name of names) h.ctx.tools.register({ name, description: name, parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] }, execute: async () => 'doc' })
    expect(await h.call(add())).toContain('Error:')
    expect((await h.ctx.automation.list()).tasks).toEqual([])
  })

  it('requires an actual Agent session and preserves cancellation before a write', async () => {
    const h = await harness()
    const exec = { name: 'cron', callId: ToolCallId('no-agent'), arguments: add(), signal: new AbortController().signal }
    const missing = await h.ctx.tools.execute(exec)
    expect(missing.value).toContain('必须从聊天会话')
    const controller = new AbortController()
    controller.abort()
    expect((await h.ctx.tools.execute({ ...exec, agent: h.source, signal: controller.signal })).isError).toBe(true)
    expect((await h.ctx.automation.list()).tasks).toEqual([])
  })
})

describe('chat naive datetime uses Host zone / source fold behavior', () => {
  it.each([
    ['2030-01-02T09:30:15.125', 'Asia/Shanghai', '2030-01-02T01:30:15.125Z'],
    ['2030-01-02', 'UTC', '2030-01-02T00:00:00.000Z'],
    ['2030-01-02T09:30:00+08:00', 'UTC', '2030-01-02T01:30:00.000Z'],
    ['2026-11-01T01:30:00', 'America/New_York', '2026-11-01T05:30:00.000Z'],
    ['2026-03-08T02:30:00', 'America/New_York', '2026-03-08T07:30:00.000Z'],
  ])('%s in %s', (value, timezone, expected) => { expect(chatDate(value, timezone)).toBe(expected) })
})
