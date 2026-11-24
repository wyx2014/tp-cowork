/** One Host-owned timer and due queue. Persistence remains exclusively in AutomationService. */
import { AutomationError, AutomationEvidencePendingError } from './errors.ts'
import type { Context } from '@deepseek-ai/cordis'
import { nextRunAt } from './recurrence.ts'
import type { AutomationService } from './host.ts'
import type { AutomationClock, AutomationExecutor, AutomationRunId, AutomationRuntime, AutomationTaskId,
  ScheduledTask, ScheduledTaskRun, AutomationRunOutcome } from './types.ts'

/**
 * The run history's error text: the executor's own explanation of an execution failure (project removed, skill or
 * connector unavailable, …) when it gave one, otherwise the generic message. Other errors are internal and stay generic.
 */
function failureMessage(error: unknown): string {
  return error instanceof AutomationError && error.code === 'automation/execution_failed' ? error.message : '自动化执行失败。'
}

export const systemClock: AutomationClock = {
  now: () => Date.now(),
  setTimeout(callback, delayMs) { const timer = setTimeout(callback, delayMs); timer.unref(); return timer },
  clearTimeout(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>) },
}
const staleMs = 24 * 60 * 60 * 1000
const maxAgentRuns = 3
const recoveryTimeoutMs = 10_000
const recoveryRetryMs = 60_000

export class AutomationScheduler implements AutomationRuntime {
  readonly nextRunAt = nextRunAt
  private executor: AutomationExecutor | undefined
  private ready = false
  private stopped = false
  private timer: unknown
  private detach: (() => Promise<void>) | undefined
  private unsubscribe: (() => void) | undefined
  private dispatch: Promise<void> | undefined
  private recovery: Promise<void> | undefined
  private connecting: Promise<void> | undefined
  private disconnecting = false
  private disposal: Promise<void> | undefined
  private connection: AbortController | undefined
  private agentSlots = 0
  private readonly executions = new Map<AutomationTaskId, { controller: AbortController; runId: string; release(): void; done: Promise<void> }>()
  private readonly admissions = new Set<Promise<unknown>>()
  private recoveryReads = new Set<AutomationRunId>()
  private readonly recoverAfter = new Map<AutomationRunId, number>()

  constructor(private readonly ctx: Context, private readonly service: AutomationService, private readonly clock: AutomationClock = systemClock,
    private readonly maxSleepMs = 300_000) {}

  async start(): Promise<void> {
    this.detach = this.service.attachRuntime(this)
    this.unsubscribe = this.ctx.on('automation/changed', () => { this.arm() })
    try { await this.service.recomputeSchedules() }
    catch (error) { await this.unload(); throw error }
  }
  isReady(): boolean { return this.ready && !this.stopped }
  async attachExecutor(executor: AutomationExecutor): Promise<() => Promise<void>> {
    if (this.stopped) throw new AutomationError('service_stopping', '自动化调度器已停止。')
    if (this.executor || this.disconnecting) throw new AutomationError('invalid_input', '自动化只能有一个执行器。')
    this.executor = executor
    this.connection = new AbortController()
    const connect = (async () => {
      await this.service.recomputeSchedules()
      if (this.stopped) return
      this.ready = true
      this.recoverAfter.clear()
      this.recoveryReads = new Set()
      this.recover()
      this.arm()
    })()
    this.connecting = connect
    try { await connect }
    catch (error) { await this.disconnect(executor); throw error }
    finally { if (this.connecting === connect) this.connecting = undefined }
    return () => this.disconnect(executor)
  }
  private async disconnect(executor: AutomationExecutor): Promise<void> {
    if (this.executor !== executor) return
    this.disconnecting = true
    this.ready = false
    this.connection?.abort()
    this.clearTimer()
    // Withdraw new admission before waiting; an already admitted execution retains its executor reference.
    this.executor = undefined
    for (const execution of this.executions.values()) execution.controller.abort()
    let quiescent = false
    try {
      await Promise.allSettled([...this.admissions])
      for (const execution of this.executions.values()) execution.controller.abort()
      await Promise.allSettled([...this.executions.values()].map(value => value.done))
      await this.dispatch
      await this.recovery
      await executor.dispose?.()
      quiescent = true
    } finally { this.disconnecting = !quiescent }
  }
  private clearTimer(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    this.timer = undefined
  }
  private arm(): void {
    this.clearTimer()
    if (!this.isReady() || this.dispatch) return
    // list is async: track this short read as an admission, so disposal cannot outlive store access.
    const pending = this.service.list().then(payload => {
      if (!this.isReady() || this.dispatch) return
      const targets = payload.tasks.filter(task => task.status === 'active' && !task.runs.some(run => run.status === 'running')
        && (task.executionMode === 'reminder' || this.agentSlots < maxAgentRuns))
        .flatMap(task => task.nextRunAt === undefined ? [] : [task.nextRunAt])
      const delay = Math.min(this.maxSleepMs, Math.max(0, (targets.length ? Math.min(...targets) : this.clock.now() + this.maxSleepMs) - this.clock.now()))
      this.clearTimer()
      this.timer = this.clock.setTimeout(() => { this.timer = undefined; void this.wake() }, delay)
    }).catch(() => { /* Service disposal withdraws the timer. */ })
    this.admissions.add(pending)
    void pending.finally(() => this.admissions.delete(pending))
  }
  /** Concurrent wakes share only the due scan and durable admissions. */
  wake(): Promise<void> {
    if (this.dispatch) return this.dispatch
    if (!this.isReady()) return Promise.resolve()
    this.clearTimer()
    const pending = (async () => {
      this.recover()
      const now = this.clock.now()
      const due = (await this.service.list()).tasks.filter(task => task.status === 'active' && task.schedule.frequency !== 'manual'
        && task.nextRunAt !== undefined && task.nextRunAt <= now && !task.runs.some(run => run.status === 'running'))
        .sort((a, b) => a.nextRunAt! - b.nextRunAt! || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      for (const task of due) {
        if (!this.isReady()) break
        try { await this.admit(task.id, task.nextRunAt) }
        catch (error) {
          // Edits, other admissions, or a full Agent pool leave the next item eligible, including reminders.
          if (error instanceof AutomationError && ['automation/task_running', 'automation/task_not_found', 'automation/invalid_rule', 'automation/agent_capacity'].includes(error.code)) continue
          throw error
        }
      }
    })().catch(() => {
      // Never retry a failed execution. Storage/recovery faults leave durable evidence for a later wake.
      this.ctx.logger.warn('自动化调度未完成；已保留持久化记录。')
      if (this.isReady()) this.timer = this.clock.setTimeout(() => { this.timer = undefined; void this.wake() }, this.maxSleepMs)
    }).finally(() => {
      this.dispatch = undefined
      if (this.timer === undefined) this.arm()
    })
    this.dispatch = pending
    return pending
  }
  async runNow(id: AutomationTaskId): Promise<void> { await this.admit(id) }
  /** A stopped run is already settled; a hung Agent must not hold its task or the dispatch of other tasks. */
  releaseRun(id: AutomationTaskId, runId: string): void {
    const execution = this.executions.get(id)
    if (execution?.runId !== runId) return
    this.executions.delete(id)
    execution.controller.abort()
    execution.release()
    this.arm()
  }
  private async admit(id: AutomationTaskId, scheduledAt?: number): Promise<void> {
    const executor = this.executor
    if (!executor || !this.isReady()) throw new AutomationError('runtime_unavailable', '自动化执行器尚未就绪。')
    let agentSlot = false
    const releaseSlot = () => {
      if (!agentSlot) return
      agentSlot = false
      this.agentSlots--
    }
    const admission = (async () => {
      const run = await this.service.beginRun({ taskId: id, trigger: scheduledAt === undefined ? 'manual' : 'scheduled', scheduledAt }, mode => {
        if (!this.isReady() || this.executor !== executor) throw new AutomationError('runtime_unavailable', '自动化执行器尚未就绪。')
        if (mode === 'reminder') return
        if (this.agentSlots >= maxAgentRuns) throw new AutomationError('agent_capacity', 'Agent 运行已满，请稍后重试。')
        this.agentSlots++
        agentSlot = true
      })
      const task = { ...this.service.getTask(id), executionMode: run.executionMode }
      // A stopped run may have been durably settled immediately before this admission.
      const previous = this.executions.get(id)
      if (previous) this.releaseRun(id, previous.runId)
      const controller = new AbortController()
      if (!this.isReady() || this.executor !== executor) controller.abort()
      // Schedule work after durable start; admission never awaits the Agent's terminal state.
      const done = Promise.resolve().then(async () => {
        let outcome: AutomationRunOutcome
        try {
          if (controller.signal.aborted) throw new Error('stopped')
          outcome = await executor.execute({ task, run, signal: controller.signal,
            bind: binding => this.service.bindRun({ ...binding, taskId: id, runId: run.id }) })
        } catch (error) {
          if (error instanceof AutomationEvidencePendingError) {
            this.ctx.logger.warn('自动化终态尚未确认持久化；保留 running 记录等待恢复。')
            return
          }
          outcome = { status: 'error', resultType: 'none', conversationAvailable: false,
            errorCode: controller.signal.aborted ? 'run_interrupted' : 'execution_failed',
            error: controller.signal.aborted ? '运行已中断。' : failureMessage(error) }
        }
        await this.service.finishRun({ ...outcome, taskId: id, runId: run.id })
      }).catch(() => {
        // A failed terminal write remains running for Session/Turn recovery, never replay.
        this.ctx.logger.warn('自动化运行结算失败；保留 running 记录等待恢复。')
      }).finally(() => {
        releaseSlot()
        if (this.executions.get(id)?.controller === controller) this.executions.delete(id)
        this.arm()
      })
      let release = () => {}
      const released = new Promise<void>(resolve => { release = () => { releaseSlot(); resolve() } })
      this.executions.set(id, { controller, runId: run.id, release, done: Promise.race([done, released]) })
    })()
    this.admissions.add(admission)
    try { await admission }
    catch (error) { releaseSlot(); throw error }
    finally { this.admissions.delete(admission) }
  }
  private recover(): void {
    if (this.recovery) return
    const executor = this.executor
    const connection = this.connection
    if (!executor || !connection || !this.isReady()) return
    const pending = (async () => {
      const { tasks } = await this.service.list()
      const running = new Set(tasks.flatMap(task => task.runs.filter(run => run.status === 'running').map(run => run.id)))
      for (const id of this.recoverAfter.keys()) if (!running.has(id)) this.recoverAfter.delete(id)
      for (const task of tasks) {
        for (const run of task.runs) {
          if (connection.signal.aborted) return
          if (run.status !== 'running' || this.executions.has(task.id) || this.recoveryReads.has(run.id)
            || (this.recoverAfter.get(run.id) ?? 0) > this.clock.now()) continue
          this.recoverAfter.set(run.id, this.clock.now() + recoveryRetryMs)
          try {
            const outcome = await this.readRecovery(executor, task, run, connection.signal)
            if (connection.signal.aborted) return
            if (outcome) await this.service.finishRun({ ...outcome, taskId: task.id, runId: run.id })
            else if (this.clock.now() - run.startedAt > staleMs) await this.interrupt(task, run)
          } catch {
            if (!connection.signal.aborted) this.ctx.logger.warn('自动化运行恢复暂未完成，将稍后重试。')
          }
        }
      }
    })().catch(() => {
      if (!connection.signal.aborted) this.ctx.logger.warn('自动化恢复暂未完成，将稍后重试。')
    }).finally(() => { if (this.recovery === pending) this.recovery = undefined })
    this.recovery = pending
  }
  private readRecovery(executor: AutomationExecutor, task: ScheduledTask, run: ScheduledTaskRun, connection: AbortSignal): Promise<AutomationRunOutcome | undefined> {
    const signal = AbortSignal.any([connection, AbortSignal.timeout(recoveryTimeoutMs)])
    const reads = this.recoveryReads
    reads.add(run.id)
    // A timed-out adapter may ignore its signal. Ignore its late result and do not duplicate that read.
    const read = Promise.resolve().then(() => executor.recover({ task, run, signal }))
      .finally(() => { reads.delete(run.id) })
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      void read.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }
  private async interrupt(task: ScheduledTask, run: ScheduledTaskRun): Promise<void> {
    await this.service.finishRun({ taskId: task.id, runId: run.id, status: 'error', resultType: 'none',
      conversationAvailable: false, errorCode: 'run_interrupted', error: '运行超过 24 小时且没有可确认的终态，已标记中断。' })
  }
  private async stop(): Promise<void> {
    this.stopped = true
    this.ready = false
    this.clearTimer()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.connection?.abort()
    await this.connecting?.catch(() => {})
    if (this.executor) await this.disconnect(this.executor)
    await Promise.allSettled([...this.admissions])
    await this.dispatch
  }
  dispose(): Promise<void> { return this.disposal ??= this.stop() }
  /** Explicit scheduler unload releases the unique runtime registration as well. */
  async unload(): Promise<void> { await this.detach?.() }
}
