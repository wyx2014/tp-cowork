/** Shared catalog: refreshes never touch editor drafts or overwrite newer mutations. */
import type { AutomationServiceApi, AutomationRunRequest, ScheduledTask, ScheduleTaskDraft, ScheduleTasksPayload } from './types.ts'

/** Match source archive policy using the latest run, regardless of transport array order. */
export function isArchivedOneTimeTask(task: ScheduledTask): boolean {
  if (task.schedule.frequency !== 'once' || task.status !== 'completed') return false
  const latest = task.runs.reduce<ScheduledTask['runs'][number] | undefined>((a, b) => !a || b.startedAt > a.startedAt ? b : a, undefined)
  return latest?.status === 'completed' && Boolean(latest.viewedAt)
}
/** A new editor starts with one future execution; schedule interpretation remains on the Host. */
export function newDraft(): ScheduleTaskDraft {
  const at = new Date()
  at.setDate(at.getDate() + 1)
  at.setHours(9, 0, 0, 0)
  return { name: '', prompt: '', schedule: { frequency: 'once', at: at.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, mcpPresets: [] }
}
export interface CatalogSnapshot { catalog?: ScheduleTasksPayload; loading: boolean; pending: boolean; error: boolean; failure?: string | undefined; target?: AutomationRunRequest & { sequence: number } }
function failureCode(reason: unknown): string | undefined {
  return reason !== null && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string' ? reason.code : undefined
}
/** Shared catalog for pages and the plugin-wide monitor; never executes tasks. */
export class AutomationCatalog {
  private snapshot: CatalogSnapshot = { loading: true, pending: false, error: false }
  private listeners = new Set<() => void>()
  private generation = 0
  private reading: number | undefined
  private disposed = false
  private refreshQueued = false
  private targetSequence = 0
  constructor(private readonly service: AutomationServiceApi) {}
  /** Activate after an effect setup, including React's development setup/cleanup replay. */
  start(): void { this.disposed = false; void this.refresh() }
  getSnapshot = (): CatalogSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(patch: Partial<CatalogSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
  async refresh(): Promise<void> {
    if (this.disposed) return
    if (this.snapshot.pending || this.reading !== undefined) { this.refreshQueued = true; return }
    const generation = ++this.generation
    this.reading = generation
    this.publish({ loading: !this.snapshot.catalog, error: false, failure: undefined })
    try {
      const catalog = await this.service.list()
      if (generation === this.generation) this.publish({ catalog: this.keepViewed(catalog), loading: false })
    } catch (error) { if (generation === this.generation) this.publish({ loading: false, error: true, failure: failureCode(error) }) }
    finally {
      if (this.reading === generation) this.reading = undefined
      if (this.refreshQueued && !this.snapshot.pending) { this.refreshQueued = false; void this.refresh() }
    }
  }
  /** Pushes invalidate an in-flight read; revisions are hints, never versions across Host activations. */
  invalidate(): void { if (!this.snapshot.pending) this.generation++; void this.refresh() }
  /** Select a specific retained run without constructing a conversation. */
  openRun(target: AutomationRunRequest): void { this.publish({ target: { ...target, sequence: ++this.targetSequence } }); this.invalidate() }
  private keepViewed(catalog: ScheduleTasksPayload): ScheduleTasksPayload {
    const viewed = new Map(this.snapshot.catalog?.tasks.flatMap(task => task.runs.map(run => [run.id, run.viewedAt] as const)))
    return { ...catalog, tasks: catalog.tasks.map(task => ({ ...task, runs: task.runs.map(run => {
      const at = viewed.get(run.id)
      return at !== undefined && run.status !== 'running' && (run.viewedAt === undefined || run.viewedAt < at) ? { ...run, viewedAt: at } : run
    }) })) }
  }
  async mutate(operation: () => Promise<ScheduleTasksPayload>): Promise<boolean> {
    if (this.disposed || this.snapshot.pending) return false
    const generation = ++this.generation
    this.publish({ pending: true, error: false, failure: undefined })
    try {
      const catalog = await operation()
      if (generation === this.generation) this.publish({ catalog: this.keepViewed(catalog), pending: false, loading: false })
      return !this.disposed
    } catch (error) { if (generation === this.generation) this.publish({ pending: false, loading: false, error: true, failure: failureCode(error) }); return false }
    finally { if (this.refreshQueued) { this.refreshQueued = false; void this.refresh() } }
  }
  /** Drop late responses and every page subscription on unmount. */
  dispose(): void { this.disposed = true; this.generation++; this.listeners.clear() }
}
