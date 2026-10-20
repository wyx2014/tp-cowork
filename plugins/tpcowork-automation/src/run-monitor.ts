/** Plugin-wide terminal observation, native delivery and toast lifetime. */
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { AutomationCatalog } from './ui-state.ts'
import type { AutomationRunRequest, ScheduledTask } from './types.ts'
import { changeFrameSchema } from './changes.ts'

export interface RunNotice extends AutomationRunRequest { taskName: string; status: 'completed' | 'error' }
export interface DesktopNotice { title: string; body: string; target: AutomationRunRequest; open(): void; closed?(): void }
export type DesktopDelivery = (notice: DesktopNotice) => (() => void) | undefined

/** Existing Electron Chromium notification bridge; permission remains owned by the shell/OS. */
export function desktopDelivery(notice: DesktopNotice): (() => void) | undefined {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const notification = new Notification(notice.title, { body: notice.body, tag: `automation:${notice.target.runId}` })
  notification.onclick = () => { window.focus(); notice.open(); notification.close() }
  notification.onclose = () => { notification.onclick = null; notice.closed?.() }
  return () => { notification.onclick = null; notification.onclose = null; notification.close() }
}

/** Initial successful history is silent; terminal identities survive reconnects and temporary removals. */
export class RunNotificationTracker {
  private initialized = false
  private readonly terminal = new Set<string>()
  consume(tasks: readonly ScheduledTask[]): RunNotice[] {
    const notices: RunNotice[] = []
    for (const task of tasks) for (const run of task.runs) {
      if (run.status === 'running' || this.terminal.has(run.id)) continue
      this.terminal.add(run.id)
      if (this.initialized && run.viewedAt === undefined) notices.push({ taskId: task.id, runId: run.id, taskName: task.name, status: run.status })
    }
    this.initialized = true
    return notices
  }
}

interface MonitorOptions {
  open(target: AutomationRunRequest): void
  text(notice: RunNotice): { title: string; body: string }
  deliver?: DesktopDelivery
  remote?: Pick<ClientRemote, '$stream' | 'automationChanges'>
  report(error: unknown): void
}

/** Timers only reread Host state. Disposal cancels and joins the supervised Gateway subscription. */
export class AutomationRunMonitor {
  private readonly tracker = new RunNotificationTracker()
  private notices: readonly RunNotice[] = []
  private readonly listeners = new Set<() => void>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly native = new Map<string, () => void>()
  private readonly stopCatalog: () => void
  private readonly timer: ReturnType<typeof setInterval>
  private stream: ReturnType<ClientRemote['$stream']> | undefined
  private pumping: Promise<void> | undefined
  private reconnecting: Promise<void> = Promise.resolve()
  private stopped = false
  constructor(private readonly catalog: AutomationCatalog, private readonly options: MonitorOptions) {
    this.stopCatalog = catalog.subscribe(() => this.observe())
    this.observe()
    this.timer = setInterval(() => {
      void catalog.refresh()
      if (options.remote && !this.pumping) this.reconnect()
    }, 2000)
    if (options.remote) {
      const remote = options.remote
      this.stream = remote.$stream({ name: 'automation changes', open: signal => remote.automationChanges.watch(signal), ended: () => new Error('automation changes ended') })
      this.pumping = this.pump(this.stream)
    }
    catalog.start()
  }
  getSnapshot = (): readonly RunNotice[] => this.notices
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(notices: readonly RunNotice[]): void { this.notices = notices; for (const listener of this.listeners) listener() }
  dismiss(runId: string): void {
    clearTimeout(this.timers.get(runId)); this.timers.delete(runId)
    this.publish(this.notices.filter(notice => notice.runId !== runId))
  }
  open(notice: RunNotice): void { if (!this.stopped) { this.options.open(notice); this.dismiss(notice.runId) } }
  private observe(): void {
    const snapshot = this.catalog.getSnapshot()
    if (this.stopped || !snapshot.catalog || snapshot.loading || snapshot.error) return
    for (const notice of this.tracker.consume(snapshot.catalog.tasks)) {
      this.publish([...this.notices, notice])
      this.timers.set(notice.runId, setTimeout(() => this.dismiss(notice.runId), 8000))
      try {
        const dispose = (this.options.deliver ?? desktopDelivery)({ ...this.options.text(notice), target: notice, open: () => this.open(notice), closed: () => { this.native.delete(notice.runId) } })
        if (dispose) this.native.set(notice.runId, dispose)
      } catch (error) { this.options.report(error) }
    }
  }
  /** New Connection generations replace failed subscriptions without resetting terminal identities. */
  reconnect(): void {
    this.reconnecting = this.reconnecting.then(async () => {
      if (this.stopped || !this.options.remote) return
      await this.stream?.dispose(); await this.pumping
      if (this.stopped) return
      const remote = this.options.remote
      const stream = remote.$stream({ name: 'automation changes', open: signal => remote.automationChanges.watch(signal), ended: () => new Error('automation changes ended') })
      this.stream = stream; this.pumping = this.pump(stream)
    }).catch(error => { if (!this.stopped) this.options.report(error) })
  }
  private async pump(stream: NonNullable<AutomationRunMonitor['stream']>): Promise<void> {
    try {
      for await (const item of stream) {
        changeFrameSchema.parse(item.value)
        if (this.stopped) return
        item.accept()
        // Ready also refreshes: changes can have happened while disconnected. Revision may have reset.
        this.catalog.invalidate()
      }
    } catch (error) { if (!this.stopped) this.options.report(error) }
    finally { if (this.stream === stream) this.pumping = undefined }
  }
  async dispose(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    clearInterval(this.timer); this.stopCatalog()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const close of this.native.values()) { try { close() } catch (error) { this.options.report(error) } }
    this.native.clear(); this.listeners.clear(); this.catalog.dispose()
    await this.reconnecting
    await this.stream?.dispose()
    await this.pumping
  }
}
