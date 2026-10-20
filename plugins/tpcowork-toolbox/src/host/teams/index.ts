/** Toolbox manages choices; experts executes them at the native Agent pre-step. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-skill'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord, pluginRecordOf, SessionId } from '@deepseek-ai/dsh-session'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '../../host.ts'
import type { FirstSubmissionRequest, SelectionCatalog, TaskContext, TaskSubmissionApi, TeamsApi } from '../../contracts/index.ts'
import type { TaskMcpLease } from '../mcp/index.ts'
import { pinTaskContext, taskStatus } from '../../task-context.ts'
import { managementContribution } from '../../client/remote.ts'
import { contextRecord, selectionRecord, admissionSchema } from '../../../../tpcowork-experts/src/schema.ts'
import { readContext, readSelection, readRun } from '../../../../tpcowork-experts/src/host.ts'
import type {} from '../../../../tpcowork-experts/src/host.ts'
import { teamItem } from '../../../../tpcowork-experts/src/teams.ts'
import { nameTeamSession } from '../../../../tpcowork-experts/src/native-presentation.ts'

export const name = 'toolbox-teams'
export const inject = ['typert', 'experts', 'agents', 'sessions', 'sessionController', 'workingDirectory', 'systemPrompt']
declare module '@deepseek-ai/cordis' { interface Context { toolboxTasks: TaskSubmissionApi } }

class Teams extends TypertRemoteService implements TeamsApi {
  constructor(ctx: Context) { super(ctx, 'toolboxTeams') }
  async inventory() {
    // Delivery tools belong to the active Session preset in Web/Desktop.
    const ready = !!this.ctx.get('workflowEngine') && !!this.ctx.get('subagents')?.getProvider('spawn')
    return { revision: ready ? 2 : 1, complete: true, items: this.ctx.experts.teams.map(team => teamItem(team, ready)) }
  }
}
export class Tasks extends TypertRemoteService implements TaskSubmissionApi {
  private counter = Date.now()
  private readonly catalogs = new Map<string, { signature: string; revision: number }>()
  private readonly tails = new Map<string, Promise<unknown>>()
  private readonly leases = new Map<Agent, { lease: TaskMcpLease; release(): Promise<void> }>()
  private readonly cleanup = new Map<Agent, Promise<void>>()
  private readonly reruns = new Set<string>()
  private readonly runningChoices = new Map<Agent, TaskContext | null>()
  private readonly claimed = new Map<Agent, UserMessage[]>()
  private readonly changedChoices = new Set<Agent>()
  private closed = false
  constructor(ctx: Context) {
    super(ctx, 'toolboxTasks')
    ctx.on('agent/inbox/claimed', ({ agent, message }) => {
      const batch = this.claimed.get(agent) ?? []
      batch.push(message); this.claimed.set(agent, batch)
    })
    ctx.on('system-prompt/assemble', async (_assembly, request, next) => {
      if (!request.agent || !request.signal) return next()
      const agent = request.agent
      let refresh: boolean
      try { refresh = await this.prepareChoice(agent, this.claimed.get(agent) ?? [], request.signal) }
      finally { this.claimed.delete(agent) }
      if (!refresh) return next()
      // A changed MCP scope invalidates the providers collected before this waterfall.
      // The fresh assembly delegates through this listener with the scope already ready.
      return ctx.systemPrompt.assemble(request)
    })
    ctx.on('agent/pre-step', async ({ agent, messages, signal, step }, next) => {
      await this.prepareChoice(agent, messages, signal)
      const context = this.stepChoice(agent, messages)
      const changed = this.changedChoices.delete(agent)
      if (!context) return next()
      let skillText = ''
      for (const selected of step === 1 || changed ? context.skills : []) {
        const item = (await ctx.get('toolboxSkills')!.inventory({ sessionId: agent.id })).items.find(item => item.id === selected.id)!
        const skill = await agent.ctx.get('skills')!.get(item.name, { scope: agent, cwd: ctx.workingDirectory.get(agent.session), signal })
        if (!skill) throw new Error('toolbox/skill-unavailable')
        skillText += '\n' + renderSkillContent(skill)
      }
      const prior = readRun(agent.session.snapshotEvents())
      const rerun = this.reruns.delete(agent.id)
      let notice = context.team ? skillText : step === 1 || changed
        ? `本次消息的技能：${context.skills.map(item => item.id).join('、') || '无'}。本次消息的 MCP：${context.mcp.map(item => item.id).join('、') || '无'}。\n后续执行以本次选择为准，已取消的历史技能不再作为本次任务指令。\n${skillText}` : ''
      if (context.team && (!prior || rerun)) {
        if (!agent.ctx.tools.get('present', agent) || !agent.ctx.tools.get('todo_write', agent)) throw new Error('experts/delivery-tools-unavailable')
        const prompt = messages.flatMap(message => message.content.filter(part => part.type === 'text').map(part => part.text)).join('\n')
        const attachments = messages.flatMap(message => message.content.filter(part => part.type !== 'text'))
        // Children see only durable attachment references, never browser upload receipts or image base64.
        const task = skillText + '\n' + prompt + (attachments.length ? '\n用户附件（仅通过可用工具读取；不能读取时说明缺口）：\n' + JSON.stringify(attachments) : '')
        const run = await ctx.experts.execute(agent, context, task, signal)
        const final = run.artifacts.filter(item => item.kind !== 'member')
        notice += `\n团队研究状态：${taskStatus(run.settlement)}。runId=${run.runId}。`
          + `\n当前任务清单：${JSON.stringify(agent.session.snapshotEvents().findLast(event => event.type === 'todo/write')?.data)}。沿用这份清单，保留每位专家和未完成项，不另建一份计划。`
          + (run.researchDone ? `\n请审阅真实报告并调用 present 一次交付这两份文件：${JSON.stringify(final.map(item => ({ path: item.path })))}。`
            + '\n然后调用 todo_write 核对完整计划，必须包含名为「交付 Markdown/HTML 报告」的步骤。成功的研究/综合/审阅/文件交付项标记 completed；失败成员项保留 pending 并说明，不能伪造完成。交付步骤实际成功后必须 completed，不得长期 in_progress。'
            : '\n团队未完成研究。明确说明失败/取消及证据缺口，不得把回合结束描述为任务完成。')
      }
      const decision = await next()
      if (decision.kind !== 'enter' || !notice) return decision
      return { ...decision, messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text: notice }], source: { kind: 'tpcowork-experts', runId: context.team ? readRun(agent.session.snapshotEvents())?.runId ?? 'selection' : context.taskId } })] }
    })
    ctx.on('agent/status', ({ agent, status }) => {
      if (status !== 'idle' || !this.runningChoices.has(agent)) return
      const work = this.release(agent).then(() => ctx.experts.reconcile(agent))
      this.cleanup.set(agent, work)
      void work.then(() => { if (this.cleanup.get(agent) === work) this.cleanup.delete(agent) })
        .catch(() => { ctx.logger.warn('experts: 任务清理或交付核对失败。') })
    })
    ctx.on('agent/disposed', async ({ agent }) => {
      try { await this.cleanup.get(agent); await this.release(agent) }
      finally { this.cleanup.delete(agent); this.runningChoices.delete(agent); this.claimed.delete(agent); this.changedChoices.delete(agent); this.catalogs.delete(agent.id); this.reruns.delete(agent.id) }
    })
  }
  private async prepareChoice(agent: Agent, messages: readonly UserMessage[], signal: AbortSignal): Promise<boolean> {
    await this.cleanup.get(agent)
    const context = this.stepChoice(agent, messages)
    const changed = this.runningChoices.get(agent)?.taskId !== context?.taskId
    let refresh = false
    if (changed) {
      refresh = this.leases.has(agent)
      await this.release(agent)
      this.changedChoices.add(agent)
    }
    this.runningChoices.set(agent, context)
    if (!context) return refresh
    await this.validate(context)
    if (context.mcp.length && !this.leases.has(agent)) {
      const runtime = this.ctx.get('toolboxMcpRuntime')
      if (!runtime) throw new Error('toolbox/mcp-runtime-unavailable')
      const lease = await runtime.openTask(context, agent.ctx, signal)
      const revoked = () => {
        if (!signal.aborted) this.ctx.experts.revoke(agent)
      }
      lease.signal.addEventListener('abort', revoked, { once: true })
      this.leases.set(agent, { lease, release: async () => { lease.signal.removeEventListener('abort', revoked); await lease.close() } })
      refresh = true
    }
    return refresh
  }
  private stepChoice(agent: Agent, messages: readonly UserMessage[]): TaskContext | null {
    const events = agent.session.snapshotEvents()
    if (this.reruns.has(agent.id)) return readContext(events)
    const requestId = (message: UserMessage): string | undefined => message.source.kind === 'user' && 'rpcId' in message.source && typeof message.source.rpcId === 'string' ? message.source.rpcId : undefined
    const consumed = events.flatMap(event => event.type === 'user/message' ? [event.data] : []).map(requestId).filter(id => id !== undefined)
    const previous = this.runningChoices.has(agent) ? this.runningChoices.get(agent) ?? null
      : consumed.map(id => readSelection(events, id)).findLast(context => context?.team !== null && context?.team !== undefined)
        ?? (consumed.length ? readSelection(events, consumed.at(-1)) : null)
    const incoming = messages.map(requestId).findLast(id => id !== undefined)
    if (incoming !== undefined) return readSelection(events, incoming) ?? (previous?.team ? previous : null)
    return previous
  }
  private serialize<T>(id: string, work: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(id) ?? Promise.resolve()).catch(() => {}).then(work)
    this.tails.set(id, result)
    void result.finally(() => { if (this.tails.get(id) === result) this.tails.delete(id) }).catch(() => {})
    return result
  }
  async selection({ sessionId }: { sessionId: string }): Promise<SelectionCatalog> {
    const [skills, mcp, inventory] = await Promise.all([
      this.ctx.get('toolboxSkills')?.inventory({ sessionId }) ?? { revision: 0, complete: true, items: [] },
      this.ctx.get('toolboxMcp')?.inventory() ?? { revision: 0, complete: true, items: [] }, this.ctx.get('toolboxTeams')!.inventory(),
    ])
    const agent = this.ctx.agents.get(SessionId(sessionId))
    const available = !agent || ['write', 'present', 'todo_write'].every(name => agent.ctx.tools.get(name, agent))
    const teams = available ? inventory : { ...inventory, revision: 1, items: this.ctx.experts.teams.map(team => teamItem(team, false)) }
    // Connecting and releasing a task changes MCP observations, not its selected configuration.
    const mcpChoices = mcp.items.map(item => ({
      id: item.id, label: item.label, origin: item.origin, configRevision: item.configRevision,
      installed: item.installed, enabled: item.enabled, credentials: item.credentials,
      readiness: { state: item.readiness.state === 'checking' ? 'ready' : item.readiness.state, reasons: item.readiness.reasons },
    }))
    const signature = JSON.stringify([skills.revision, mcpChoices, teams.revision, skills.complete, mcp.complete, teams.complete])
    let observed = this.catalogs.get(sessionId)
    if (!observed || observed.signature !== signature) { observed = { signature, revision: ++this.counter }; this.catalogs.set(sessionId, observed) }
    return { revision: observed.revision, skills, mcp, teams }
  }
  async context(request: { sessionId: string; taskId: string }): Promise<TaskContext | null> {
    if (request.taskId !== request.sessionId) throw new Error('toolbox/task-identity-mismatch')
    const inspected = await this.ctx.sessionController.inspect(SessionId(request.sessionId))
    const fixed = readContext(inspected.events)
    return fixed?.team ? fixed : readSelection(inspected.events) ?? fixed
  }
  submit(request: FirstSubmissionRequest, signal: AbortSignal) {
    return this.serialize(request.message.sessionId, async () => {
      if (this.closed) throw new Error('toolbox/tasks-disposed')
      const inspected = await this.ctx.sessionController.inspect(SessionId(request.message.sessionId))
      let context = readSelection(inspected.events, request.message.requestId)
      await this.ctx.sessionController.promptWithAdmission(request.message, async agent => {
        const fixed = readContext(agent.session.snapshotEvents())
        if (fixed?.team) context = fixed
        if ((context?.team || request.selection.team) && !['write', 'present', 'todo_write'].every(name => agent.ctx.tools.get(name, agent))) throw new Error('experts/delivery-tools-unavailable')
        if (!context) {
          context = pinTaskContext({ sessionId: agent.id, taskId: request.selection.team ? agent.id : `message:${request.message.requestId}`, submittedAt: Date.now() }, request.selection, await this.selection({ sessionId: agent.id }))
          appendPluginRecord(agent.session, selectionRecord, { version: 1, requestId: request.message.requestId, context })
        }
        await this.validate(context)
        if (context.team) {
          const team = this.ctx.experts.teams.find(team => team.id === context!.team!.id)!
          const prompt = request.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
          nameTeamSession(agent.session, team, prompt)
        }
        if (!await this.ctx.sessions.flush(agent.session)) throw new Error('toolbox/persistence-unavailable')
      }, signal)
      context ??= await this.context({ sessionId: request.message.sessionId, taskId: request.message.sessionId })
      if (!context) throw new Error('toolbox/context-not-admitted')
      return { accepted: true as const, context }
    })
  }
  private async validate(context: TaskContext): Promise<void> {
    const inventory = await this.selection({ sessionId: context.sessionId })
    for (const pin of context.skills) {
      const item = inventory.skills.items.find(item => item.id === pin.id)
      if (!inventory.skills.complete || !item?.installed || !item.enabled || item.readiness.state !== 'ready' || item.fingerprint !== pin.fingerprint || item.version !== pin.version) throw new Error('toolbox/pinned-skill-changed')
    }
    for (const pin of context.mcp) {
      const item = inventory.mcp.items.find(item => item.id === pin.id)
      if (!inventory.mcp.complete || !item?.installed || !item.enabled || item.readiness.state !== 'ready' || item.configRevision !== pin.configRevision) throw new Error('toolbox/pinned-mcp-changed')
    }
    if (context.team && !inventory.teams.items.some(item => item.id === context.team?.id && item.version === context.team.version && item.workflowId === context.team.workflowId && item.enabled && item.readiness.state === 'ready')) throw new Error('toolbox/pinned-team-changed')
  }
  /** Explicit rerun keeps the pinned choices and issues one new native prompt. */
  async rerun(request: { sessionId: string }, signal: AbortSignal): Promise<void> {
    await this.serialize(request.sessionId, async () => {
      const context = await this.context({ ...request, taskId: request.sessionId })
      if (!context?.team) throw new Error('experts/no-team')
      await this.validate(context)
      const found = await this.ctx.sessionController.resolveAgent(SessionId(request.sessionId))
      if ('error' in found) throw found.error
      const { run, status } = await this.ctx.experts.snapshot(request)
      if (!run || !['failed', 'cancelled', 'interrupted', 'partial', 'completed'].includes(status ?? '') || found.agent.status !== 'idle') throw new Error('experts/rerun-unavailable')
      const events = found.agent.session.snapshotEvents()
      const input = events.map(pluginRecordOf).find(record => (record?.type === contextRecord || record?.type === selectionRecord) && admissionSchema.parse(record.data).context.team !== null)
      const requestId = input ? admissionSchema.parse(input.data).requestId : undefined
      const candidates = events.flatMap(event => event.type === 'user/message' ? [event.data] : event.type === 'agent/inbox/spliced' ? event.data.inserted ?? [] : [])
      const original = candidates.find(message => message.source.kind === 'user' && 'rpcId' in message.source && message.source.rpcId === requestId)
      if (!original) throw new Error('experts/prompt-unavailable')
      signal.throwIfAborted()
      this.reruns.add(request.sessionId)
      found.agent.followup(createUserMessage({ content: original.content, source: { kind: 'tpcowork-experts', runId: run.runId } }))
    })
  }
  async drain(agent: Agent): Promise<void> {
    await this.cleanup.get(agent)
    await this.release(agent)
  }
  private async release(agent: Agent): Promise<void> {
    const owned = this.leases.get(agent)
    this.leases.delete(agent)
    await owned?.release()
  }
  async dispose(): Promise<void> {
    this.closed = true
    await Promise.all([...this.tails.values()].map(promise => promise.catch(() => {})))
    for (const agent of this.leases.keys()) await this.release(agent)
    await Promise.all(this.cleanup.values())
    this.runningChoices.clear(); this.claimed.clear(); this.changedChoices.clear()
  }
}
/** T7 calls this once within the toolbox Host composition after the experts service exists. */
export function apply(ctx: Context): void {
  ctx.typert.register({ package: '@tpcowork/dsh-toolbox-teams', face: 'host',
    invocations: managementContribution.descriptors.filter(item => ['toolboxTeams', 'toolboxTasks'].includes(item.namespace)), schemas: [], model: { services: [], objects: [], events: [] } })
  new Teams(ctx)
  const tasks = new Tasks(ctx)
  // Host-only rerun is exposed by the experts Remote delegate, retaining a single admission owner.
  ctx.provide('toolboxTeamRerun', (request: { sessionId: string }, signal: AbortSignal) => tasks.rerun(request, signal))
  ctx.provide('toolboxTeamCleanup', (agent: Agent) => tasks.drain(agent))
  ctx.effect(() => () => tasks.dispose())
}
declare module '@deepseek-ai/cordis' { interface Context { toolboxTeamCleanup: (agent: Agent) => Promise<void>; toolboxTeamRerun: (request: { sessionId: string }, signal: AbortSignal) => Promise<void> } }
