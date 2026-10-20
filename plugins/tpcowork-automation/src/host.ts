/** Host management service, durable serialization and the single scheduler lifecycle. */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { AutomationStore } from './storage.ts'
import { AutomationError, parseInput } from './errors.ts'
import { hostContribution } from './remote.ts'
import { AutomationScheduler, systemClock } from './scheduler.ts'
import { beginRunSchema, bindRunSchema, createSchema, finishRunSchema, runRequestSchema, taskRequestSchema, updateSchema } from './schemas.ts'
import { DshAutomationExecutor, executorDependencies } from './executor.ts'
import { DshAutomationSessionCleanup, cleanupDependencies } from './cleanup.ts'
import { registerAutomationTools } from './tools.ts'
import { AutomationBindings } from './bindings.ts'
import { watchChanges } from './changes.ts'
import { NativeScheduleTransfer } from './native-transfer.ts'
import { registerAutomationSessionProjection } from './session-projection.ts'
import type {
  AutomationBeginRunRequest, AutomationBindRunRequest, AutomationChanged, AutomationCreateRequest,
  AutomationFinishRunRequest, AutomationRunId, AutomationRunRequest, AutomationRuntime, AutomationServiceApi,
  AutomationSessionCleanup, AutomationTaskId, AutomationTaskRequest, AutomationUpdateRequest, AutomationClock, AutomationExecutor,
  ScheduleConfig, ScheduledTask, ScheduledTaskRun, ScheduleTasksPayload, AutomationMigrationStatus,
} from './types.ts'
export type * from './types.ts'
export type { ChangeFrame } from './changes.ts'
export { AutomationError } from './errors.ts'
export { automationDomain } from './storage.ts'
export { AutomationScheduler, systemClock } from './scheduler.ts'
export { nextRunAt } from './recurrence.ts'
export { DshAutomationExecutor, readAutomationOwnership } from './executor.ts'
export type { AutomationOwnership } from './executor.ts'
export { DshAutomationSessionCleanup } from './cleanup.ts'
export { registerAutomationTools } from './tools.ts'
export { AutomationBindings } from './bindings.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { automation: AutomationService }
}

/** Gateway receiver for the plugin's read-only invalidation stream. */
class AutomationChangesService extends TypertRemoteService {
  constructor(private readonly owner: Context) { super(owner, 'automationChanges') }
  watch(signal: AbortSignal) { return watchChanges(this.owner, signal) }
}

/** Persistence authority; the package plugin below owns scheduler composition and optional native transfer. */
export class AutomationService extends TypertRemoteService implements AutomationServiceApi {
  /** Installed composition supplies ownership state; the standalone service has none. */
  migrationStatus: (() => AutomationMigrationStatus) | undefined
  static inject = ['storageDomain', 'typert']
  private readonly initialized: PromiseLike<unknown>
  private store!: AutomationStore
  private chain: Promise<unknown> = Promise.resolve()
  private stopping = false
  private closed = false
  private revision = 0
  private runtime: AutomationRuntime | undefined
  private runtimeDisposing = false
  private runtimeTeardown: Promise<void> | undefined
  private cleanup: AutomationSessionCleanup | undefined
  private cleanupDisposing = false
  private cleanupDispose: (() => Promise<void>) | undefined
  private readonly admissions = new Set<Promise<void>>()
  private readonly notifications = new Set<Promise<void>>()

  constructor(ctx: Context, private readonly options: { clock?: AutomationClock } = {}) {
    super(ctx, 'automation')
    this.initialized = ctx.effect(async () => {
      const store = await AutomationStore.open(ctx.storageDomain)
      this.store = store
      try {
        const dispose = ctx.effect(() => async () => {
          this.stopping = true
          const runtime = this.runtime
          this.runtime = undefined
          try {
            await (this.runtimeTeardown ?? runtime?.dispose())
          } finally {
            await Promise.allSettled([...this.admissions])
            try { await this.cleanupDispose?.() }
            finally {
              await this.chain
              await Promise.allSettled([...this.notifications])
              await store.close()
              this.closed = true
            }
          }
        })
        ctx.typert.register(hostContribution)
        new AutomationChangesService(ctx)
        return dispose
      } catch (error) {
        this.stopping = true
        await store.close()
        throw error
      }
    })
  }
  async [Service.init](): Promise<void> { await this.initialized }

  private assertLive(): void {
    if (this.stopping) throw new AutomationError('service_stopping', '自动化服务正在停止。')
  }
  private async ready(): Promise<void> { await this.initialized; this.assertLive() }
  private serialize<T>(work: () => Promise<T>, settlement = false): Promise<T> {
    if (!settlement || this.closed) this.assertLive()
    const result = this.chain.then(async () => { await this.initialized; return work() })
    this.chain = result.catch(() => {})
    return result
  }
  private catalog(): ScheduleTasksPayload {
    const tasks = this.store.list().sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    const targets = tasks.flatMap(task => task.nextRunAt === undefined ? [] : [task.nextRunAt])
    return { tasks, status: { enabled: this.runtime !== undefined && (this.runtime.isReady?.() ?? true), jobs: tasks.length, next_wake_at_ms: targets.length ? Math.min(...targets) : null,
      ...(this.migrationStatus ? { migration: this.migrationStatus() } : {}),
    } }
  }
  private changed(taskId: AutomationTaskId, reason: AutomationChanged['reason'], runId?: AutomationRunId): void {
    const change: AutomationChanged = { revision: ++this.revision, taskId, reason, ...(runId === undefined ? {} : { runId }) }
    // Listener failures must not make a durable mutation appear to have failed.
    if (this.stopping) return
    const pending = this.ctx.parallel('automation/changed', change).catch(() => { this.ctx.logger.warn('自动化变更监听失败；数据已保存。') })
    this.notifications.add(pending)
    void pending.finally(() => this.notifications.delete(pending))
  }
  private now(task?: ScheduledTask): number { return Math.max((this.options.clock ?? systemClock).now(), task?.updatedAt ?? 0) }
  private resolveSchedule(input: ScheduleConfig): ScheduleConfig {
    const schedule = { ...input, timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone }
    if (['hourly', 'daily', 'weekly', 'monthly', 'weekdays'].includes(input.frequency)) {
      schedule.time = { hour: input.frequency === 'hourly' ? 0 : input.time?.hour ?? 9, minute: input.time?.minute ?? 0 }
    }
    if (input.frequency === 'weekly') schedule.dayOfWeek = input.dayOfWeek ?? 1
    if (input.frequency === 'monthly') schedule.dayOfMonth = input.dayOfMonth ?? 1
    return schedule
  }
  private validateFuture(schedule: ScheduleConfig, now: number): void {
    if (schedule.frequency === 'once' && Date.parse(schedule.at!) <= now) throw new AutomationError('invalid_rule', '一次性任务的时间必须在未来。')
  }
  private target(schedule: ScheduleConfig, now: number): number | undefined {
    if (schedule.frequency === 'manual') return undefined
    return this.runtime?.nextRunAt(schedule, now)
  }
  private running(task: ScheduledTask): boolean { return task.runs.some(run => run.status === 'running') }
  private findRun(task: ScheduledTask, runId: AutomationRunId): ScheduledTaskRun {
    const run = task.runs.find(run => run.id === runId || run.runId === runId)
    if (!run) throw new AutomationError('run_not_found', '自动化运行记录不存在。')
    return run
  }
  private async save(task: ScheduledTask, reason: AutomationChanged['reason'], runId?: AutomationRunId): Promise<ScheduleTasksPayload> {
    await this.store.put(task)
    this.changed(task.id, reason, runId)
    return this.catalog()
  }

  async list(): Promise<ScheduleTasksPayload> { await this.ready(); return this.catalog() }
  /** Host-only snapshot for an already admitted execution, including during orderly shutdown. */
  getTask(id: AutomationTaskId): ScheduledTask { return this.store.get(id) }
  /** Persist a reserved paused copy before the native owner can be stopped. */
  async stageNativeTask(task: ScheduledTask): Promise<void> {
    await this.serialize(async () => {
      const current = this.store.list().find(value => value.id === task.id)
      if (current && (current.runs.length || current.status !== 'paused')) throw new AutomationError('invalid_persistence', '原生迁移副本已被执行或修改；拒绝覆盖。')
      await this.store.put({ ...task, createdAt: current?.createdAt ?? task.createdAt })
    })
  }
  /** A native delivery that won the preparation race is retained as an ended definition. */
  async endNativeTask(id: AutomationTaskId): Promise<void> {
    await this.serialize(async () => { const task = this.store.get(id); await this.save({ ...task, status: 'completed', nextRunAt: undefined }, 'updated') })
  }
  /** Only the transfer owner may activate a reserved copy before the checkpoint completes. */
  async activateNativeTask(id: AutomationTaskId): Promise<void> {
    await this.serialize(async () => { const task = this.store.get(id); await this.save({ ...task, status: 'active', updatedAt: this.now(task) }, 'updated') })
  }
  private assertNativeEditable(id: AutomationTaskId): void {
    if (id.startsWith('automation-native-') && this.migrationStatus && this.migrationStatus().phase !== 'complete') {
      throw new AutomationError('runtime_unavailable', '请先完成或恢复原生提醒迁移，再编辑迁移任务。')
    }
  }
  async create(request: AutomationCreateRequest): Promise<ScheduleTasksPayload> {
    const { timezone, ...data } = parseInput(createSchema, request)
    return this.serialize(async () => {
      const now = this.now()
      const schedule = this.resolveSchedule({ ...data.schedule, timezone: timezone ?? data.schedule.timezone })
      this.validateFuture(schedule, now)
      const status = schedule.frequency === 'manual' ? 'paused' : 'active'
      const task: ScheduledTask = {
        ...data, schedule, id: `automation-${randomUUID()}` as AutomationTaskId,
        description: data.description ?? '', skillName: data.skillName ?? '', workspacePath: data.workspacePath ?? '', mcpPresets: data.mcpPresets ?? [],
        executionMode: data.executionMode ?? 'agent', status, createdAt: now, updatedAt: now, runs: [], totalRuns: 0,
        nextRunAt: status === 'active' ? this.target(schedule, now) : undefined,
      }
      return this.save(task, 'created')
    })
  }
  async update(request: AutomationUpdateRequest): Promise<ScheduleTasksPayload> {
    const { id, data: input } = parseInput(updateSchema, request)
    this.assertNativeEditable(id)
    const { timezone, projectId, modelSelection, permissionPreset, ...data } = input
    return this.serialize(async () => {
      const task = this.store.get(id)
      const now = this.now(task)
      const schedule = this.resolveSchedule({ ...data.schedule, timezone: timezone ?? data.schedule.timezone })
      this.validateFuture(schedule, now)
      const status = schedule.frequency === 'manual' ? 'paused' : 'active'
      return this.save({ ...task, ...data, schedule, status, updatedAt: now,
        // Explicit null clears optional choices across JSON; omitted fields preserve them.
        ...('projectId' in input ? { projectId: projectId ?? undefined } : {}),
        ...('modelSelection' in input ? { modelSelection: modelSelection ?? undefined } : {}),
        ...('permissionPreset' in input ? { permissionPreset: permissionPreset ?? undefined } : {}),
        description: data.description ?? '', skillName: data.skillName ?? '', workspacePath: data.workspacePath ?? '', mcpPresets: data.mcpPresets ?? [],
        nextRunAt: status === 'active' ? this.target(schedule, now) : undefined,
        executionMode: data.executionMode ?? task.executionMode,
      }, 'updated')
    })
  }
  async delete(request: AutomationTaskRequest): Promise<ScheduleTasksPayload> {
    const { id } = parseInput(taskRequestSchema, request)
    this.assertNativeEditable(id)
    return this.serialize(async () => {
      const task = this.store.get(id)
      if (this.running(task)) throw new AutomationError('task_running', '运行中的任务不能删除。')
      // Task deletion matches the source: remove definitions/history; Session cleanup belongs to deleteRun.
      await this.store.delete(id)
      this.changed(id, 'deleted')
      return this.catalog()
    })
  }
  async pause(request: AutomationTaskRequest): Promise<ScheduleTasksPayload> {
    const { id } = parseInput(taskRequestSchema, request)
    this.assertNativeEditable(id)
    return this.serialize(async () => {
      const task = this.store.get(id)
      if (task.status === 'paused' || task.status === 'completed') return this.catalog()
      return this.save({ ...task, status: 'paused', nextRunAt: undefined, updatedAt: this.now(task) }, 'paused')
    })
  }
  async resume(request: AutomationTaskRequest): Promise<ScheduleTasksPayload> {
    const { id } = parseInput(taskRequestSchema, request)
    this.assertNativeEditable(id)
    return this.serialize(async () => {
      const task = this.store.get(id)
      const now = this.now(task)
      return this.save({ ...task, status: 'active', nextRunAt: this.target(task.schedule, now), updatedAt: now }, 'resumed')
    })
  }
  async runNow(request: AutomationTaskRequest): Promise<ScheduleTasksPayload> {
    const { id } = parseInput(taskRequestSchema, request)
    await this.ready()
    const task = this.store.get(id)
    if (this.running(task)) throw new AutomationError('task_running', '任务已在运行。')
    const runtime = this.runtime
    if (!runtime) throw new AutomationError('runtime_unavailable', '自动化调度执行模块尚未加载。')
    const admission = runtime.runNow(id)
    this.admissions.add(admission)
    try { await admission }
    finally { this.admissions.delete(admission) }
    return this.catalog()
  }
  async markRunViewed(request: AutomationRunRequest): Promise<ScheduleTasksPayload> {
    const { taskId, runId } = parseInput(runRequestSchema, request)
    return this.serialize(async () => {
      const task = this.store.get(taskId)
      const run = this.findRun(task, runId)
      if (run.status === 'running') throw new AutomationError('run_running', '运行中的记录不能标为已读。')
      if (task.schedule.frequency === 'once' && run.executionMode === 'reminder') {
        await this.store.delete(taskId)
        this.changed(taskId, 'deleted', runId)
        return this.catalog()
      }
      if (run.viewedAt !== undefined) return this.catalog()
      run.viewedAt = Math.max(this.now(task), run.completedAt!)
      task.updatedAt = run.viewedAt
      return this.save(task, 'run_viewed', runId)
    })
  }
  async deleteRun(request: AutomationRunRequest): Promise<ScheduleTasksPayload> {
    const { taskId, runId } = parseInput(runRequestSchema, request)
    return this.serialize(async () => {
      const task = this.store.get(taskId)
      const run = this.findRun(task, runId)
      if (run.status === 'running') throw new AutomationError('run_running', '运行中的记录不能删除。')
      if (run.ownsSession) {
        if (this.store.list().some(other => other.originSessionId === run.sessionId
          || other.runs.some(value => value.id !== run.id && value.sessionId === run.sessionId))) {
          throw new AutomationError('session_cleanup_failed', '会话仍被其他任务或运行引用；运行记录保留。')
        }
        if (!this.cleanup) throw new AutomationError('runtime_unavailable', '会话清理模块尚未加载；运行记录保留。')
        try { await this.cleanup.deleteRunSession(structuredClone(task), structuredClone(run)) }
        catch (cause) {
          throw new AutomationError('session_cleanup_failed', cause instanceof SessionAlreadyOwnedError
            ? '运行会话正在使用；请关闭会话后重试，运行记录保留。'
            : '运行会话清理失败；运行记录保留，可再次删除。', { cause })
        }
      }
      task.runs = task.runs.filter(value => value.id !== runId)
      task.totalRuns = task.runs.length
      task.lastRunAt = task.runs[0]?.startedAt
      task.updatedAt = this.now(task)
      return this.save(task, 'run_deleted', runId)
    })
  }

  /** Attach from ctx.effect; the disposer withdraws admission then waits for runtime teardown. */
  attachRuntime(runtime: AutomationRuntime): () => Promise<void> {
    this.assertLive()
    if (this.runtime || this.runtimeDisposing) throw new AutomationError('invalid_input', '自动化只能有一个调度模块。')
    this.runtime = runtime
    this.runtimeTeardown = undefined
    let disposal: Promise<void> | undefined
    return () => {
      if (disposal) return disposal
      if (this.runtime !== runtime) return Promise.resolve()
      this.runtime = undefined
      this.runtimeDisposing = true
      disposal = (async () => {
        let quiescent = false
        try {
          await runtime.dispose()
          quiescent = true
        } finally {
          await Promise.allSettled([...this.admissions])
          if (quiescent) this.runtimeDisposing = false
        }
      })()
      this.runtimeTeardown = disposal
      return disposal
    }
  }
  /** Execution adapter injection; the scheduler remains the only owner of attachRuntime. */
  async attachExecutor(executor: AutomationExecutor): Promise<() => Promise<void>> {
    await this.ready()
    if (!this.runtime?.attachExecutor) throw new AutomationError('runtime_unavailable', '自动化调度器尚未加载。')
    return this.runtime.attachExecutor(executor)
  }
  /** Attach from the cleanup plugin's ctx.effect. */
  attachSessionCleanup(cleanup: AutomationSessionCleanup): () => Promise<void> {
    this.assertLive()
    if (this.cleanup || this.cleanupDisposing) throw new AutomationError('invalid_input', '自动化只能有一个会话清理模块。')
    this.cleanup = cleanup
    let disposal: Promise<void> | undefined
    const detach = () => {
      if (disposal) return disposal
      this.cleanup = undefined
      this.cleanupDisposing = true
      disposal = (async () => {
        await cleanup.dispose?.()
        await this.chain
        this.cleanupDisposing = false
      })()
      return disposal
    }
    this.cleanupDispose = detach
    return detach
  }

  /** Persist admission before dispatching any external operation; duplicate attempts cannot overlap. */
  async beginRun(request: AutomationBeginRunRequest): Promise<ScheduledTaskRun> {
    const data = parseInput(beginRunSchema, request)
    return this.serialize(async () => {
      const task = this.store.get(data.taskId)
      if (this.running(task)) throw new AutomationError('task_running', '任务已在运行。')
      if (data.trigger === 'scheduled' && (task.status !== 'active' || task.schedule.frequency === 'manual')) throw new AutomationError('invalid_rule', '任务未启用自动运行。')
      const now = this.now(task)
      if (data.trigger === 'scheduled' && (data.scheduledAt === undefined || task.nextRunAt !== data.scheduledAt || data.scheduledAt > now)) {
        throw new AutomationError('invalid_rule', '任务的到期计划已变更。')
      }
      const id = `run-${randomUUID()}` as AutomationRunId
      const run: ScheduledTaskRun = {
        id, runId: id, scheduledTaskId: task.id, status: 'running', startedAt: now, trigger: data.trigger,
        scheduledAt: data.scheduledAt, resultType: 'none', conversationAvailable: false,
        ownsSession: false, executionMode: task.executionMode,
      }
      task.runs = [run, ...task.runs].slice(0, 20)
      task.totalRuns = task.runs.length
      task.lastRunAt = now
      task.updatedAt = now
      task.nextRunAt = undefined
      await this.save(task, 'run_started', id)
      return structuredClone(run)
    })
  }
  /** Bind as soon as the DSH Session/Turn is durably allocated, before starting its Agent. */
  async bindRun(request: AutomationBindRunRequest): Promise<void> {
    const data = parseInput(bindRunSchema, request)
    await this.serialize(async () => {
      const task = this.store.get(data.taskId)
      const run = this.findRun(task, data.runId)
      if (run.status !== 'running') throw new AutomationError('invalid_input', '只能关联运行中的记录。')
      if (run.sessionId && run.sessionId !== data.sessionId) throw new AutomationError('invalid_input', '运行不能更换关联会话。')
      if (run.turnId !== undefined && data.turnId !== undefined && run.turnId !== data.turnId) throw new AutomationError('invalid_input', '运行不能更换关联 Turn。')
      if (data.conversationAvailable && run.executionMode === 'reminder') throw new AutomationError('invalid_input', '纯提醒不能提供会话结果。')
      if (data.ownsSession && this.store.list().some(other => other.originSessionId === data.sessionId
        || other.runs.some(value => value.id !== run.id && value.sessionId === data.sessionId))) {
        throw new AutomationError('invalid_input', '创建会话或其他运行会话不能作为本次专属会话。')
      }
      run.sessionId = data.sessionId
      run.sessionKey = data.sessionId
      run.turnId = data.turnId ?? run.turnId
      run.ownsSession = data.ownsSession
      if (data.conversationAvailable !== undefined) {
        run.conversationAvailable = data.conversationAvailable
        run.resultType = data.conversationAvailable ? 'conversation' : 'none'
        run.conversationId = data.conversationAvailable ? data.sessionId : undefined
        run.unavailableReason = undefined
      }
      task.updatedAt = this.now(task)
      await this.save(task, 'run_bound', run.id)
    }, true)
  }
  /** Persist terminal state; recovery calls this same method and never replays external operations. */
  async finishRun(request: AutomationFinishRunRequest): Promise<void> {
    const data = parseInput(finishRunSchema, request)
    await this.serialize(async () => {
      const task = this.store.get(data.taskId)
      const run = this.findRun(task, data.runId)
      if (run.status !== 'running') return // Settlement is idempotent; late recovery cannot overwrite read state.
      run.status = data.status === 'skipped' ? 'completed' : data.status
      if (data.completedAt !== undefined && data.completedAt < run.startedAt) throw new AutomationError('invalid_input', '运行结束时间不能早于开始时间。')
      run.completedAt = data.completedAt ?? Math.max(this.now(task), run.startedAt)
      run.resultType = data.resultType
      run.conversationAvailable = data.conversationAvailable
      run.conversationId = data.conversationAvailable ? run.sessionId : undefined
      run.unavailableReason = data.unavailableReason
      run.error = data.error
      run.errorCode = data.errorCode
      run.skippedReason = data.skippedReason
      task.updatedAt = Math.max(task.updatedAt, run.completedAt)
      if (task.schedule.frequency === 'once') task.status = 'completed'
      task.nextRunAt = task.status === 'active' && task.schedule.frequency !== 'manual'
        ? this.runtime ? this.target(task.schedule, this.now(task)) : data.nextRunAt : undefined
      await this.save(task, 'run_finished', run.id)
    }, true)
  }
  /** Recompute atomically against current definitions; startup never reuses a stale CRUD snapshot. */
  async recomputeSchedules(): Promise<void> {
    await this.serialize(async () => {
      const now = this.now()
      for (const task of this.store.list()) {
        const next = task.status === 'active' && !this.running(task) ? this.target(task.schedule, now) : undefined
        if (next !== task.nextRunAt) await this.save({ ...task, nextRunAt: next, updatedAt: Math.max(now, task.updatedAt) }, 'rearmed')
      }
    })
  }
  /** Scheduler re-arms on activation, wake or rule changes, using its own validated recurrence calculation. */
  async setNextRunAt(id: AutomationTaskId, nextRunAt: number | undefined): Promise<void> {
    await this.serialize(async () => {
      const task = this.store.get(id)
      await this.save({ ...task, nextRunAt, updatedAt: this.now(task) }, 'rearmed')
    })
  }
}
/** Install the management service, unique scheduler and DSH executor when its dependencies are ready. */
export default {
  name: 'tpcowork-automation-host', inject: ['storageDomain', 'typert'],
  async apply(ctx: Context, options: { clock?: AutomationClock; nativeTakeover?: boolean } = {}): Promise<void> {
    ctx.inject(['sessionProjections'], registerAutomationSessionProjection)
    await ctx.plugin(AutomationService, options)
    ctx.inject(['typert', 'tools', 'workingDirectory'], async bindingsCtx => { await bindingsCtx.plugin(AutomationBindings) })
    await ctx.inject(['automation'], async hostCtx => {
      let activation: Promise<void> | undefined
      const start = async () => {
        const fiber = hostCtx.plugin(async (activeCtx: Context) => {
          await activeCtx.effect(async () => {
            const scheduler = new AutomationScheduler(activeCtx, activeCtx.automation, options.clock)
            await scheduler.start()
            return () => scheduler.unload()
          })
          await activeCtx.inject(['tools', 'agents', 'workingDirectory', 'workspaceRegistry'], toolsCtx => { registerAutomationTools(toolsCtx) })
          await activeCtx.inject(executorDependencies, async runtimeCtx => {
            await runtimeCtx.effect(async () => runtimeCtx.automation.attachExecutor(new DshAutomationExecutor(runtimeCtx)))
          })
        })
        try { await fiber }
        catch (error) { await fiber.dispose(); throw error }
      }
      const activate = async () => {
        if (!activation) {
          activation = start()
          void activation.catch(() => { activation = undefined })
        }
        await activation
      }
      if (options.nativeTakeover) {
        await hostCtx.inject([...executorDependencies, 'sessionController'], async transferCtx => {
          const transfer = new NativeScheduleTransfer(transferCtx, transferCtx.automation, activate)
          await transfer.start()
        })
      } else await activate()
      await hostCtx.inject(cleanupDependencies, async cleanupCtx => {
        await cleanupCtx.effect(() => cleanupCtx.automation.attachSessionCleanup(new DshAutomationSessionCleanup(cleanupCtx)))
      })
    })
  },
}
