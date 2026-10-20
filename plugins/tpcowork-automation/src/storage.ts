/** One authoritative DSH storage domain; unload closes its handle and retains its medium. */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { taskSchema } from './schemas.ts'
import { AutomationError } from './errors.ts'
import type { AutomationTaskId, ScheduledTask } from './types.ts'

export const automationDomain = defineDomain({
  name: 'tpcowork_automation', version: 1,
  tables: { tasks: domainTable<AutomationTaskId, ScheduledTask>(taskSchema) },
})

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

  list(): ScheduledTask[] { return [...this.domain.table('tasks').entries()].map(([, task]) => structuredClone(task)) }
  get(id: AutomationTaskId): ScheduledTask {
    const task = this.domain.table('tasks').get(id)
    if (!task) throw new AutomationError('task_not_found', '自动化任务不存在。')
    return structuredClone(task)
  }

  async put(task: ScheduledTask): Promise<void> {
    const result = taskSchema.safeParse(task)
    if (!result.success) throw new AutomationError('invalid_persistence', '自动化记录校验失败；未写入存储。', { cause: result.error })
    // Optional undefined fields are absent on JSON media and on Gateway wire values.
    // Keep live records in that same representation so a restart does not change the catalog.
    const json: unknown = JSON.parse(JSON.stringify(result.data))
    const value = taskSchema.parse(json)
    try { await this.domain.table('tasks').put(task.id, value) }
    catch (cause) { throw new AutomationError('storage_failure', '自动化数据保存失败；当前状态保留。', { cause }) }
  }

  async delete(id: AutomationTaskId): Promise<void> {
    this.get(id)
    try { await this.domain.table('tasks').delete(id) }
    catch (cause) { throw new AutomationError('storage_failure', '自动化任务删除失败；当前状态保留。', { cause }) }
  }
  close(): Promise<void> { return this.domain.close() }
}
