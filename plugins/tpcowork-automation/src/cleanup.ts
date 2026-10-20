/** Delete only independently owned run Sessions through the Host persistence service. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { SessionAlreadyOwnedError, SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import { readAutomationOwnership } from './executor.ts'
import { AutomationError } from './errors.ts'
import type { AutomationSessionCleanup, ScheduledTask, ScheduledTaskRun } from './types.ts'

/** Existing Host capabilities needed for ownership checks and durable deletion. */
export const cleanupDependencies = ['sessions', 'agents', 'sessionPersistence', 'workspaceRegistry'] as const

/** Cleanup rejects active owners, retains retryable history on failure, and awaits owned work on unload. */
export class DshAutomationSessionCleanup implements AutomationSessionCleanup {
  private stopping = false
  private readonly pending = new Set<Promise<void>>()
  private readonly stopForwarding: () => void

  constructor(private readonly ctx: Context) {
    // Cold persisted Sessions have no resident Session disposal event to remove sidebar rows.
    this.stopForwarding = ctx.on('session-persistence/deleted', id => { ctx.emit('api-session/removed', id) })
  }

  /**
   * Delete one inspected independent Session, including retrying committed deletion projection cleanup.
   * @param task - Persisted task including its immutable creation Session identity.
   * @param run - Ended run; ownsSession alone never authorizes deletion.
   */
  deleteRunSession(task: ScheduledTask, run: ScheduledTaskRun): Promise<void> {
    if (this.stopping) return Promise.reject(new AutomationError('service_stopping', '会话清理模块正在停止。'))
    const operation = this.remove(task, run)
    this.pending.add(operation)
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation))
    return operation
  }

  private async remove(task: ScheduledTask, run: ScheduledTaskRun): Promise<void> {
    if (run.status === 'running') throw new AutomationError('run_running', '运行中的记录不能删除。')
    // Old shared-session records are history-only deletions, including ones without a Session at all.
    if (!run.ownsSession) return
    const id = run.sessionId
    if (!id || id === task.originSessionId || run.executionMode !== 'agent'
      || run.scheduledTaskId !== task.id || run.id !== run.runId || run.turnId !== 1
      || run.sessionKey !== undefined && run.sessionKey !== id
      || run.conversationId !== undefined && run.conversationId !== id) {
      throw new AutomationError('session_cleanup_failed', '无法确认本次运行的独立会话归属。')
    }
    if (this.ctx.sessions.get(id) || this.ctx.agents.get(id)) throw new SessionAlreadyOwnedError(id)
    const persistence = this.ctx.sessionPersistence
    const snapshot = await persistence.stat(id)
    if (snapshot === undefined) {
      await persistence.delete(id, { expectedRevision: undefined })
      return
    }
    let reader
    try { reader = await persistence.open(id, 'read') }
    catch (error) {
      if (!(error instanceof SessionPersistenceNotFoundError)) throw error
      await persistence.delete(id, { expectedRevision: undefined })
      return
    }
    try {
      const header = reader.header
      const owner = readAutomationOwnership((await reader.read()).events)
      if (!owner || header.id !== id || header.isSeeded || header.parentSession !== undefined
        || reader.inheritedEventCount !== 0 || owner.sessionId !== id || owner.taskId !== task.id
        || owner.runId !== run.id || owner.turnId !== run.turnId
        || owner.originSessionId !== task.originSessionId || owner.sessionId === owner.originSessionId) {
        throw new AutomationError('session_cleanup_failed', '会话归属不匹配；独立运行会话未删除。')
      }
      // Tasks can be edited after a run; validate its captured project against the actual immutable header.
      const project = this.ctx.workspaceRegistry.list().find(value => value.id === owner.projectId)
      if (project && project.path !== header.cwd) {
        throw new AutomationError('session_cleanup_failed', '运行会话与归属项目不匹配。')
      }
    } finally { await reader.close() }
    await persistence.delete(id, { expectedRevision: snapshot.revision })
  }

  /** Withdraw admission and wait for every already started cleanup; never remove retained task data. */
  async dispose(): Promise<void> {
    this.stopping = true
    await Promise.allSettled([...this.pending])
    this.stopForwarding()
  }
}
