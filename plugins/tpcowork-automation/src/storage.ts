/** One authoritative DSH storage domain; unload closes its handle and retains its medium. */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { runSchema, sessionIdSchema, taskIdSchema, taskSchema } from './schemas.ts'
import { AutomationError } from './errors.ts'
import type { AutomationRunId, AutomationTaskId, ScheduledTask, ScheduledTaskRun } from './types.ts'

// A task mutation and its new cleanup intents publish together in one domain write. A deleted task retains only
// the ownership fields needed for pending cleanup. Ordinary records keep their existing on-disk shape.
const cleanupRecordSchema = z.object({
  id: taskIdSchema, originSessionId: sessionIdSchema.optional(), task: taskSchema.nullable(),
  pendingCleanup: z.array(runSchema).min(1),
}).strict().refine(({ id, originSessionId, task, pendingCleanup }) =>
  (!task || task.id === id && task.originSessionId === originSessionId)
  && pendingCleanup.every(run => run.ownsSession && run.status !== 'running' && run.scheduledTaskId === id
    && !task?.runs.some(retained => retained.id === run.id))
  && new Set(pendingCleanup.map(run => run.id)).size === pendingCleanup.length, 'invalid pending Session cleanup')
const storedTaskSchema = z.union([taskSchema, cleanupRecordSchema])
type StoredTask = z.infer<typeof storedTaskSchema>

export const automationDomain = defineDomain({
  name: 'tpcowork_automation', version: 1,
  tables: { tasks: domainTable<AutomationTaskId, StoredTask>(storedTaskSchema) },
})

function activeTask(record: StoredTask | undefined): ScheduledTask | null | undefined {
  return record && ('pendingCleanup' in record ? record.task : record)
}

/** Owns schema checks, identity checks, durability and snapshots; service owns operation serialization. */
export class AutomationStore {
  private constructor(private readonly domain: Domain<typeof automationDomain>) {}

  static async open(facility: DomainFacility): Promise<AutomationStore> {
    let domain: Domain<typeof automationDomain> | undefined
    try {
      domain = await facility.open(automationDomain)
      for (const [key, task] of domain.table('tasks').entries()) {
        if (key !== task.id) throw new Error('stored task key differs from task.id')
      }
      return new AutomationStore(domain)
    } catch (cause) {
      try { await domain?.close() }
      catch (closeError) { throw new AutomationError('invalid_persistence', '自动化数据读取失败，关闭存储亦失败；原文件保留。', { cause: new AggregateError([cause, closeError]) }) }
      throw new AutomationError('invalid_persistence', '自动化数据读取失败；原文件保留，请检查存储版本及记录。', { cause })
    }
  }

  list(): ScheduledTask[] {
    return [...this.domain.table('tasks').entries()].flatMap(([, record]) => {
      const task = activeTask(record)
      return task ? [structuredClone(task)] : []
    })
  }
  get(id: AutomationTaskId): ScheduledTask {
    const task = activeTask(this.domain.table('tasks').get(id))
    if (!task) throw new AutomationError('task_not_found', '自动化任务不存在。')
    return structuredClone(task)
  }

  async put(task: ScheduledTask, retired: readonly ScheduledTaskRun[] = []): Promise<void> {
    const pendingCleanup = this.pendingFor(task.id).concat(retired.filter(run => run.ownsSession))
    await this.write(task.id, pendingCleanup.length ? { id: task.id, originSessionId: task.originSessionId, task, pendingCleanup } : task)
  }

  async delete(id: AutomationTaskId, retireResults = false): Promise<void> {
    const task = this.get(id)
    const pendingCleanup = this.pendingFor(id).concat(retireResults ? task.runs.filter(run => run.ownsSession) : [])
    if (pendingCleanup.length > 0) {
      await this.write(id, { id, originSessionId: task.originSessionId, task: null, pendingCleanup })
    } else await this.remove(id)
  }

  cleanupJobs(): { owner: Pick<ScheduledTask, 'id' | 'originSessionId'>; run: ScheduledTaskRun }[] {
    return [...this.domain.table('tasks').entries()].flatMap(([, record]) => 'pendingCleanup' in record
      ? record.pendingCleanup.map(run => ({ owner: { id: record.id, originSessionId: record.originSessionId }, run: structuredClone(run) }))
      : [])
  }

  async completeCleanup(id: AutomationTaskId, runId: AutomationRunId): Promise<void> {
    const record = this.domain.table('tasks').get(id)
    if (!record || !('pendingCleanup' in record)) return
    const pendingCleanup = record.pendingCleanup.filter(run => run.id !== runId)
    if (pendingCleanup.length === record.pendingCleanup.length) return
    if (pendingCleanup.length) await this.write(id, { ...record, pendingCleanup })
    else if (record.task) await this.write(id, record.task)
    else await this.remove(id)
  }

  private pendingFor(id: AutomationTaskId): ScheduledTaskRun[] {
    const record = this.domain.table('tasks').get(id)
    return record && 'pendingCleanup' in record ? record.pendingCleanup : []
  }

  private async write(id: AutomationTaskId, record: StoredTask): Promise<void> {
    // Optional undefined fields are absent on JSON media and on Gateway wire values.
    // Keep live records in that same representation so a restart does not change the catalog.
    const result = storedTaskSchema.safeParse(JSON.parse(JSON.stringify(record)))
    if (!result.success) throw new AutomationError('invalid_persistence', '自动化记录校验失败；未写入存储。', { cause: result.error })
    try { await this.domain.table('tasks').put(id, result.data) }
    catch (cause) { throw new AutomationError('storage_failure', '自动化数据保存失败；当前状态保留。', { cause }) }
  }

  private async remove(id: AutomationTaskId): Promise<void> {
    try { await this.domain.table('tasks').delete(id) }
    catch (cause) { throw new AutomationError('storage_failure', '自动化任务删除失败；当前状态保留。', { cause }) }
  }
  close(): Promise<void> { return this.domain.close() }
}
