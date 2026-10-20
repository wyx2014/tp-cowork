/** Browser-safe vocabulary shared by forms, tools, the Host scheduler and execution adapters. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Stable identities never encode a Session or infer result availability. */
export type AutomationTaskId = Branded<'AutomationTaskId'>
export type AutomationRunId = Branded<'AutomationRunId'>
/** DSH turn sequences are scoped to the associated Session, rather than globally allocated IDs. */
export type AutomationTurnId = number

/** Frequencies match nanobot-gui src/types/schedule.ts at 0873ca2. */
export type ScheduleFrequency = 'once' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'weekdays' | 'custom' | 'manual'
export type ScheduledTaskStatus = 'active' | 'paused' | 'completed'
export type ScheduledRunStatus = 'running' | 'completed' | 'error'
export type ScheduleRunResultType = 'conversation' | 'none'
export type ScheduleRunUnavailableReason = 'legacy' | 'missing'
export type AutomationExecutionMode = 'agent' | 'reminder'

/** Per-task choice; omission follows the existing source/default model at execution time. */
export interface AutomationModelSelection {
  provider: string
  model: string
  reasoningEffort?: string | undefined
}

/** Timing rules retain the source fields; everyMs and cronExpression are alternative custom selectors. */
export interface ScheduleConfig {
  frequency: ScheduleFrequency
  at?: string | undefined
  time?: { hour: number; minute: number } | undefined
  dayOfWeek?: number | undefined
  dayOfMonth?: number | undefined
  timezone?: string | undefined
  cronExpression?: string | undefined
  everyMs?: number | undefined
}

/** Connector identity only; connection secrets stay in DSH's existing credential service. */
export interface OutboundMcpPresetMention {
  name: string
  display_name?: string | undefined
  category?: string | undefined
  transport?: string | undefined
  status?: string | undefined
  configured?: boolean | undefined
  logo_url?: string | null | undefined
  brand_color?: string | null | undefined
}

/** Full editor/tool input; source description/skill/directory/MCP omissions clear those bindings on update. */
export interface ScheduleTaskDraft {
  name: string
  description?: string | undefined
  prompt: string
  schedule: ScheduleConfig
  skillName?: string | undefined
  workspacePath?: string | undefined
  mcpPresets?: OutboundMcpPresetMention[] | undefined
  projectId?: WorkspaceId | undefined
  executionMode?: AutomationExecutionMode | undefined
  modelSelection?: AutomationModelSelection | undefined
  permissionPreset?: string | undefined
}

/** Original creation Session is immutable and distinct from each independently executed run. */
export interface AutomationCreateRequest extends ScheduleTaskDraft {
  originSessionId?: SessionId | undefined
  /** Source API override; normalized into schedule.timezone before persistence. */
  timezone?: string | undefined
}
export interface AutomationTaskRequest { id: AutomationTaskId }
export interface AutomationUpdateRequest extends AutomationTaskRequest {
  data: Omit<ScheduleTaskDraft, 'projectId' | 'modelSelection' | 'permissionPreset'> & {
    /** Omission preserves these choices; null explicitly clears them across JSON transports. */
    projectId?: WorkspaceId | null | undefined
    modelSelection?: AutomationModelSelection | null | undefined
    permissionPreset?: string | null | undefined
    timezone?: string | undefined
  }
}
export interface AutomationRunRequest { taskId: AutomationTaskId; runId: AutomationRunId }

/** Authoritative task plus the most recent 20 runs; totalRuns counts retained history, matching the source API. */
export interface ScheduledTask extends ScheduleTaskDraft {
  id: AutomationTaskId
  status: ScheduledTaskStatus
  executionMode: AutomationExecutionMode
  originSessionId?: SessionId | undefined
  createdAt: number
  updatedAt: number
  lastRunAt?: number | undefined
  nextRunAt?: number | undefined
  runs: ScheduledTaskRun[]
  totalRuns: number
}

/** Only conversationAvailable=true with resultType=conversation permits opening a Session result. */
export interface ScheduledTaskRun {
  id: AutomationRunId
  runId: AutomationRunId
  scheduledTaskId: AutomationTaskId
  conversationId?: SessionId | undefined
  sessionKey?: SessionId | undefined
  sessionId?: SessionId | undefined
  turnId?: AutomationTurnId | undefined
  resultType: ScheduleRunResultType
  conversationAvailable: boolean
  unavailableReason?: ScheduleRunUnavailableReason | undefined
  startedAt: number
  completedAt?: number | undefined
  status: ScheduledRunStatus
  error?: string | undefined
  errorCode?: AutomationErrorCode | undefined
  viewedAt?: number | undefined
  trigger: 'scheduled' | 'manual'
  scheduledAt?: number | undefined
  /** Internal skipped outcome is shown as completed; its reason survives persistence. */
  skippedReason?: string | undefined
  /** Only an explicitly owned per-run Session can be removed by the cleanup adapter. */
  ownsSession: boolean
  executionMode: AutomationExecutionMode
}

/** All management methods return a complete source-compatible task catalog. */
export interface ScheduleTasksPayload {
  tasks: ScheduledTask[]
  status: { enabled: boolean; jobs: number; next_wake_at_ms: number | null; migration?: AutomationMigrationStatus | undefined }
}

/** Ownership checkpoint; overdue one-shots require an explicit manual run after migration. */
export interface AutomationMigrationStatus {
  phase: 'waiting' | 'interrupted' | 'complete'
  pending: number
  pausedOverdue: string[]
}

export type AutomationErrorCode = 'invalid_input' | 'invalid_timezone' | 'invalid_rule' | 'invalid_persistence'
  | 'storage_failure' | 'task_not_found' | 'run_not_found' | 'task_running' | 'run_running'
  | 'runtime_unavailable' | 'service_stopping' | 'run_interrupted' | 'session_cleanup_failed'
  | 'execution_failed'
export type AutomationFailureCode = `automation/${AutomationErrorCode}`

/** Same service used by the UI and chat tools. Mutations resolve only after durable commit. */
export interface AutomationServiceApi {
  list(): Promise<ScheduleTasksPayload>
  create(request: AutomationCreateRequest): Promise<ScheduleTasksPayload>
  update(request: AutomationUpdateRequest): Promise<ScheduleTasksPayload>
  delete(request: AutomationTaskRequest): Promise<ScheduleTasksPayload>
  pause(request: AutomationTaskRequest): Promise<ScheduleTasksPayload>
  resume(request: AutomationTaskRequest): Promise<ScheduleTasksPayload>
  /** Resolves after admission/start persistence, before the full run ends; paused tasks may run manually. */
  runNow(request: AutomationTaskRequest): Promise<ScheduleTasksPayload>
  markRunViewed(request: AutomationRunRequest): Promise<ScheduleTasksPayload>
  deleteRun(request: AutomationRunRequest): Promise<ScheduleTasksPayload>
}

/** Transport keeps Gateway failures structured; client service unwraps them into thrown RemoteErrors. */
export type AutomationRemoteApi = {
  [K in keyof AutomationServiceApi]: (...args: Parameters<AutomationServiceApi[K]>) => Promise<RemoteResult<ScheduleTasksPayload>>
}

/** Host-only adapters: register exactly one scheduler; attach effects to the owning plugin. */
export interface AutomationRuntime {
  /** False until the real executor's recovery has completed. Omitted for legacy adapters. */
  isReady?(): boolean
  /** Only the scheduler owns attachRuntime; execution modules use service.attachExecutor instead. */
  attachExecutor?(executor: AutomationExecutor): Promise<() => Promise<void>>
  /** Computes a future target using the source CronService restart semantics. Undefined means no target. */
  nextRunAt(schedule: ScheduleConfig, now: number): number | undefined
  /** Must persist start through beginRun before resolving; no automatic retry or full-run wait. */
  runNow(id: AutomationTaskId): Promise<void>
  /** Stop timers, abort owned work, remove listeners and await quiescence. Never delete stored data. */
  dispose(): Promise<void>
}

/** Host clock controls both durable timestamps and timer wakeups; tests may inject a deterministic clock. */
export interface AutomationClock {
  now(): number
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

/** The executor reports a durable terminal result, never just queue/message acceptance. */
export type AutomationRunOutcome = Omit<AutomationFinishRunRequest, 'taskId' | 'runId' | 'nextRunAt'>
export interface AutomationExecution {
  task: ScheduledTask
  run: ScheduledTaskRun
  signal: AbortSignal
  /** Persist Session/Turn association before starting the Agent. */
  bind(binding: Omit<AutomationBindRunRequest, 'taskId' | 'runId'>): Promise<void>
}
export interface AutomationRecovery {
  task: ScheduledTask
  run: ScheduledTaskRun
  signal: AbortSignal
}
/** Register once via ctx.effect(async () => ctx.automation.attachExecutor(executor)). */
export interface AutomationExecutor {
  /** Must stop owned work and settle when signal is aborted; sanitized errors only. */
  execute(execution: AutomationExecution): Promise<AutomationRunOutcome>
  /** Inspect saved Session/Turn; undefined confirms no terminal evidence. Never replay external work. */
  recover(recovery: AutomationRecovery): Promise<AutomationRunOutcome | undefined>
  /** Release executor-owned subscriptions/resources after all calls have settled. */
  dispose?(): Promise<void>
}

/** Cleanup must be idempotent, reject foreign Sessions, and leave the history intact on failure. */
export interface AutomationSessionCleanup {
  deleteRunSession(task: ScheduledTask, run: ScheduledTaskRun): Promise<void>
  /** Stop new cleanup calls and wait for already owned deletion operations. */
  dispose?(): Promise<void>
}

export interface AutomationBeginRunRequest {
  taskId: AutomationTaskId
  trigger: 'scheduled' | 'manual'
  scheduledAt?: number | undefined
}
export interface AutomationBindRunRequest extends AutomationRunRequest {
  sessionId: SessionId
  turnId?: AutomationTurnId | undefined
  ownsSession: boolean
  /** Explicitly publish a flushed, queryable Agent Session while the run is still running. */
  conversationAvailable?: boolean | undefined
}
export interface AutomationFinishRunRequest extends AutomationRunRequest {
  status: 'completed' | 'error' | 'skipped'
  resultType: ScheduleRunResultType
  conversationAvailable: boolean
  unavailableReason?: ScheduleRunUnavailableReason | undefined
  error?: string | undefined
  errorCode?: AutomationErrorCode | undefined
  skippedReason?: string | undefined
  /** Recovery may supply the durable turn/end timestamp instead of using the current Host clock. */
  completedAt?: number | undefined
  /** Legacy adapter fallback only; installed scheduler calculates from latest persisted rules at settlement. */
  nextRunAt?: number | undefined
}

/** Monotonic within one Host activation; clients refresh catalogs and ignore stale poll responses. */
export interface AutomationChanged {
  revision: number
  taskId: AutomationTaskId
  runId?: AutomationRunId | undefined
  reason: 'created' | 'updated' | 'deleted' | 'paused' | 'resumed' | 'run_started' | 'run_bound' | 'run_finished' | 'run_viewed' | 'run_deleted' | 'rearmed'
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** @mode emit @param change - A committed automation mutation; no prompt or credentials. */
    'automation/changed'(change: AutomationChanged): void
  }
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap extends Record<AutomationFailureCode, {}> {}
  interface TypertRemoteNamespaceMap { automation: AutomationRemoteApi }
  interface TypertClientRemote {
    automationMigration: { migrate(request: { confirm: true }): Promise<RemoteResult<ScheduleTasksPayload>> }
  }
}
