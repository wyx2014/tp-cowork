/** Team execution lives here; Session records are its only durable state. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import type {} from '@deepseek-ai/dsh-tool-todo'
import type {} from '@deepseek-ai/dsh-tool-workflow/types'
import type {} from '@deepseek-ai/dsh-subagent'
import { appendPluginRecord, pluginRecordOf, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
import type {} from '@deepseek-ai/dsh-workflow'
import type { ExpertsApi, TaskContext, TeamRunEvent } from '../../tpcowork-toolbox/src/contracts/index.ts'
import type { TaskMcpLease } from '../../tpcowork-toolbox/src/host/mcp/index.ts'
import { taskStatus } from '../../tpcowork-toolbox/src/task-context.ts'
import { contextRecord, selectionRecord, admissionSchema, runRecord, runSchema, type RunState } from './schema.ts'
import { loadTeams, type TeamDefinition, workflowScript } from './teams.ts'
import { hostContribution } from './remote.ts'
import { registerExpertsProjection } from '../../tpcowork-workbench/experts/projection.ts'
import { beginTeamPlan, deliveryTask, memberId, memberName, nameTeamSession, phaseName, restoreTeamPresentation, updateTeamTask } from './native-presentation.ts'

declare module '@deepseek-ai/cordis' { interface Context { experts: ExpertsRuntime } }
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'tpcowork-experts': { kind: 'tpcowork-experts'; runId: string } }
}
export const name = 'tpcowork-experts'
export const inject = ['typert', 'agents', 'sessions', 'sessionController', 'sessionProjections', 'workflowEngine', 'subagents', 'fs', 'workingDirectory', 'tools']

export function readRun(events: readonly SessionEvent[], runId?: string): RunState | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const record = pluginRecordOf(events[index]!)
    if (record?.type !== runRecord) continue
    const state = runSchema.parse(record.data)
    if (!runId || state.runId === runId) return state
  }
  return undefined
}
export function readContext(events: readonly SessionEvent[]): TaskContext | null {
  const records = events.map(pluginRecordOf).filter(record => record?.type === contextRecord)
  if (records.length > 1) throw new Error('experts/duplicate-context')
  const legacy = records.length ? admissionSchema.parse(records[0]!.data).context : null
  if (legacy?.team) return legacy
  for (let index = events.length - 1; index >= 0; index--) {
    const record = pluginRecordOf(events[index]!)
    if (record?.type !== selectionRecord) continue
    const { context } = admissionSchema.parse(record.data)
    if (context.team) return context
  }
  return legacy
}

/** Read the latest admitted capability snapshot, or the exact native request's snapshot. */
export function readSelection(events: readonly SessionEvent[], requestId?: string): TaskContext | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const record = pluginRecordOf(events[index]!)
    if (record?.type !== selectionRecord && record?.type !== contextRecord) continue
    const admission = admissionSchema.parse(record.data)
    if (requestId === undefined || admission.requestId === requestId) return admission.context
  }
  return null
}
class ResearchFailure extends Error {
  constructor(readonly code: string) { super('experts/' + code) }
}
interface LiveRun {
  parent: Agent
  selection?: ModelSelection
  state: RunState
  abort: AbortController
  workflow?: WorkflowRun
  done: Promise<void>
  children: Map<string, { memberId: string; seq: number; lastEventId?: string }>
}

export class ExpertsRuntime extends TypertRemoteService implements ExpertsApi {
  readonly active = new Map<string, LiveRun>()
  private readonly observers = new Set<(event: TeamRunEvent) => void>()
  private readonly childLeases = new Map<Agent, TaskMcpLease>()
  private readonly childRuns = new Map<string, LiveRun>()
  private closed = false
  constructor(ctx: Context, readonly teams: TeamDefinition[]) {
    super(ctx, 'experts')
    ctx.on('workflow/phase', (info, phase) => {
      const live = this.byWorkflow(info.id)
      if (!live) return
      const previous = live.state.events.findLast(event => event.type === 'phase_started')?.phaseId
      if (previous) {
        const start = live.state.events.findLastIndex(event => event.type === 'phase_started')
        const failed = live.state.events.slice(start).some(event => event.type === 'member_finished' && event.status !== 'succeeded')
        this.event(live, { type: 'phase_finished', phaseId: previous, status: failed ? 'partial' : 'succeeded' })
      }
      this.event(live, { type: 'phase_started', phaseId: phase })
    })
    ctx.on('workflow/agent-start', (info, member) => {
      const live = this.byWorkflow(info.id)
      if (!live) return
      const team = this.teamOf(live)
      const id = memberId(team, member.label)
      live.children.set(member.childId, { memberId: id, seq: member.seq })
      this.childRuns.set(member.childId, live)
      live.parent.session.append('tool-workflow/agent-start', { runId: info.id, seq: member.seq,
        label: memberName(team, id), childId: member.childId, ...(member.phase ? { phase: phaseName(member.phase) } : {}) })
      updateTeamTask(live.parent.session, memberName(team, id), 'in_progress')
      this.event(live, { type: 'member_started', memberId: id, ...(member.phase ? { phaseId: member.phase } : {}), sessionEventId: `${member.childId}:0` })
    })
    ctx.on('workflow/agent-end', (info, member) => {
      const live = this.byWorkflow(info.id)
      if (!live) return
      const team = this.teamOf(live)
      const id = memberId(team, member.label)
      live.parent.session.append('tool-workflow/agent-end', { runId: info.id, seq: member.seq, outcome: member.outcome })
      updateTeamTask(live.parent.session, memberName(team, id), member.outcome === 'completed' ? 'completed' : 'pending')
      this.event(live, { type: 'member_finished', memberId: id,
        status: member.outcome === 'completed' ? 'succeeded' : member.outcome === 'cancelled' ? 'cancelled' : 'failed',
        sessionEventId: live.children.get(member.childId)?.lastEventId ?? `${member.childId}:0` })
    })
    ctx.on('tools/result', exec => {
      if (!exec.agent) return
      const live = this.childRuns.get(exec.agent.id)
      const member = live?.children.get(exec.agent.id)
      // Every Session's tool results arrive here; only team members' logs are worth scanning.
      if (!live || !member) return
      const call = exec.agent.session.snapshotEvents().findLast(event => event.type === 'tool/call' && event.data.callId === exec.callId)
      if (call) this.event(live, { type: 'member_progress', memberId: member.memberId, sessionEventId: `${exec.agent.id}:${call.seq}` })
    })
    // Awaited publication hook: a fresh child cannot run before its selected MCP scope is ready.
    ctx.on('agent/created', async ({ agent }) => {
      const parentId = agent.session.header.parentSession
      const live = parentId ? [...this.active.values()].find(run => run.parent.id === parentId) : undefined
      if (!live || agent.session.header.origin !== 'subagent') { this.recover(agent); return }
      // The parent step's model is captured before the workflow starts.
      if (live.selection) agent.ctx.effect(() => installModelSelection(agent.ctx, { current: live.selection, assembled: undefined }))
      if (!live.state.context.mcp.length) return
      const runtime = ctx.get('toolboxMcpRuntime')
      if (!runtime) throw new Error('experts/mcp-runtime-unavailable')
      const lease = await runtime.openTask({ ...live.state.context, sessionId: agent.id }, agent.ctx, live.abort.signal)
      this.childLeases.set(agent, lease)
      lease.signal.addEventListener('abort', () => {
        if (this.childLeases.get(agent) !== lease || live.abort.signal.aborted || agent.status === 'idle') return
        live.state.code = 'mcp_revoked'
        live.abort.abort()
        agent.cancel({ kind: 'hook', reason: 'experts/mcp_revoked' })
      }, { once: true })
    })
    ctx.on('agent/pre-step', async ({ agent }, next) => {
      const lease = this.childLeases.get(agent)
      if (lease?.signal.aborted) {
        const live = [...this.active.values()].find(run => run.parent.id === agent.session.header.parentSession)
        if (live) this.revoke(live.parent)
        throw new ResearchFailure('mcp_revoked')
      }
      return next()
    })
    ctx.on('agent/disposed', async ({ agent }) => {
      const live = this.childRuns.get(agent.id)
      const member = live?.children.get(agent.id)
      if (member) {
        const end = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
        if (end) member.lastEventId = `${agent.id}:${end.seq}`
      }
      const lease = this.childLeases.get(agent)
      this.childLeases.delete(agent)
      await lease?.close()
      const owned = [...this.active.values()].find(run => run.parent === agent)
      if (owned) { owned.abort.abort(); await owned.done }
    })
  }
  private byWorkflow(id: string): LiveRun | undefined { return [...this.active.values()].find(run => run.workflow?.id === id) }
  private teamOf(live: LiveRun): TeamDefinition { return this.teams.find(team => team.id === live.state.context.team?.id)! }
  private save(live: LiveRun): void { appendPluginRecord(live.parent.session, runRecord, live.state) }
  private event(live: LiveRun, value: Omit<TeamRunEvent, 'runId' | 'taskId' | 'sequence' | 'at'>): void {
    const event = { taskId: live.state.context.taskId, runId: live.state.runId, sequence: live.state.events.length + 1, at: Date.now(), ...value }
    live.state.events.push(event)
    // Each record holds the whole run, so per-tool progress waits for the next save (at the latest
    // the member's own member_finished); live watchers still receive it at once.
    if (value.type !== 'member_progress') this.save(live)
    for (const observer of this.observers) observer(event)
  }
  private recover(agent: Agent): void {
    const state = readRun(agent.session.snapshotEvents())
    const team = state && this.teams.find(team => team.id === state.context.team?.id)
    if (state && team) restoreTeamPresentation(agent.session, team, state)
    if (!state || this.active.has(state.runId) || !['running', 'awaiting_delivery', 'awaiting_plan'].includes(taskStatus(state.settlement))) return
    state.settlement.execution = 'interrupted'
    state.code = 'process_interrupted'
    this.clearActivePlan(agent, state)
    const live: LiveRun = { parent: agent, state, abort: new AbortController(), done: Promise.resolve(), children: new Map() }
    this.event(live, { type: 'settled', status: 'interrupted' })
  }
  /** Host-owned pre-step operation; its promise includes workflow and child cleanup. */
  async execute(parent: Agent, context: TaskContext, prompt: string, signal: AbortSignal): Promise<RunState> {
    if (this.closed || !context.team || context.sessionId !== parent.id || JSON.stringify(readContext(parent.session.snapshotEvents())) !== JSON.stringify(context)) throw new Error('experts/context-mismatch')
    if ([...this.active.values()].some(run => run.parent === parent)) throw new Error('experts/already-running')
    const team = this.teams.find(team => team.id === context.team?.id && team.version === context.team.version && team.workflowId === context.team.workflowId)
    if (!team) throw new Error('experts/team-unavailable')
    const runId = `${Buffer.from(parent.id).toString('base64url')}.${randomUUID()}`
    const state: RunState = { version: 1, runId, context: structuredClone(context), startSeq: parent.session.snapshotEvents().length,
      directory: `reports/experts/${runId}`, researchDone: false, settlement: { execution: 'running', delivery: 'pending', plan: 'open' }, events: [], artifacts: [] }
    const selection = this.ctx.sessionController.modelSelectionForStep(parent)
    const live: LiveRun = { parent, state, selection, abort: new AbortController(), done: Promise.resolve(), children: new Map() }
    this.active.set(runId, live)
    nameTeamSession(parent.session, team, '')
    beginTeamPlan(parent.session, team)
    this.event(live, { type: 'started', status: 'running' })
    const cancel = () => live.abort.abort()
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    live.done = this.drive(live, team, prompt).finally(async () => {
      signal.removeEventListener('abort', cancel)
      this.active.delete(runId)
      for (const id of live.children.keys()) this.childRuns.delete(id)
      await this.ctx.sessions.flush(parent.session)
    })
    await live.done
    return structuredClone(state)
  }
  private async drive(live: LiveRun, team: TeamDefinition, prompt: string): Promise<void> {
    const { state, parent } = live
    try {
      live.abort.signal.throwIfAborted()
      const workflow = this.ctx.workflowEngine.start({ parent, signal: live.abort.signal,
        subagentProvider: 'spawn', maxTotalAgents: team.members.length + 2,
        meta: { name: team.name, description: team.name, phases: [...team.phases, 'synthesis', 'review'].map(title => ({ title })) },
        script: workflowScript(team), args: { ...team, prompt, directory: state.directory, policy: team.adapter } })
      live.workflow = workflow
      parent.session.append('tool-workflow/run-start', { runId: workflow.id, name: team.name })
      state.workflowId = workflow.id
      this.save(live)
      const result = await workflow.result
      await workflow.dispose()
      live.abort.signal.throwIfAborted()
      if (result.stopReason !== 'completed') throw new ResearchFailure('workflow_failed')
      const finished = state.events.filter(event => event.type === 'member_finished')
      const succeeded = new Set(finished.filter(event => event.status === 'succeeded').map(event => event.memberId))
      for (const member of team.members) {
        if (!succeeded.has(member.id)) continue
        const file = await this.file(parent, `${state.directory}/${member.id}.md`, live.abort.signal)
        if (!file) {
          updateTeamTask(parent.session, member.name, 'pending')
          const child = [...live.children.values()].find(child => child.memberId === member.id)
          if (child) parent.session.append('tool-workflow/agent-end', { runId: workflow.id, seq: child.seq, outcome: 'failed' })
          this.event(live, { type: 'member_finished', memberId: member.id, status: 'failed' })
          continue
        }
        const artifact = { id: `${state.runId}/${member.id}`, path: file, kind: 'member' as const }
        state.artifacts.push(artifact)
        this.event(live, { type: 'artifact', memberId: member.id, artifactId: artifact.id })
      }
      if (!state.artifacts.length || !succeeded.has('lead-synthesis') || !succeeded.has('lead-review')
        || !await this.file(parent, `${state.directory}/review.md`, live.abort.signal)) throw new ResearchFailure('no_verified_research')
      for (const [suffix, kind] of [['md', 'markdown'], ['html', 'html']] as const) {
        const file = await this.file(parent, `${state.directory}/report.${suffix}`, live.abort.signal)
        if (!file) throw new ResearchFailure('report_missing')
        state.artifacts.push({ id: `${state.runId}/${kind}`, path: file, kind })
      }
      const phase = state.events.findLast(event => event.type === 'phase_started')?.phaseId
      if (phase) this.event(live, { type: 'phase_finished', phaseId: phase, status: 'succeeded' })
      state.researchDone = true
      updateTeamTask(parent.session, deliveryTask, 'in_progress')
      state.settlement.execution = state.artifacts.filter(item => item.kind === 'member').length === team.members.length ? 'succeeded' : 'partial'
      this.save(live)
    } catch (error) {
      state.settlement.execution = live.abort.signal.aborted && state.code !== 'mcp_revoked' ? 'cancelled' : 'failed'
      state.code ??= state.settlement.execution === 'cancelled' ? 'cancelled' : error instanceof ResearchFailure ? error.code : 'execution_failed'
      this.event(live, { type: 'settled', status: state.settlement.execution })
    } finally {
      try { await live.workflow?.dispose() }
      catch (_error) { state.settlement.execution = 'failed'; state.code = 'cleanup_failed'; this.save(live) }
      if (live.workflow) parent.session.append('tool-workflow/run-end', { runId: live.workflow.id,
        stopReason: state.settlement.execution === 'cancelled' ? 'cancelled' : state.settlement.execution === 'failed' ? 'error' : state.researchDone ? 'completed' : 'error' })
      if (['failed', 'cancelled'].includes(state.settlement.execution)) this.clearActivePlan(parent, state)
    }
  }
  private async file(agent: Agent, path: string, signal: AbortSignal): Promise<string | undefined> {
    const fs = agent.ctx.get('fs')!
    const cwd = this.ctx.workingDirectory.get(agent.session)
    const target = await fs.resolve(path, { cwd, signal })
    const info = await fs.stat(target, signal)
    if (info?.type !== 'file') return
    const text = await fs.readText(target, signal)
    if (!text.trim() || (path.endsWith('.html') && !/<html[\s>]/i.test(text))) return
    return fs.processPath(target)
  }
  private clearActivePlan(parent: Agent, state: RunState): void {
    const plan = parent.session.snapshotEvents().findLast(event => event.seq >= state.startSeq && event.type === 'todo/write')
    if (plan?.type !== 'todo/write' || !plan.data.todos.some(item => item.status === 'in_progress')) return
    parent.session.append('todo/write', { todos: plan.data.todos.map(item => item.status === 'in_progress' ? { ...item, status: 'pending' } : item) })
  }
  /** Called after a Lead turn is quiescent: successful present + a later todo_write are required. */
  async reconcile(parent: Agent): Promise<void> {
    const state = readRun(parent.session.snapshotEvents())
    if (!state || this.active.has(state.runId)) return
    if (['failed', 'cancelled', 'interrupted'].includes(state.settlement.execution)) {
      this.clearActivePlan(parent, state)
      await this.ctx.sessions.flush(parent.session)
      return
    }
    if (state.events.some(event => event.type === 'settled')) return
    const end = parent.session.snapshotEvents().findLast(event => event.seq >= state.startSeq && event.type === 'turn/end')
    if (end?.type === 'turn/end' && ['aborted', 'error'].includes(end.data.reason.kind)) {
      const reason = end.data.reason
      const revoked = reason.kind === 'aborted' && reason.reason.kind === 'hook' && reason.reason.reason === 'experts/mcp_revoked'
      state.settlement.execution = reason.kind === 'aborted' && !revoked ? 'cancelled' : 'failed'
      state.code = revoked ? 'mcp_revoked' : state.settlement.execution === 'cancelled' ? 'cancelled' : 'lead_failed'
      this.clearActivePlan(parent, state)
      this.event({ parent, state, abort: new AbortController(), done: Promise.resolve(), children: new Map() }, { type: 'settled', status: state.settlement.execution })
      await this.ctx.sessions.flush(parent.session)
      return
    }
    if (!state.researchDone) return
    const events = parent.session.snapshotEvents().filter(event => event.seq >= state.startSeq)
    const files = new Set<string>()
    let lastDelivery = -1
    const references = new Map<string, string>()
    for (const event of events) {
      if (event.type !== 'deliverables/presented') continue
      for (const file of event.data.files) { files.add(file.path); references.set(file.path, `${parent.id}:${event.seq}`) }
      lastDelivery = event.seq
    }
    const final = state.artifacts.filter(item => item.kind !== 'member')
    const delivered = final.length === 2 && final.every(item => files.has(item.path) && references.has(item.path))
    const todos = events.findLast(event => event.type === 'todo/write' && event.seq > lastDelivery)
    const reconciled = todos?.type === 'todo/write' && todos.data.todos.some(item => item.content === '交付 Markdown/HTML 报告' && item.status === 'completed') && todos.data.todos.every(item => item.status !== 'in_progress')
      && (state.settlement.execution === 'partial' || todos.data.todos.every(item => item.status === 'completed'))
    const live: LiveRun = { parent, state, abort: new AbortController(), done: Promise.resolve(), children: new Map() }
    if (delivered && state.settlement.delivery !== 'delivered') {
      for (const item of final) {
        if (!await this.file(parent, item.path, new AbortController().signal)) { state.settlement.delivery = 'failed'; state.code = 'delivery_missing'; break }
        item.sessionEventId = references.get(item.path)!
        this.event(live, { type: 'artifact', artifactId: item.id, sessionEventId: item.sessionEventId })
      }
      if (state.settlement.delivery !== 'failed') state.settlement.delivery = 'delivered'
    }
    state.settlement.plan = reconciled ? 'reconciled' : 'open'
    const status = taskStatus(state.settlement)
    if (['completed', 'partial', 'failed'].includes(status) && !state.events.some(event => event.type === 'settled')) {
      this.event(live, { type: 'settled', status: status === 'completed' ? 'succeeded' : status === 'partial' ? 'partial' : 'failed' })
    } else this.save(live)
    await this.ctx.sessions.flush(parent.session)
  }
  async start(request: { context: TaskContext; prompt: string }): Promise<{ runId: string }> {
    const found = await this.ctx.sessionController.resolveAgent(SessionId(request.context.sessionId))
    if ('error' in found) throw found.error
    const state = await this.execute(found.agent, request.context, request.prompt, new AbortController().signal)
    return { runId: state.runId }
  }
  async cancel(request: { runId: string }): Promise<void> {
    const live = this.active.get(request.runId)
    if (live) {
      live.abort.abort()
      live.parent.cancel({ kind: 'user' })
      await live.done
      await live.parent.whenIdle()
      await this.ctx.get('toolboxTeamCleanup')?.(live.parent)
      await this.reconcile(live.parent)
      return
    }
    const sessionId = Buffer.from(request.runId.split('.')[0]!, 'base64url').toString()
    const parent = this.ctx.agents.get(SessionId(sessionId))
    if (!parent) return
    const state = readRun(parent.session.snapshotEvents())
    if (!state || state.runId !== request.runId || !['awaiting_delivery', 'awaiting_plan'].includes(taskStatus(state.settlement))) return
    state.settlement.execution = 'cancelled'; state.code = 'cancelled'
    this.event({ parent, state, abort: new AbortController(), done: Promise.resolve(), children: new Map() }, { type: 'settled', status: 'cancelled' })
    parent.cancel({ kind: 'user' })
    await parent.whenIdle()
    await this.ctx.get('toolboxTeamCleanup')?.(parent)
    await this.reconcile(parent)
  }
  /** Stop the exact parent's run after its pinned MCP capability was withdrawn. */
  revoke(parent: Agent): void {
    const live = [...this.active.values()].find(run => run.parent === parent)
    if (live) { live.state.code = 'mcp_revoked'; live.abort.abort() }
    parent.cancel({ kind: 'hook', reason: 'experts/mcp_revoked' })
  }
  async rerun(request: { sessionId: string }, signal: AbortSignal): Promise<void> {
    const rerun = this.ctx.get('toolboxTeamRerun')
    if (!rerun) throw new Error('experts/admission-unavailable')
    await rerun(request, signal)
  }
  async snapshot(request: { sessionId: string }) {
    const source = await this.ctx.sessionController.inspect(SessionId(request.sessionId))
    const state = readRun(source.events)
    if (state && !this.active.has(state.runId) && !this.ctx.agents.get(SessionId(request.sessionId)) && ['running', 'awaiting_delivery', 'awaiting_plan'].includes(taskStatus(state.settlement))) {
      state.settlement.execution = 'interrupted'; state.code = 'process_interrupted'
    }
    return { run: state ?? null, status: state ? taskStatus(state.settlement) : null }
  }
  async *watch(request: { runId: string; afterSequence?: number }, signal: AbortSignal): AsyncIterable<TeamRunEvent> {
    let wake = () => {}
    const queue: TeamRunEvent[] = []
    const receive = (event: TeamRunEvent) => { if (event.runId === request.runId) { queue.push(event); wake() } }
    const cancel = () => wake()
    this.observers.add(receive); signal.addEventListener('abort', cancel)
    let sequence = request.afterSequence ?? 0
    try {
      const encoded = request.runId.split('.')[0]!
      const sessionId = SessionId(Buffer.from(encoded, 'base64url').toString())
      const source = await this.ctx.sessionController.inspect(sessionId)
      const run = readRun(source.events, request.runId)
      if (!run) throw new Error('experts/run-not-found')
      if (!this.active.has(run.runId) && !this.ctx.agents.get(sessionId) && ['running', 'awaiting_delivery', 'awaiting_plan'].includes(taskStatus(run.settlement))) {
        run.settlement.execution = 'interrupted'; run.code = 'process_interrupted'
      }
      queue.unshift(...run.events)
      if (run.settlement.execution === 'interrupted' && !run.events.some(event => event.type === 'settled')) {
        queue.push({ taskId: run.context.taskId, runId: run.runId, sequence: run.events.length + 1, at: Date.now(), type: 'settled', status: 'interrupted' })
      }
      while (!signal.aborted) {
        const waiting = new Promise<void>(resolve => { wake = resolve })
        while (queue.length) {
          const event = queue.shift()!
          if (event.sequence <= sequence) { if (event.type === 'settled') return; continue }
          sequence = event.sequence
          yield event
          if (event.type === 'settled') return
        }
        await waiting
      }
    } finally { this.observers.delete(receive); signal.removeEventListener('abort', cancel) }
  }
  async dispose(): Promise<void> {
    this.closed = true
    for (const live of this.active.values()) live.abort.abort()
    await Promise.all([...this.active.values()].map(live => live.done))
    for (const lease of this.childLeases.values()) await lease.close()
    this.childLeases.clear()
  }
}
export async function apply(ctx: Context, config: { resources?: string } = {}): Promise<void> {
  ctx.typert.register(hostContribution)
  const runtime = new ExpertsRuntime(ctx, await loadTeams(config.resources))
  registerExpertsProjection(ctx)
  ctx.effect(() => () => runtime.dispose())
}
