/** Explicit Host ownership transfer. Native records and delivery receipts remain in their original domain. */
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import ScheduleService, { scheduleDomain } from '@deepseek-ai/dsh-schedule'
import type { ScheduleTask, ScheduleCatalogEntry } from '@deepseek-ai/dsh-schedule'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { AutomationError } from './errors.ts'
import type { AutomationService } from './host.ts'
import type { AutomationTaskId, ScheduleConfig, AutomationMigrationStatus } from './types.ts'

const checkpointSchema = z.object({
  phase: z.enum(['prepared', 'transferring', 'activating', 'complete']),
  ids: z.array(z.string().min(1)),
  pausedOverdue: z.array(z.string().min(1)),
}).strict()
export const nativeTransferDomain = defineDomain({
  name: 'tpcowork_automation_transfer', version: 1,
  tables: { checkpoints: domainTable<string, z.infer<typeof checkpointSchema>>(checkpointSchema) },
})

declare module '@deepseek-ai/cordis' { interface Context { automationMigration: NativeScheduleTransfer } }

/** Deterministic identities make retrying an interrupted copy idempotent. */
export function nativeAutomationId(id: string): AutomationTaskId { return `automation-native-${id}` as AutomationTaskId }

/** Preserve native sub-minute calendar precision through Croniter's seconds field. */
export function nativeSchedule(record: ScheduleCatalogEntry): ScheduleConfig {
  switch (record.kind) {
    case 'after': case 'at': return { frequency: 'once', at: record.scheduledAt, timezone: 'UTC' }
    case 'every': return { frequency: 'custom', everyMs: record.everySeconds * 1000, timezone: 'UTC' }
    case 'cron': return { frequency: 'custom', cronExpression: record.expression, timezone: record.timeZone }
    case 'daily': case 'weekly': {
      const [hour, minute, seconds] = record.time.split(':')
      const second = Number(seconds)
      // Fractional calendar seconds have no equivalent in the automation rule vocabulary.
      if (!Number.isInteger(second)) throw new AutomationError('invalid_rule', '旧提醒含毫秒日历规则；请先在原生管理中调整为整秒，旧任务继续调度。')
      const days = record.kind === 'daily' ? '*' : record.weekdays.map(day => day % 7).join(',')
      return { frequency: 'custom', cronExpression: `${Number(minute)} ${Number(hour)} * * ${days} ${second}`, timezone: record.timeZone }
    }
  }
}

/** Native delivery continues until the user confirms and every staged definition is durable. */
export class NativeScheduleTransfer extends TypertRemoteService {
  private journal!: Domain<typeof nativeTransferDomain>
  private nativeFiber: { dispose(): Promise<void> } | undefined
  private operation: Promise<unknown> | undefined
  private stopping = false
  private status: AutomationMigrationStatus = { phase: 'waiting', pending: 0, pausedOverdue: [] }

  constructor(ctx: Context, private readonly automation: AutomationService, private readonly activate: () => Promise<void>) {
    super(ctx, 'automationMigration')
  }

  /** Inspect before mounting either scheduler; a checkpoint never implicitly replays migration. */
  async start(): Promise<void> {
    if (this.ctx.get('schedule')) throw new AutomationError('runtime_unavailable', '原生 Schedule 已由其他入口加载；拒绝启动第二个调度器。')
    this.journal = await this.ctx.storageDomain.open(nativeTransferDomain)
    this.ctx.effect(() => async () => {
      this.stopping = true
      await this.operation?.catch(() => {})
      await this.nativeFiber?.dispose()
      await this.journal.close()
    })
    const checkpoint = this.journal.table('checkpoints').get('native')
    const native = await this.ctx.storageDomain.open(scheduleDomain)
    let active: ScheduleTask[]
    try { active = [...native.table('tasks').entries()].map(([, task]) => task).filter(task => task.status === 'active') }
    finally { await native.close() }
    if (checkpoint?.phase === 'complete') {
      if (active.length) throw new AutomationError('invalid_persistence', '原生调度在移交后重新启用；已阻止自动化启动，请检查调度所有权。')
      await this.activate()
      this.status = { phase: 'complete', pending: 0, pausedOverdue: checkpoint.pausedOverdue }
    } else if (checkpoint) {
      this.status = { phase: 'interrupted', pending: checkpoint.ids.length, pausedOverdue: checkpoint.pausedOverdue }
    } else if (active.length) {
      this.status = { phase: 'waiting', pending: active.length, pausedOverdue: [] }
      const fiber = this.ctx.plugin(ScheduleService, {})
      await fiber
      this.nativeFiber = fiber
    } else {
      await this.activate()
      this.status = { phase: 'complete', pending: 0, pausedOverdue: [] }
    }
    this.automation.migrationStatus = () => structuredClone(this.status)
  }

  /** Explicit confirmation is validated on the Host even for non-UI consumers. */
  async migrate(request: { confirm: true }) {
    if (request?.confirm !== true) throw new AutomationError('invalid_input', '迁移需要明确确认。')
    if (this.stopping) throw new AutomationError('service_stopping', '迁移服务正在停止。')
    if (!this.operation) {
      const operation = this.transfer()
      this.operation = operation
      void operation.finally(() => { this.operation = undefined }).catch(() => {})
    }
    await this.operation
    return this.automation.list()
  }

  private async stage(records: ScheduleCatalogEntry[]): Promise<void> {
    // Validate the entire set before changing ownership or stopping the native service.
    const drafts = records.map(record => ({ record, schedule: nativeSchedule(record) }))
    for (const { record, schedule } of drafts) {
      const project = this.ctx.get('workspaceRegistry')?.list().find(workspace => workspace.sessionIds.includes(record.sessionId))
      await this.automation.stageNativeTask({
        id: nativeAutomationId(record.id), name: record.title, description: 'Migrated native reminder',
        prompt: record.prompt, schedule, originSessionId: record.sessionId,
        status: 'paused', executionMode: 'agent', skillName: '', mcpPresets: [], workspacePath: project?.path ?? '',
        ...(project ? { projectId: project.id } : {}),
        createdAt: Date.now(), updatedAt: Date.now(), runs: [], totalRuns: 0,
      })
    }
  }

  private async transfer(): Promise<void> {
    if (this.status.phase === 'complete') return
    const checkpoints = this.journal.table('checkpoints')
    let checkpoint = checkpoints.get('native')
    if (!checkpoint) {
      const records = (await this.ctx.schedule.catalog()).filter(record => record.status === 'active')
      await this.stage(records)
      checkpoint = { phase: 'prepared', ids: records.map(record => record.id), pausedOverdue: [] }
      await checkpoints.put('native', checkpoint)
    }
    this.status = { phase: 'interrupted', pending: checkpoint.ids.length, pausedOverdue: checkpoint.pausedOverdue }
    // Teardown drains native enqueue + persistence. A fresh read below includes any delivery that won this race.
    await this.nativeFiber?.dispose()
    this.nativeFiber = undefined
    if (this.stopping) return
    const native = await this.ctx.storageDomain.open(scheduleDomain)
    try {
      const tasks = native.table('tasks')
      if (checkpoint.phase === 'prepared') {
        const rows = [...tasks.entries()].map(([, task]) => task)
        const active = rows.filter(task => task.status === 'active')
        await this.stage(active.map(task => ({ ...task.record, sessionId: task.sessionId, status: task.status })))
        // A one-shot delivered during preparation stays ended in the destination, never delivered twice.
        const ids = [...new Set([...checkpoint.ids, ...active.map(task => task.record.id)])]
        for (const id of ids) {
          const task = tasks.get(id as ScheduleTask['record']['id'])
          if (!task || task.status !== 'active') await this.automation.endNativeTask(nativeAutomationId(id))
        }
        checkpoint = { ...checkpoint, phase: 'transferring', ids }
        await checkpoints.put('native', checkpoint)
      }
      if (checkpoint.phase === 'transferring') {
        for (const id of checkpoint.ids) {
          const old = tasks.get(id as ScheduleTask['record']['id'])
          const target = this.automation.getTask(nativeAutomationId(id))
          if (target.status !== 'paused' && target.status !== 'completed') throw new AutomationError('invalid_persistence', '迁移副本状态已变更；保留检查点。')
          if (old?.status === 'active') {
            if (!isDeepStrictEqual(target.schedule, nativeSchedule({ ...old.record, sessionId: old.sessionId, status: old.status }))
              || target.prompt !== old.record.prompt || target.originSessionId !== old.sessionId) {
              throw new AutomationError('invalid_persistence', '迁移副本与原生定义不一致；旧任务和检查点保留。')
            }
            // Native status changes only after the paired destination has been persisted and read back.
            await tasks.put(old.record.id, { ...old, status: 'inactive' })
          }
        }
        checkpoint = { ...checkpoint, phase: 'activating' }
        await checkpoints.put('native', checkpoint)
      }
      if (checkpoint.phase === 'activating') {
        const pausedOverdue: string[] = []
        for (const id of checkpoint.ids) {
          const task = this.automation.getTask(nativeAutomationId(id))
          if (task.status !== 'paused') continue
          if (task.schedule.frequency === 'once' && Date.parse(task.schedule.at!) <= Date.now()) pausedOverdue.push(task.id)
          else await this.automation.activateNativeTask(task.id)
        }
        checkpoint = { ...checkpoint, phase: 'complete', pausedOverdue }
        await checkpoints.put('native', checkpoint)
      }
    } finally { await native.close() }
    await this.activate()
    this.status = { phase: 'complete', pending: 0, pausedOverdue: checkpoint.pausedOverdue }
  }
}
