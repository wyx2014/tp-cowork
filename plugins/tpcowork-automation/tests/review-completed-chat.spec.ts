/** Real chat/AgentLoop/Host/Workspace/JSONL; scripted model, plus an explicit Workspace fault case. */
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { SessionId, pluginRecordOf } from '@deepseek-ai/dsh-session'
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


describe('review: user continues a completed automation result conversation', () => {
  it.each(['resume', 'fork'])('allows an ordinary user follow-up after the automation turn has ended: %s', async mode => {
    const h = await harness([
      textResponse('自动任务已完成'),
      toolCallResponse('user-follow-up', 'cron', add({ name: '用户后续提醒' })),
      textResponse('已处理用户后续请求'),
    ])
    await h.call(add({ name: '原自动任务', mode: 'task' }))
    const task = (await h.ctx.automation.list()).tasks[0]!
    await h.ctx.automation.runNow({ id: task.id })
    const run = await h.settled(task)
    expect(run.status).toBe('completed')
    await vi.waitFor(() => expect(h.ctx.agents.get(run.sessionId!)).toBeUndefined())
    let resumed = await h.ctx.agents.resume({ resumeSessionId: run.sessionId!,
      agentOptions: { provider: 'user-model', model: 'current' } })
    if (mode === 'fork') {
      const fork = h.ctx.sessions.fork(resumed.agent.session, undefined, SessionId('completed-fork'))
      const parentSession = resumed.agent.id
      await resumed.dispose()
      resumed = await h.ctx.agents.create({ sessionId: SessionId('completed-fork-agent'),
        seed: fork.snapshotEvents(), inheritedEventCount: fork.inheritedEventCount,
        meta: { isSeeded: true, parentSession }, agentOptions: { provider: 'user-model', model: 'current' } })
    }
    resumed.agent.followup(createUserMessage({
      content: [{ type: 'text', text: '自动任务已经完成。请再给我创建一个一小时后的一次提醒。' }],
      source: { kind: 'user' },
    }))
    await resumed.agent.whenIdle()
    const rejectedByHistoricalMarker = JSON.stringify(resumed.agent.session.snapshotEvents())
      .includes('不能在自动化运行或子 Agent 中创建新的自动化')
    expect(rejectedByHistoricalMarker, 'a normal user follow-up was rejected by the historical automation marker').toBe(false)
    const catalog = await h.ctx.automation.list()
    expect(catalog.tasks.map(item => item.name)).toContain('用户后续提醒')
    expect(catalog.tasks).toHaveLength(2)
    expect(resumed.agent.session.snapshotEvents().some(event => pluginRecordOf(event)?.type === 'plugin:tpcowork-automation/run')).toBe(true)
    expect(resumed.agent.session.snapshotEvents().filter(event => event.type === 'turn/start').map(event => event.data.turn)).toEqual([1, 2])
    await resumed.dispose()
  })

  it.each([false, true])('blocks a fork inheriting a live automatic turn, then allows user creation once that turn ends; resume fork=%s', async resumeFork => {
    const h = await harness([
      toolCallResponse('branch-probe', 'probe_branch', {}),
      toolCallResponse('recursive-branch', 'cron', add({ name: '递归分支提醒' })),
      textResponse('分支已完成'),
      textResponse('自动任务已完成'),
      toolCallResponse('authorized-branch', 'cron', add({ name: '分支后续提醒' })),
      textResponse('已处理用户后续请求'),
    ])
    let branch: Awaited<ReturnType<typeof h.ctx.agents.create>> | undefined
    h.ctx.tools.register({ name: 'probe_branch', description: 'Exercise a real branch of the active turn',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      async execute(_args, { agent }) {
        const fork = h.ctx.sessions.fork(agent!.session, undefined, SessionId('active-fork'))
        branch = await h.ctx.agents.create({ sessionId: SessionId('active-fork-agent'),
          seed: fork.snapshotEvents(), inheritedEventCount: fork.inheritedEventCount,
          meta: { isSeeded: true, parentSession: agent!.id }, agentOptions: { provider: 'user-model', model: 'current' } })
        if (resumeFork) {
          await h.ctx.sessions.flush(branch.agent.session)
          await branch.dispose()
          branch = await h.ctx.agents.resume({ resumeSessionId: SessionId('active-fork-agent'),
            agentOptions: { provider: 'user-model', model: 'current' } })
        }
        branch.agent.followup(createUserMessage({ content: [{ type: 'text', text: '继续当前自动任务的分支工作' }], source: { kind: 'user' } }))
        await branch.agent.whenIdle()
        return 'branch checked'
      },
    })
    await h.call(add({ name: '原自动任务', mode: 'task' }))
    const task = (await h.ctx.automation.list()).tasks[0]!
    await h.ctx.automation.runNow({ id: task.id })
    const run = await h.settled(task)
    expect(run.status).toBe('completed')
    expect(branch).toBeDefined()
    expect(JSON.stringify(branch!.agent.session.snapshotEvents())).toContain('不能在自动化运行')
    expect((await h.ctx.automation.list()).tasks).toHaveLength(1)
    branch!.agent.followup(createUserMessage({ content: [{ type: 'text', text: '已结束自动任务。请创建一小时后的一次提醒。' }], source: { kind: 'user' } }))
    await branch!.agent.whenIdle()
    expect((await h.ctx.automation.list()).tasks.map(item => item.name).sort()).toEqual(['原自动任务', '分支后续提醒'].sort())
    await branch!.dispose()
  })

  it('guards a new automatic turn in a resumed result session, while allowing the following user turn', async () => {
    const h = await harness([
      textResponse('初次任务完成'),
      toolCallResponse('auto-again', 'cron', add({ name: '递归提醒' })), textResponse('自动工作结束'),
      toolCallResponse('user-again', 'cron', add({ name: '用户提醒' })), textResponse('已创建'),
    ])
    await h.call(add({ mode: 'task' }))
    const task = (await h.ctx.automation.list()).tasks[0]!
    await h.ctx.automation.runNow({ id: task.id })
    const run = await h.settled(task)
    await vi.waitFor(() => expect(h.ctx.agents.get(run.sessionId!)).toBeUndefined())
    const resumed = await h.ctx.agents.resume({ resumeSessionId: run.sessionId!,
      agentOptions: { provider: 'user-model', model: 'current' } })
    resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: '继续自动执行' }],
      source: { kind: 'tpcowork-automation', taskId: task.id, runId: run.id } }))
    await resumed.agent.whenIdle()
    expect(JSON.stringify(resumed.agent.session.snapshotEvents())).toContain('不能在自动化运行')
    expect((await h.ctx.automation.list()).tasks).toHaveLength(1)
    resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: '请创建一小时后的一次提醒' }], source: { kind: 'user' } }))
    await resumed.agent.whenIdle()
    expect((await h.ctx.automation.list()).tasks.map(item => item.name)).toContain('用户提醒')
    expect(resumed.agent.session.snapshotEvents().filter(event => event.type === 'turn/start').map(event => event.data.turn)).toEqual([1, 2, 3])
    await resumed.dispose()
  })

  it('keeps an inherited branch turn guarded after the parent finishes, then releases its next user turn', async () => {
    const h = await harness([
      toolCallResponse('start-branch', 'start_branch', {}),
      toolCallResponse('wait-parent', 'wait_for_parent', {}),
      textResponse('父自动任务完成'),
      toolCallResponse('late-recursion', 'cron', add({ name: '延迟递归提醒' })), textResponse('分支完成'),
      toolCallResponse('next-user-turn', 'cron', add({ name: '后续用户提醒' })), textResponse('已创建'),
    ])
    let branch: Awaited<ReturnType<typeof h.ctx.agents.create>> | undefined
    let markWaiting!: () => void
    const waiting = new Promise<void>(resolve => { markWaiting = resolve })
    let markFinished!: () => void
    const finished = new Promise<void>(resolve => { markFinished = resolve })
    const output = { schema: { type: 'string' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }] }
    h.ctx.tools.register({ name: 'start_branch', description: 'Start an inherited automatic branch', parameters: { type: 'object', properties: {} }, output,
      async execute(_args, { agent }) {
        const fork = h.ctx.sessions.fork(agent!.session, undefined, SessionId('late-fork'))
        branch = await h.ctx.agents.create({ sessionId: SessionId('late-fork-agent'),
          seed: fork.snapshotEvents(), inheritedEventCount: fork.inheritedEventCount,
          meta: { isSeeded: true, parentSession: agent!.id }, agentOptions: { provider: 'user-model', model: 'current' } })
        branch.agent.followup(createUserMessage({ content: [{ type: 'text', text: '继续自动任务分支' }], source: { kind: 'user' } }))
        await waiting
        return 'branch started'
      },
    })
    h.ctx.tools.register({ name: 'wait_for_parent', description: 'Wait until the parent finishes', parameters: { type: 'object', properties: {} }, output,
      async execute() { markWaiting(); await finished; return 'parent finished' },
    })
    await h.call(add({ name: '原自动任务', mode: 'task' }))
    const task = (await h.ctx.automation.list()).tasks[0]!
    h.ctx.on('automation/changed', change => { if (change.taskId === task.id && change.reason === 'run_finished') markFinished() })
    await h.ctx.automation.runNow({ id: task.id })
    const run = await h.settled(task)
    expect(run.status).toBe('completed')
    await branch!.agent.whenIdle()
    expect(h.ctx.agents.get(run.sessionId!)).toBeUndefined()
    expect(JSON.stringify(branch!.agent.session.snapshotEvents())).toContain('不能在自动化运行')
    expect((await h.ctx.automation.list()).tasks).toHaveLength(1)
    branch!.agent.followup(createUserMessage({ content: [{ type: 'text', text: '分支已结束。请创建一次提醒。' }], source: { kind: 'user' } }))
    await branch!.agent.whenIdle()
    expect((await h.ctx.automation.list()).tasks.map(item => item.name)).toContain('后续用户提醒')
    await branch!.dispose()
  })

  it('allows a resumed user turn when automatic setup failed before the first turn started', async () => {
    const h = await harness([toolCallResponse('first-user-turn', 'cron', add({ name: '恢复后的用户提醒' })), textResponse('已创建')])
    // Session ownership is flushed before Workspace attachment and turn entry.
    const attach = vi.spyOn(h.project, 'attachSession').mockRejectedValueOnce(new Error('project attachment failed'))
    const task = (await h.ctx.automation.create({ name: '准备失败的自动任务', prompt: 'report', projectId: h.project.id,
      schedule: { frequency: 'manual' } })).tasks[0]!
    await h.ctx.automation.runNow({ id: task.id })
    const run = await h.settled(task)
    attach.mockRestore()
    expect(run.status).toBe('error')
    expect(run.sessionId).toBeDefined()
    expect(h.adapter.requests).toHaveLength(0)
    const resumed = await h.ctx.agents.resume({ resumeSessionId: run.sessionId!,
      agentOptions: { provider: 'user-model', model: 'current' } })
    expect(resumed.agent.session.snapshotEvents().some(event => event.type === 'turn/start')).toBe(false)
    expect(resumed.agent.session.snapshotEvents().some(event => pluginRecordOf(event)?.type === 'plugin:tpcowork-automation/run')).toBe(true)
    resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: '请创建一小时后的一次提醒' }], source: { kind: 'user' } }))
    await resumed.agent.whenIdle()
    expect((await h.ctx.automation.list()).tasks.map(item => item.name)).toContain('恢复后的用户提醒')
    await resumed.dispose()
  })
})
