/** Real AgentLoop + JSONL persistence; only the external LLM stream is scripted. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { Session, SessionId, SessionLogOffset, appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Query from '@deepseek-ai/dsh-session-query-sqlite'
import Workspaces from '@deepseek-ai/dsh-workspace'
import Skills from '@deepseek-ai/dsh-skill'
import Permissions from '@deepseek-ai/dsh-permission-presets'
import Approval from '@deepseek-ai/dsh-user-approval'
import Presets from '@deepseek-ai/dsh-agent-preset-registry'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse, maxTokensResponse } from '../../../../deepseek-harness/packages/core/agent-loop/tests/mock-adapter.ts'
import { ApiSessionList } from '../../../../deepseek-harness/packages/api/session-controller/src/list.ts'
import Host from '../src/host.ts'
import { DshAutomationExecutor, readAutomationOwnership } from '../src/executor.ts'
import { DshAutomationSessionCleanup } from '../src/cleanup.ts'
import { AutomationStore } from '../src/storage.ts'
import type { ScheduleTaskDraft, ScheduledTask, ScheduledTaskRun } from '../src/types.ts'

const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function rootDirectory() {
  const root = await mkdtemp(join(tmpdir(), 'automation-executor-'))
  directories.push(root)
  return root
}
async function harness(script: ConstructorParameters<typeof MockAdapter>[0] = [textResponse('完成')], root = '', auto = true, search = false) {
  root ||= await rootDirectory()
  const projectA = join(root, 'project-a')
  const projectB = join(root, 'project-b')
  await mkdir(projectA, { recursive: true })
  await mkdir(projectB, { recursive: true })
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(TypertRegistry)
  const backend = new JsonStorageBackend(join(root, 'storage'))
  ctx.effect(() => ctx.storage.backend.register('test', backend))
  const domains = new DomainFacility(ctx, { backend: 'test' })
  ctx.provide('storageDomain', domains)
  ctx.effect(() => async () => { await domains.closeAll(); await backend.close() })
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(Query, { path: join(root, 'query.sqlite'), openAt: search ? 'startup' : 'never' })
  await ctx.plugin(Workspaces)
  await ctx.plugin(Skills)
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  await ctx.plugin(Presets, { default: 'automation-test' })
  await ctx.plugin({
    inject: ['agentPresets'],
    apply(presetCtx: Context) { presetCtx.effect(async () => presetCtx.agentPresets.register({ id: 'automation-test', plugins: [] })) },
  })
  if (auto) await ctx.plugin(DefaultModel, { provider: 'deepseek-user', model: 'deepseek-chat', reasoningEffort: 'high' })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter(script, { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }, { id: ReasoningEffortId('low'), name: 'Low' }], defaultEffort: ReasoningEffortId('high') })
  ctx.llm.registerAdapter(['deepseek-user', 'other-user'], adapter)
  ctx.loader.builtins.automation = Host
  ctx.loader.builtins.include = Include
  const config = join(root, 'cordis.yml')
  await writeFile(config, '- name: cordis:automation\n')
  const entryId = await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  const fiber = ctx.loader.resolve(entryId).fiber!
  if (auto) expect((await ctx.automation.list()).status.enabled).toBe(true)
  const workspaceA = await ctx.workspaceRegistry.create(projectA)
  const workspaceB = await ctx.workspaceRegistry.create(projectB)
  async function create(extra: Partial<ScheduleTaskDraft> & { originSessionId?: SessionId } = {}) {
    const before = new Set((await ctx.automation.list()).tasks.map(task => task.id))
    return (await ctx.automation.create({ name: '任务', prompt: '仅处理本项目', schedule: { frequency: 'manual', timezone: 'UTC' },
      projectId: workspaceA.id, ...extra })).tasks.find(task => !before.has(task.id))!
  }
  const get = async (task: ScheduledTask) => (await ctx.automation.list()).tasks.find(value => value.id === task.id)!
  async function settled(task: ScheduledTask) {
    await vi.waitFor(async () => expect((await get(task)).runs[0]?.status).not.toBe('running'))
    return (await get(task)).runs[0]!
  }
  return { ctx, root, adapter, workspaceA, workspaceB, create, get, settled, fiber }
}
async function stored(ctx: Context, id: SessionId) {
  const handle = await ctx.sessionPersistence.open(id, 'read')
  try { return { header: handle.header, events: (await handle.read()).events } }
  finally { await handle.close() }
}

describe('DSH automation execution', () => {
  it('applies task model, effort and permissions to each fresh run without changing global defaults', async () => {
    const h = await harness([textResponse('one'), textResponse('two')])
    h.ctx.provide('shell', {
      sandboxMode: 'workspace-write',
      resolve() { throw new Error('this test does not execute bash') },
      run() { throw new Error('this test does not execute bash') },
      start() { throw new Error('this test does not execute bash') },
    })
    await h.ctx.plugin(Approval)
    await h.ctx.plugin(Permissions)
    const defaults = h.ctx.agentDefaultModel.currentSelection()
    const permissionDefaults = h.ctx.permissionPresets.catalog()
    const source = await h.ctx.agents.create({ sessionId: SessionId('source-options'), meta: { cwd: h.workspaceA.path } })
    const task = await h.create({ originSessionId: source.agent.id,
      modelSelection: { provider: 'other-user', model: 'task-model', reasoningEffort: 'low' }, permissionPreset: 'danger-full-access' })
    const ids: string[] = []
    for (let index = 0; index < 2; index++) {
      await h.ctx.automation.runNow({ id: task.id })
      const run = await h.settled(task)
      expect(run.status).toBe('completed')
      ids.push(run.sessionId!)
      const log = await stored(h.ctx, run.sessionId!)
      expect(log.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'model/selection', data: { provider: 'other-user', model: 'task-model', reasoningEffort: 'low' } }),
        expect.objectContaining({ type: 'permission/preset', data: { preset: 'danger-full-access' } }),
        expect.objectContaining({ type: 'sandbox/mode', data: { mode: 'danger-full-access' } }),
        expect.objectContaining({ type: 'approval/policy', data: { policy: 'never' } }),
      ]))
    }
    expect(new Set(ids).size).toBe(2)
    expect(h.adapter.requests).toHaveLength(2)
    expect(h.adapter.requests).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'other-user', model: 'task-model', reasoningEffort: 'low' })]))
    expect(h.ctx.agentDefaultModel.currentSelection()).toEqual(defaults)
    expect(h.ctx.permissionPresets.catalog()).toEqual(permissionDefaults)
    expect(h.ctx.permissionPresets.current(source.agent.session)).toBe('workspace-write')
  })

  it('runs an unbound template with an empty directory in the default workspace', async () => {
    const h = await harness()
    const selection = h.ctx.agentDefaultModel.currentSelection()
    const task = await h.create({ projectId: undefined, workspacePath: '', skillName: '', mcpPresets: [],
      schedule: { frequency: 'daily', time: { hour: 8, minute: 30 }, timezone: 'Asia/Shanghai' } })
    await h.ctx.automation.runNow({ id: task.id })
    const run = await h.settled(task)
    expect(run).toMatchObject({ status: 'completed', resultType: 'conversation', conversationAvailable: true })
    const log = await stored(h.ctx, run.sessionId!)
    expect(log.header.cwd).toBe(h.ctx.workingDirectory.defaultDirectory)
    expect(h.adapter.requests).toHaveLength(1)
    expect(h.ctx.agentDefaultModel.currentSelection()).toEqual(selection)
    expect(h.workspaceA.sessionIds).not.toContain(run.sessionId)
    expect(h.workspaceB.sessionIds).not.toContain(run.sessionId)
    const restored = Session.create(log.header.id, log.events, log.header)
    expect(h.ctx.sessionProjections.snapshot(restored).values.tpcoworkAutomation).toBe(true)
    const fork = Session.create(SessionId('ordinary-fork'), log.events, { ...log.header, id: SessionId('ordinary-fork') })
    expect(h.ctx.sessionProjections.snapshot(fork).values.tpcoworkAutomation).toBe(false)
    await h.ctx.automation.delete({ id: task.id })
    expect(h.ctx.sessionProjections.snapshot(restored).values.tpcoworkAutomation).toBe(true)
  })

  it('uses distinct Sessions/runIds twice, preserves project identity/directory, skills, MCP and current model', async () => {
    const h = await harness([textResponse('one'), textResponse('two')])
    const defaults = h.ctx.agentDefaultModel.currentSelection()
    const save = vi.spyOn(h.ctx.agentDefaultModel, 'saveSelection')
    h.ctx.skills.register({ name: 'report', description: '报告', source: 'runtime', content: 'REPORT_SKILL_BODY' })
    h.ctx.tools.register({ name: 'mcp__docs__read', description: '读取文档',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async () => 'doc',
    })
    const source = await h.ctx.agents.create({ sessionId: SessionId('source'), meta: { cwd: h.workspaceA.path } })
    source.agent.session.append('model/selection', { provider: 'other-user', model: 'source-model' })
    source.agent.inject(createUserMessage({ content: [{ type: 'text', text: 'SECRET_SOURCE_CONTEXT' }], source: { kind: 'user' } }))
    await h.ctx.sessions.flush(source.agent.session)
    const task = await h.create({ originSessionId: source.agent.id, workspacePath: h.workspaceB.path,
      skillName: 'report', mcpPresets: [{ name: 'docs' }] })
    const runs: ScheduledTaskRun[] = []
    for (let index = 0; index < 2; index++) {
      const admitted = await h.ctx.automation.runNow({ id: task.id })
      const id = admitted.tasks.find(value => value.id === task.id)!.runs[0]!.id
      const run = await h.settled(task)
      expect(run).toMatchObject({ id, runId: id, status: 'completed', turnId: 1, ownsSession: true,
        resultType: 'conversation', conversationAvailable: true })
      expect(run.sessionId).not.toBe(source.agent.id)
      const log = await stored(h.ctx, run.sessionId!)
      expect(log.header).toMatchObject({ cwd: h.workspaceA.path, isSeeded: false, agentPreset: 'automation-test' })
      expect(log.header.parentSession).toBeUndefined()
      expect(log.events.some(event => event.type === 'working-directory/change' && event.data.cwd === h.workspaceB.path)).toBe(true)
      expect(readAutomationOwnership(log.events)).toMatchObject({ taskId: task.id, runId: id,
        sessionId: run.sessionId, projectId: h.workspaceA.id, originSessionId: source.agent.id })
      expect(JSON.stringify(log.events)).toContain('REPORT_SKILL_BODY')
      expect(JSON.stringify(log.events)).not.toContain('SECRET_SOURCE_CONTEXT')
      expect(h.workspaceA.sessionIds).toContain(run.sessionId)
      expect(h.workspaceB.sessionIds).not.toContain(run.sessionId)
      expect(h.ctx.agents.get(run.sessionId!)).toBeUndefined()
      runs.push(run)
    }
    expect(runs[0]!.sessionId).not.toBe(runs[1]!.sessionId)
    expect(runs[0]!.id).not.toBe(runs[1]!.id)
    expect(h.adapter.requests.map(request => [request.provider, request.model])).toEqual([
      ['other-user', 'source-model'], ['other-user', 'source-model'],
    ])
    expect(h.adapter.requests.every(request => JSON.stringify(request.messages).includes('docs'))).toBe(true)
    expect(h.ctx.agentDefaultModel.currentSelection()).toEqual(defaults)
    expect(save).not.toHaveBeenCalled()
  })

  it('publishes explicit running conversation availability and can follow it before completion; unrelated turns cannot settle it', async () => {
    const h = await harness(['hang'])
    const frames: { sessionId: SessionId; type: string }[] = []
    h.ctx.on('agent/assistant-stream', ({ agent, frame }) => { frames.push({ sessionId: agent.id, type: frame.type }) })
    const task = await h.create()
    await h.ctx.automation.runNow({ id: task.id })
    await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
    await vi.waitFor(async () => expect((await h.get(task)).runs[0]!.conversationAvailable).toBe(true))
    const run = (await h.get(task)).runs[0]!
    expect(run).toMatchObject({ status: 'running', resultType: 'conversation', conversationAvailable: true,
      sessionKey: run.sessionId, conversationId: run.sessionId })
    using view = await h.ctx.sessionQuery.observeSession(run.sessionId!)
    expect(view.source).toBe('live')
    expect(view.events.some(event => event.type === 'user/message')).toBe(true)
    expect(frames.some(frame => frame.sessionId === run.sessionId && frame.type === 'chunk')).toBe(true)
    const foreign = await h.ctx.agents.create({ sessionId: SessionId('foreign'), meta: { cwd: h.workspaceB.path } })
    foreign.agent.session.append('turn/start', { turn: 1 })
    foreign.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect((await h.get(task)).runs[0]!.status).toBe('running')
    h.ctx.agents.get(run.sessionId!)!.cancel({ kind: 'user' })
    expect(await h.settled(task)).toMatchObject({ status: 'error', errorCode: 'run_interrupted', conversationAvailable: true })
  })

  it('does not treat accepted queue delivery or an empty rejected turn as successful execution', async () => {
    const h = await harness([])
    h.ctx.on('agent/pre-step', async () => ({ kind: 'reject' }))
    const task = await h.create()
    await h.ctx.automation.runNow({ id: task.id })
    expect(await h.settled(task)).toMatchObject({ status: 'error', errorCode: 'execution_failed' })
    expect(h.adapter.requests).toEqual([])
  })

  it.each([
    ['provider failure', [{ type: 'finish', reason: { kind: 'error', error: { code: 'AUTHENTICATION', message: 'private upstream token' } } }]],
    ['output ceiling', maxTokensResponse('partial')],
  ] as const)('does not report success on %s', async (_label, chunks) => {
    const h = await harness([[...chunks]])
    const task = await h.create()
    await h.ctx.automation.runNow({ id: task.id })
    const run = await h.settled(task)
    expect(run).toMatchObject({ status: 'error', errorCode: 'execution_failed', conversationAvailable: true })
    expect(h.adapter.requests).toHaveLength(1)
    expect(run.error).not.toContain('private upstream token')
  })

  it('captures the default once for an in-flight run and leaves current defaults/sources untouched', async () => {
    const h = await harness(['hang', textResponse('next')])
    const save = vi.spyOn(h.ctx.agentDefaultModel, 'saveSelection')
    const task = await h.create()
    await h.ctx.automation.runNow({ id: task.id })
    await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
    const original = h.adapter.requests[0]!
    vi.spyOn(h.ctx.agentDefaultModel, 'currentSelection').mockReturnValue({ provider: 'other-user', model: 'changed-default' })
    const run = (await h.get(task)).runs[0]!
    h.ctx.agents.get(run.sessionId!)!.cancel({ kind: 'user' })
    expect(await h.settled(task)).toMatchObject({ status: 'error', errorCode: 'run_interrupted' })
    expect([original.provider, original.model, original.reasoningEffort]).toEqual(['deepseek-user', 'deepseek-chat', 'high'])
    await h.ctx.automation.runNow({ id: task.id })
    await h.settled(task)
    expect(h.adapter.requests[1]).toMatchObject({ provider: 'other-user', model: 'changed-default' })
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps reminders as none without allocating Sessions or invoking an LLM', async () => {
    const h = await harness([])
    const task = await h.create({ executionMode: 'reminder' })
    await h.ctx.automation.runNow({ id: task.id })
    const run = await h.settled(task)
    expect(run).toMatchObject({ status: 'completed', resultType: 'none', conversationAvailable: false, ownsSession: false })
    expect(run.sessionId).toBeUndefined()
    expect(await h.ctx.sessionPersistence.list()).toEqual([])
    expect(h.adapter.requests).toEqual([])
  })

  it.each(['skill', 'mcp', 'project'] as const)('fails closed for an unavailable %s binding', async binding => {
    const h = await harness([])
    const task = await h.create(binding === 'skill' ? { skillName: 'missing' }
      : binding === 'mcp' ? { mcpPresets: [{ name: 'missing' }] } : {})
    if (binding === 'project') await h.ctx.workspaceRegistry.delete(h.workspaceA.id)
    await h.ctx.automation.runNow({ id: task.id })
    expect(await h.settled(task)).toMatchObject({ status: 'error', errorCode: 'execution_failed', conversationAvailable: false })
    expect(h.adapter.requests).toEqual([])
  })

  it('cancels and drains its owned live Agent on plugin unload, retaining the persisted result', async () => {
    const h = await harness(['hang-slow'])
    const task = await h.create()
    await h.ctx.automation.runNow({ id: task.id })
    await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
    const run = (await h.get(task)).runs[0]!
    const owned = h.ctx.agents.get(run.sessionId!)!
    await h.fiber.dispose()
    expect(h.adapter.requests[0]!.signal?.aborted).toBe(true)
    expect(h.ctx.agents.get(run.sessionId!)).toBeUndefined()
    expect(owned.status).toBe('idle')
    await h.ctx.plugin(Host)
    await vi.waitFor(async () => expect((await h.ctx.automation.list()).status.enabled).toBe(true))
    expect(await h.settled(task)).toMatchObject({ id: run.id, status: 'error', errorCode: 'run_interrupted' })
    expect(h.adapter.requests).toHaveLength(1)
  })

  it.each(['flush', 'read'])('retains running when terminal %s fails, then recovers the real persisted result without replay', async failure => {
    const h = await harness([textResponse('durable')])
    const task = await h.create()
    const flush = h.ctx.sessions.flush.bind(h.ctx.sessions)
    let failed = false
    if (failure === 'flush') vi.spyOn(h.ctx.sessions, 'flush').mockImplementation(async session => {
        using cut = await h.ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none' })
        if (!failed && cut.events.some(event => event.type === 'turn/end')) { failed = true; throw new Error('disk unavailable') }
        return flush(session)
      })
    else {
      const open = h.ctx.sessionPersistence.open.bind(h.ctx.sessionPersistence)
      vi.spyOn(h.ctx.sessionPersistence, 'open').mockImplementation(async (...args) => {
        if (!failed && args[1] === 'read') { failed = true; throw new Error('read unavailable') }
        return open(...args)
      })
    }
    await h.ctx.automation.runNow({ id: task.id })
    await vi.waitFor(() => expect(failed).toBe(true))
    await vi.waitFor(() => expect(h.ctx.agents.get((h.ctx.automation.getTask(task.id).runs[0]!.sessionId)!)).toBeUndefined())
    expect((await h.get(task)).runs[0]!.status).toBe('running')
    const id = (await h.get(task)).runs[0]!.id
    await h.fiber.dispose()
    await h.ctx.fiber.dispose()
    const next = await harness([], h.root)
    expect((await next.get(task)).runs[0]).toMatchObject({ id, status: 'completed', conversationAvailable: true })
    using restored = await next.ctx.sessionQuery.observeSession((await next.get(task)).runs[0]!.sessionId!)
    expect(restored.source).toBe('prepared')
    expect(next.adapter.requests).toEqual([])
  })
})

describe('read-only exact-turn recovery', () => {
  async function seed(reason?: TurnEndReason, age = 0) {
    const h = await harness([], '', false)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now - age)
    const task = await h.create()
    const run = await h.ctx.automation.beginRun({ taskId: task.id, trigger: 'manual' })
    clock.mockRestore()
    const sessionId = SessionId(`recovery-${run.id}`)
    await h.ctx.automation.bindRun({ taskId: task.id, runId: run.id, sessionId, turnId: 1, ownsSession: true })
    const session = h.ctx.sessions.prepare(sessionId, { meta: { cwd: h.workspaceA.path } })
    appendPluginRecord(session, 'plugin:tpcowork-automation/run', { version: 1, taskId: task.id, runId: run.id, sessionId, turnId: 1 })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: task.prompt }],
      source: { kind: 'tpcowork-automation', taskId: task.id, runId: run.id } }), { surfaceOp: 'append' })
    if (reason) session.append('turn/end', { turn: 1, reason })
    const writer = await h.ctx.sessionPersistence.create(session.header)
    // This fixture owns the detached events; the runtime reader always uses persistence handles.
    await writer.append(session.snapshotEvents())
    await writer.close()
    return { ...h, task, run: { ...run, sessionId, turnId: 1, ownsSession: true }, executor: new DshAutomationExecutor(h.ctx) }
  }
  it.each([
    [{ kind: 'completed' }, 'completed', undefined],
    [{ kind: 'error', error: { code: 'UNKNOWN', message: 'private error' } }, 'error', 'execution_failed'],
    [{ kind: 'aborted', reason: { kind: 'user' } }, 'error', 'run_interrupted'],
    [{ kind: 'interrupted' }, 'error', 'run_interrupted'],
    [{ kind: 'blocked' }, 'error', 'execution_failed'],
  ] as const)('recovers %j using its persisted turn/end', async (reason, status, errorCode) => {
    const h = await seed(reason)
    const outcome = await h.executor.recover({ task: h.task, run: h.run, signal: new AbortController().signal })
    expect(outcome).toMatchObject({ status, resultType: 'conversation', conversationAvailable: true })
    expect(outcome?.errorCode).toBe(errorCode)
    expect(JSON.stringify(outcome)).not.toContain('private error')
    expect(h.adapter.requests).toEqual([])
  })

  it('does not accept synthetic cold-query interruption, other turns, forged ownership or a missing Session as terminal evidence', async () => {
    const h = await seed()
    const query = () => h.executor.recover({ task: h.task, run: h.run, signal: new AbortController().signal })
    using cold = await h.ctx.sessionQuery.observeSession(h.run.sessionId)
    expect(cold.events.some(event => event.type === 'turn/end' && event.data.reason.kind === 'interrupted')).toBe(true)
    expect(await query()).toBeUndefined()
    const signal = new AbortController().signal
    expect(await h.executor.recover({ task: h.task, run: { ...h.run, sessionId: SessionId('missing') }, signal })).toBeUndefined()
    expect(await h.executor.recover({ task: h.task, run: { ...h.run, ownsSession: false }, signal })).toBeUndefined()
    expect(await h.executor.recover({ task: h.task, run: { ...h.run, turnId: 999 }, signal })).toBeUndefined()
    const foreignTask = await h.create({ name: 'foreign' })
    expect(await h.executor.recover({ task: foreignTask, run: h.run, signal })).toBeUndefined()
  })

  it('propagates read failures and cancellation instead of reporting no evidence', async () => {
    const h = await seed({ kind: 'completed' })
    const signal = new AbortController()
    const read = vi.spyOn(h.ctx.sessionPersistence, 'open').mockRejectedValueOnce(new Error('read unavailable'))
    await expect(h.executor.recover({ task: h.task, run: h.run, signal: signal.signal })).rejects.toThrow('read unavailable')
    read.mockRestore()
    signal.abort()
    await expect(h.executor.recover({ task: h.task, run: h.run, signal: signal.signal })).rejects.toThrow()
  })

  it.each([23, 25])('repairs a %i hour orphan by age only after checking durable terminal evidence', async hours => {
    const h = await seed(undefined, hours * 60 * 60 * 1000)
    await h.ctx.plugin(DefaultModel, { provider: 'deepseek-user', model: 'deepseek-chat' })
    await vi.waitFor(async () => expect((await h.ctx.automation.list()).status.enabled).toBe(true))
    const run = (await h.get(h.task)).runs[0]!
    if (hours > 24) expect(run).toMatchObject({ status: 'error', errorCode: 'run_interrupted', resultType: 'none' })
    else {
      expect(run.status).toBe('running')
      await expect(h.ctx.automation.runNow({ id: h.task.id })).rejects.toMatchObject({ code: 'automation/task_running' })
    }
    expect(h.adapter.requests).toEqual([])
  })
})

describe('DSH automation run cleanup', () => {
  async function fixture(kind = 'valid') {
    const h = await harness()
    const task = await h.create()
    const started = await h.ctx.automation.beginRun({ taskId: task.id, trigger: 'manual' })
    const id = SessionId(`cleanup-${started.id}`)
    const session = h.ctx.sessions.prepare(id, { ...kind === 'seeded' ? { seed: [], inheritedEventCount: SessionLogOffset(0) } : {},
      meta: { cwd: h.workspaceA.path,
      ...kind === 'seeded' ? { isSeeded: true } : {},
      ...kind === 'parent' ? { parentSession: SessionId('parent') } : {},
    } })
    const owner = { version: 1 as const, taskId: task.id, runId: started.id, sessionId: id, turnId: 1 as const,
      projectId: kind === 'project' ? h.workspaceB.id : h.workspaceA.id }
    if (kind === 'late') session.append('turn/start', { turn: 1 })
    if (kind !== 'missing-marker' && kind !== 'legacy') appendPluginRecord(session, 'plugin:tpcowork-automation/run', {
      ...owner, ...kind === 'foreign-run' ? { runId: 'foreign-run' } : {},
      ...kind === 'foreign-task' ? { taskId: 'foreign-task' } : {},
      ...kind === 'foreign-session' ? { sessionId: 'foreign-session' } : {},
      ...kind === 'origin' ? { originSessionId: 'unrelated-origin' } : {},
    })
    if (kind === 'duplicate') appendPluginRecord(session, 'plugin:tpcowork-automation/run', owner)
    if (kind !== 'late') session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const writer = await h.ctx.sessionPersistence.create(session.header,
      kind === 'seeded' ? { inheritedEventCount: SessionLogOffset(0) } : undefined)
    await writer.append(session.snapshotEvents())
    await writer.close()
    await h.workspaceA.attachSession(id)
    await h.ctx.automation.bindRun({ taskId: task.id, runId: started.id, sessionId: id, turnId: 1, ownsSession: kind !== 'legacy' })
    await h.ctx.automation.finishRun({ taskId: task.id, runId: started.id, status: 'completed', resultType: 'conversation', conversationAvailable: true })
    const run = (await h.get(task)).runs[0]!
    const request = { taskId: task.id, runId: run.id }
    return { ...h, task, run, request }
  }

  it('deletes a real Agent result from history, search and project membership through refresh and restart', async () => {
    const h = await harness([textResponse('AUTOMATION_DELETION_NEEDLE')], '', true, true)
    const removed = vi.fn()
    h.ctx.on('api-session/removed', removed)
    const sessionList = new ApiSessionList(h.ctx, 10)
    const task = await h.create()
    await h.ctx.automation.runNow({ id: task.id })
    const run = await h.settled(task)
    const id = run.sessionId!
    // Warm both query paths before deletion to detect stale cache/index resurrection.
    using observed = await h.ctx.sessionQuery.observeSession(id)
    expect((await sessionList.list()).some(value => value.sessionId === id)).toBe(true)
    expect((await h.ctx.sessionQuery.searchSessions({ query: 'AUTOMATION_DELETION_NEEDLE' })).items).toHaveLength(1)
    await h.ctx.workspaceRegistry.pinSession(id)
    const other = await h.create({ name: 'unrelated' })
    const catalog = await h.ctx.automation.deleteRun({ taskId: task.id, runId: run.id })
    expect(removed).toHaveBeenCalledWith(id)
    expect({ retainedRuns: catalog.tasks.find(value => value.id === task.id)!.runs.length,
      listed: (await h.ctx.sessionQuery.listSessions()).some(value => value.header.id === id),
      searchable: (await h.ctx.sessionQuery.searchSessions({ query: 'AUTOMATION_DELETION_NEEDLE' })).items.length,
      projectMember: h.workspaceA.sessionIds.includes(id), pinned: h.ctx.workspaceRegistry.pinnedSessionIds.includes(id),
    }).toMatchInlineSnapshot(`
      {
        "listed": false,
        "pinned": false,
        "projectMember": false,
        "retainedRuns": 0,
        "searchable": 0,
      }
    `)
    expect(catalog.tasks.find(value => value.id === task.id)!.runs).toEqual([])
    expect(h.workspaceA.sessionIds).not.toContain(id)
    expect(h.ctx.workspaceRegistry.pinnedSessionIds).not.toContain(id)
    expect((await h.ctx.sessionPersistence.list()).some(value => value.header.id === id)).toBe(false)
    expect((await h.ctx.sessionQuery.listSessions()).some(value => value.header.id === id)).toBe(false)
    expect((await sessionList.list()).some(value => value.sessionId === id)).toBe(false)
    expect((await sessionList.search('AUTOMATION_DELETION_NEEDLE', new AbortController().signal)).items).toEqual([])
    expect((await h.ctx.sessionQuery.searchSessions({ query: 'AUTOMATION_DELETION_NEEDLE' })).items).toEqual([])
    await expect(h.ctx.sessionQuery.observeSession(id)).rejects.toMatchObject({ code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
    await expect(h.ctx.agents.resume({ resumeSessionId: id })).rejects.toThrow()
    expect((await h.get(other)).id).toBe(other.id)
    await h.ctx.fiber.dispose()
    const next = await harness([], h.root, true, true)
    const restoredList = new ApiSessionList(next.ctx, 10)
    expect((await next.get(task)).runs).toEqual([])
    expect(next.workspaceA.sessionIds).not.toContain(id)
    expect((await next.ctx.sessionQuery.listSessions()).some(value => value.header.id === id)).toBe(false)
    expect((await restoredList.list()).some(value => value.sessionId === id)).toBe(false)
    expect((await next.ctx.sessionQuery.searchSessions({ query: 'AUTOMATION_DELETION_NEEDLE' })).items).toEqual([])
    await expect(next.ctx.agents.resume({ resumeSessionId: id })).rejects.toThrow()
    expect(next.adapter.requests).toEqual([])
  })

  it.each(['missing-marker', 'duplicate', 'late', 'seeded', 'parent', 'foreign-run', 'foreign-task', 'foreign-session', 'origin', 'project'])(
    'retains the record and refuses %s ownership', async kind => {
      const h = await fixture(kind)
      await expect(h.ctx.automation.deleteRun(h.request)).rejects.toMatchObject({ code: 'automation/session_cleanup_failed' })
      expect((await h.get(h.task)).runs).toHaveLength(1)
      expect(await h.ctx.sessionPersistence.stat(h.run.sessionId!)).toBeDefined()
    })

  it('removes legacy shared history without deleting its Session', async () => {
    const h = await fixture('legacy')
    await h.ctx.automation.deleteRun(h.request)
    expect((await h.get(h.task)).runs).toEqual([])
    expect(await h.ctx.sessionPersistence.stat(h.run.sessionId!)).toBeDefined()
  })

  it.each(['origin', 'run'])('refuses a Session subsequently shared as another task %s', async kind => {
    const h = await fixture()
    const other = await h.create(kind === 'origin' ? { originSessionId: h.run.sessionId } : {})
    if (kind === 'run') {
      const run = await h.ctx.automation.beginRun({ taskId: other.id, trigger: 'manual' })
      await h.ctx.automation.bindRun({ taskId: other.id, runId: run.id, sessionId: h.run.sessionId!, ownsSession: false })
    }
    await expect(h.ctx.automation.deleteRun(h.request)).rejects.toMatchObject({ code: 'automation/session_cleanup_failed' })
    expect((await h.get(h.task)).runs).toHaveLength(1)
    expect(await h.ctx.sessionPersistence.stat(h.run.sessionId!)).toBeDefined()
  })

  it('keeps the record when project cleanup fails, then retries and removes archival membership', async () => {
    const h = await fixture()
    await h.ctx.workspaceRegistry.archiveSession(h.run.sessionId!)
    const detach = vi.spyOn(h.workspaceA, 'detachSession').mockRejectedValueOnce(new Error('membership unavailable'))
    await expect(h.ctx.automation.deleteRun(h.request)).rejects.toMatchObject({ code: 'automation/session_cleanup_failed' })
    expect((await h.get(h.task)).runs).toHaveLength(1)
    expect(await h.ctx.sessionPersistence.stat(h.run.sessionId!)).toBeUndefined()
    detach.mockRestore()
    await h.ctx.automation.deleteRun(h.request)
    expect(h.workspaceA.sessionIds).not.toContain(h.run.sessionId)
    expect(h.ctx.workspaceRegistry.archivedSessionIds).not.toContain(h.run.sessionId)
    expect((await h.get(h.task)).runs).toEqual([])
  })

  it('rejects running records and resumed user owners, then allows deletion after release', async () => {
    const h = await fixture()
    const other = await h.create()
    const running = await h.ctx.automation.beginRun({ taskId: other.id, trigger: 'manual' })
    await expect(h.ctx.automation.deleteRun({ taskId: other.id, runId: running.id })).rejects.toMatchObject({ code: 'automation/run_running' })
    const resumed = await h.ctx.agents.resume({ resumeSessionId: h.run.sessionId! })
    await expect(h.ctx.automation.deleteRun(h.request)).rejects.toMatchObject({ code: 'automation/session_cleanup_failed' })
    expect((await h.get(h.task)).runs).toHaveLength(1)
    await resumed.dispose()
    await h.ctx.automation.deleteRun(h.request)
    expect((await h.get(h.task)).runs).toEqual([])
  })

  it('propagates storage reads/deletes, retains history, and safely retries a missing Session', async () => {
    const h = await fixture()
    const stat = vi.spyOn(h.ctx.sessionPersistence, 'stat').mockRejectedValueOnce(new Error('metadata unreadable'))
    await expect(h.ctx.automation.deleteRun(h.request)).rejects.toMatchObject({ code: 'automation/session_cleanup_failed' })
    expect((await h.get(h.task)).runs).toHaveLength(1)
    stat.mockRestore()
    const remove = vi.spyOn(h.ctx.sessionPersistence, 'delete').mockRejectedValueOnce(new Error('delete denied'))
    await expect(h.ctx.automation.deleteRun(h.request)).rejects.toMatchObject({ code: 'automation/session_cleanup_failed' })
    remove.mockRestore()
    const snapshot = (await h.ctx.sessionPersistence.stat(h.run.sessionId!))!
    await h.ctx.sessionPersistence.delete(h.run.sessionId!, { expectedRevision: snapshot.revision })
    await h.ctx.automation.deleteRun(h.request)
    expect((await h.get(h.task)).runs).toEqual([])
  })

  it('retains a retryable record if its commit fails after Session deletion, including after restart', async () => {
    const h = await fixture()
    const put = vi.spyOn(AutomationStore.prototype, 'put').mockRejectedValueOnce(new Error('record commit failed'))
    await expect(h.ctx.automation.deleteRun(h.request)).rejects.toThrow('record commit failed')
    put.mockRestore()
    expect((await h.get(h.task)).runs).toHaveLength(1)
    expect(await h.ctx.sessionPersistence.stat(h.run.sessionId!)).toBeUndefined()
    await h.ctx.fiber.dispose()
    const next = await harness([], h.root)
    expect((await next.get(h.task)).runs).toHaveLength(1)
    await next.ctx.automation.deleteRun(h.request)
    expect((await next.get(h.task)).runs).toEqual([])
  })

  it('compares the inspected revision against a write racing cleanup', async () => {
    const h = await fixture()
    const remove = h.ctx.sessionPersistence.delete.bind(h.ctx.sessionPersistence)
    vi.spyOn(h.ctx.sessionPersistence, 'delete').mockImplementationOnce(async (id, options) => {
      const writer = await h.ctx.sessionPersistence.open(id, 'write')
      const events = (await writer.read()).events
      const session = h.ctx.sessions.prepare(id, { seed: events, meta: writer.header })
      session.append('turn/start', { turn: 2 })
      await writer.append(session.snapshotEvents().slice(events.length))
      await writer.close()
      return remove(id, options)
    })
    await expect(h.ctx.automation.deleteRun(h.request)).rejects.toMatchObject({ code: 'automation/session_cleanup_failed' })
    expect((await h.get(h.task)).runs).toHaveLength(1)
    await h.ctx.automation.deleteRun(h.request)
    expect((await h.get(h.task)).runs).toEqual([])
  })

  it('withdraws cleanup admission and awaits an owned deletion during unload', async () => {
    const h = await fixture()
    const cleanup = new DshAutomationSessionCleanup(h.ctx)
    const remove = h.ctx.sessionPersistence.delete.bind(h.ctx.sessionPersistence)
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const deleting = vi.spyOn(h.ctx.sessionPersistence, 'delete').mockImplementationOnce(async (...args) => {
      await barrier
      return remove(...args)
    })
    const pending = cleanup.deleteRunSession(h.task, h.run)
    await vi.waitFor(() => expect(deleting).toHaveBeenCalledOnce())
    let disposed = false
    const teardown = cleanup.dispose().then(() => { disposed = true })
    await expect(cleanup.deleteRunSession(h.task, h.run)).rejects.toMatchObject({ code: 'automation/service_stopping' })
    expect(disposed).toBe(false)
    release()
    await pending
    await teardown
    expect(disposed).toBe(true)
  })
})
