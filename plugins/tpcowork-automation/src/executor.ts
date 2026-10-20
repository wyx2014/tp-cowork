/** Independent DSH Agent lifecycles and read-only, exact-turn recovery. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-tools'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord, pluginRecordOf, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { isUserInvocable, renderSkillContent } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { AutomationError, AutomationEvidencePendingError } from './errors.ts'
import type { AutomationExecution, AutomationExecutor, AutomationRecovery, AutomationRunOutcome,
  AutomationRunId, AutomationTaskId, ScheduledTask, ScheduledTaskRun } from './types.ts'

/** The scheduler stays unavailable until these existing Host capabilities are mounted. */
export const executorDependencies = ['agents', 'agentLoop', 'sessions', 'sessionPersistence', 'sessionQuery',
  'workingDirectory', 'workspaceRegistry', 'agentDefaultModel', 'tools'] as const

const ownershipType = 'plugin:tpcowork-automation/run'
const ownershipSchema = z.object({
  version: z.literal(1), taskId: z.string().min(1), runId: z.string().min(1), sessionId: z.string().min(1),
  turnId: z.literal(1), projectId: z.string().optional(), originSessionId: z.string().optional(),
}).strict()
/** Durable ownership evidence; an absent or invalid record never authorizes Session deletion. */
export type AutomationOwnership = z.infer<typeof ownershipSchema>

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap { 'plugin:tpcowork-automation/run': AutomationOwnership }
}
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'tpcowork-automation': { kind: 'tpcowork-automation'; taskId: AutomationTaskId; runId: AutomationRunId }
  }
}

/**
 * Read the single owner marker. Cleanup must also reject seeded/parent Sessions and compare header and run ids.
 * @param events - Validated events from the DSH persistence/query service.
 * @returns Validated owner evidence, or undefined for absent, duplicate or malformed markers.
 */
export function readAutomationOwnership(events: readonly SessionEvent[]): AutomationOwnership | undefined {
  const records = events.map(pluginRecordOf).filter(record => record?.type === ownershipType)
  if (records.length !== 1) return undefined
  const result = ownershipSchema.safeParse(records[0]!.data)
  const firstTurn = events.find(event => event.type === 'turn/start')
  return result.success && (!firstTurn || records[0]!.seq < firstTurn.seq) ? result.data : undefined
}

function unavailable(signal: AbortSignal): AutomationRunOutcome {
  return { status: 'error', resultType: 'none', conversationAvailable: false,
    errorCode: signal.aborted ? 'run_interrupted' : 'execution_failed',
    error: signal.aborted ? '运行已中断。' : '未找到本次执行可确认的终态。' }
}

/** Exact persisted turn matching; other turns and queue acceptance are never completion evidence. */
function terminalOutcome(header: SessionHeader, events: readonly SessionEvent[], task: ScheduledTask,
  run: ScheduledTaskRun): AutomationRunOutcome | undefined {
  const owner = readAutomationOwnership(events)
  if (!owner || header.isSeeded || header.parentSession !== undefined || header.id !== run.sessionId
    || owner.sessionId !== run.sessionId || owner.taskId !== task.id || owner.runId !== run.id
    || owner.turnId !== run.turnId || owner.originSessionId !== task.originSessionId || !run.ownsSession) return undefined
  const start = events.findIndex(event => event.type === 'turn/start' && event.data.turn === run.turnId)
  if (start < 0) return undefined
  const end = events.slice(start + 1).find(event => event.type === 'turn/end' && event.data.turn === run.turnId)
  if (!end || end.type !== 'turn/end') return undefined
  const ownInput = events.slice(start + 1, events.indexOf(end)).some(event => event.type === 'user/message'
    && event.data.source.kind === 'tpcowork-automation' && event.data.source.runId === run.id
    && event.data.source.taskId === task.id)
  const reason = end.data.reason.kind
  const success = reason === 'completed' && ownInput
  const interrupted = reason === 'aborted' || reason === 'interrupted' || reason === 'forked'
  return { status: success ? 'completed' : 'error', resultType: 'conversation', conversationAvailable: true,
    completedAt: Math.max(run.startedAt, end.time),
    ...success ? {} : { errorCode: interrupted ? 'run_interrupted' : 'execution_failed',
      error: interrupted ? '运行已中断。' : '自动化 Agent 未成功完成本次执行。' },
  }
}

/** Reuses Host Agents, composition, permissions, Session persistence and query services. */
export class DshAutomationExecutor implements AutomationExecutor {
  constructor(private readonly ctx: Context) {}

  /** Capture the source Session's effective choice, otherwise the user's current default; never save defaults. */
  private async selection(task: ScheduledTask, signal: AbortSignal): Promise<ModelSelection> {
    if (task.modelSelection) return { provider: task.modelSelection.provider, model: task.modelSelection.model,
      ...task.modelSelection.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(task.modelSelection.reasoningEffort) } }
    const fallback = this.ctx.agentDefaultModel.currentSelection()
    if (!task.originSessionId) return fallback
    try {
      using observation = await this.ctx.sessionQuery.observeSession(task.originSessionId, { signal, projectionMode: 'none' })
      let selected: ModelSelection | undefined
      let pending: ModelSelection | undefined
      for (const event of observation.events) {
        if (event.type === 'model/selection') pending = { provider: event.data.provider, model: event.data.model,
          ...event.data.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(event.data.reasoningEffort) } }
        if (event.type === 'request/header') {
          const { config, adapterDefaults } = event.data.header
          selected = { provider: config.provider, model: config.model,
            ...config.reasoningEffort === undefined || adapterDefaults?.reasoningEffort ? {} : { reasoningEffort: config.reasoningEffort } }
          if (pending?.provider === selected.provider && pending.model === selected.model && pending.reasoningEffort === selected.reasoningEffort) pending = undefined
        }
      }
      return pending ?? selected ?? fallback
    } catch (error) {
      // A deleted source does not import context or prevent a new independent execution.
      if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') return fallback
      throw error
    }
  }

  /** @param execution - Already persisted run and its scheduler-owned cancellation/binding operations. */
  async execute({ task, run, signal, bind }: AutomationExecution): Promise<AutomationRunOutcome> {
    signal.throwIfAborted()
    if (run.executionMode === 'reminder') return { status: 'completed', resultType: 'none', conversationAvailable: false }
    const selected = await this.selection(task, signal)
    const workspace = task.projectId === undefined ? undefined : this.ctx.workspaceRegistry.get(task.projectId)
    if (task.projectId !== undefined && !workspace) throw new AutomationError('execution_failed', '任务绑定的项目已不存在。')
    // Unbound editor/template drafts persist an empty optional directory.
    const cwd = workspace?.path ?? (task.workspacePath || this.ctx.workingDirectory.defaultDirectory)
    const presets = this.ctx.get('agentPresets')
    const preset = presets === undefined ? undefined : await presets.resolve()
    const sessionId = SessionId(`automation-${randomUUID()}`)
    const binding = { sessionId, turnId: 1, ownsSession: true }
    // The association is durable even if the process exits during Session creation.
    await bind(binding)
    signal.throwIfAborted()
    let handle: AgentHandle | undefined
    let cancel: (() => void) | undefined
    try {
      handle = await this.ctx.agents.create({ sessionId, signal, agentOptions: selected,
        meta: { cwd, ...preset === undefined ? {} : { agentPreset: preset.id } },
        setup: async (agentCtx, agent) => {
          if (presets && preset) await presets.mount(agentCtx, preset.id)
          if (task.permissionPreset) {
            const permissions = agentCtx.get('permissionPresets')
            if (!permissions) throw new AutomationError('execution_failed', '任务选择的权限配置不可用。')
            permissions.set(agent.session, task.permissionPreset)
          }
          installModelSelection(agentCtx, { current: selected, assembled: undefined })
          agent.session.append('model/selection', { provider: selected.provider, model: selected.model,
            ...selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort } })
          appendPluginRecord(agent.session, ownershipType, { version: 1, taskId: task.id, runId: run.id,
            sessionId, turnId: 1,
            ...task.projectId === undefined ? {} : { projectId: task.projectId },
            ...task.originSessionId === undefined ? {} : { originSessionId: task.originSessionId },
          })
        },
      })
      const agent = handle.agent
      cancel = () => agent.cancel({ kind: 'disposed' })
      signal.addEventListener('abort', cancel, { once: true })
      signal.throwIfAborted()
      if (task.workspacePath) await this.ctx.workingDirectory.set(agent, task.workspacePath, signal)
      else await this.ctx.workingDirectory.ensure(agent, signal)
      await this.bindSkill(agent, task, signal)
      this.requireConnectors(agent, task)
      await this.ctx.sessions.flush(agent.session)
      if (workspace) await workspace.attachSession(sessionId)
      signal.throwIfAborted()
      const connectors = task.mcpPresets?.map(preset => preset.name) ?? []
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: task.prompt },
          ...connectors.length ? [{ type: 'text' as const, text: `Use these configured MCP connectors for this task: ${connectors.join(', ')}.` }] : []],
        source: { kind: 'tpcowork-automation', taskId: task.id, runId: run.id },
      }))
      // Start our first turn before exposing the Session to other interactive callers.
      try { await bind({ ...binding, conversationAvailable: true }) }
      catch { throw new AutomationEvidencePendingError() }
      // This is a quiescence barrier, followed by exact durable evidence, never an idle=success inference.
      await agent.whenIdle()
      try { await this.ctx.sessions.flush(agent.session) }
      catch { throw new AutomationEvidencePendingError() }
      try {
        const outcome = await this.recover({ task, run: { ...run, ...binding }, signal: new AbortController().signal })
        if (!outcome) throw new AutomationEvidencePendingError()
        return outcome
      } catch { throw new AutomationEvidencePendingError() }
    } catch (error) {
      if (error instanceof AutomationEvidencePendingError) throw error
      if (signal.aborted) return unavailable(signal)
      throw error
    } finally {
      if (cancel) signal.removeEventListener('abort', cancel)
      // Retain the persisted Session; release only this executor's live Agent and scoped resources.
      try { await handle?.dispose() }
      catch { throw new AutomationEvidencePendingError() }
    }
  }

  private async bindSkill(agent: Agent, task: ScheduledTask, signal: AbortSignal): Promise<void> {
    if (!task.skillName) return
    const skills = agent.ctx.get('skills')
    const skill = await skills?.get(task.skillName, { scope: agent, cwd: this.ctx.workingDirectory.get(agent.session), signal })
    if (!skill || !isUserInvocable(skill)) throw new AutomationError('execution_failed', '任务绑定的技能不可用。')
    agent.inject(createUserMessage({ content: [{ type: 'text', text: renderSkillContent(skill) }],
      source: { kind: 'skill-invocation', name: skill.name, form: 'instructions' } }))
  }

  private requireConnectors(agent: Agent, task: ScheduledTask): void {
    const names = this.ctx.tools.schemas(agent).map(tool => tool.name)
    if (task.mcpPresets?.some(preset => !names.some(name => name.startsWith(`mcp__${preset.name}__`)))) {
      throw new AutomationError('execution_failed', '任务绑定的 MCP 连接器不可用。')
    }
  }

  /**
   * Query only raw durable events: cold Session queries synthesize interruption closers, which are not terminal evidence.
   * @param recovery - Saved Session/Turn ids; external work is never replayed.
   * @returns An exact persisted outcome, or undefined after a successful read with no terminal evidence.
   */
  async recover({ task, run, signal }: AutomationRecovery): Promise<AutomationRunOutcome | undefined> {
    signal.throwIfAborted()
    if (!run.sessionId || run.turnId === undefined || run.executionMode === 'reminder') return undefined
    let handle
    try { handle = await this.ctx.sessionPersistence.open(run.sessionId, 'read', { signal }) }
    catch (error) {
      if (error instanceof SessionPersistenceNotFoundError) return undefined
      throw error
    }
    try {
      const { events } = await handle.read(undefined, undefined, { signal })
      signal.throwIfAborted()
      return terminalOutcome(handle.header, events, task, run)
    } finally { await handle.close() }
  }
}
