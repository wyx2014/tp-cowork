/** Plugin-wide terminal observation and system notification delivery. */
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { AutomationCatalog } from './ui-state.ts'
import type { AutomationRunRequest, ScheduledTask } from './types.ts'
import { changeFrameSchema } from './changes.ts'

export interface RunNotice extends AutomationRunRequest { taskName: string; status: 'completed' | 'error' }
export interface DesktopNotice { title: string; body: string; target: AutomationRunRequest; open(): void; closed?(): void }
export type DesktopDelivery = (notice: DesktopNotice) => (() => void) | undefined

/** The desktop shell's native notifications: shown only while no application window is focused. */
export interface SystemNotifications {
  show(notification: { id: string; key: string; title: string; body: string }): Promise<boolean>
  subscribe(listener: (id: string) => void): () => void
}

/** The product-wide notification switch, shared with the TP Cowork settings page. */
export const NOTIFICATIONS_ENABLED_KEY = 'tpcowork-notification-enabled'
export function notificationsEnabled(): boolean {
  try { return globalThis.localStorage?.getItem(NOTIFICATIONS_ENABLED_KEY) !== 'false' }
  catch { return true }
}

const NOTIFICATION_PREFIX = 'automation:'
const MAX_CLICK_TARGETS = 100

/** Web fallback outside the desktop shell; permission remains owned by the browser. */
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
  /** Desktop shell notifications; absent in a plain browser. */
  notifications?: SystemNotifications
  deliver?: DesktopDelivery
  remote?: Pick<ClientRemote, '$stream' | 'automationChanges'>
  report(error: unknown): void
}

/** Timers only reread Host state. Disposal cancels and joins the supervised Gateway subscription. */
export class AutomationRunMonitor {
  private readonly tracker = new RunNotificationTracker()
  private readonly native = new Map<string, () => void>()
  // Clicked system notifications name a run; only results this monitor announced are opened.
  private readonly targets = new Map<string, RunNotice>()
  private readonly stopClicks: () => void
  private readonly stopCatalog: () => void
  private readonly timer: ReturnType<typeof setInterval>
  private stream: ReturnType<ClientRemote['$stream']> | undefined
  private pumping: Promise<void> | undefined
  private reconnecting: Promise<void> = Promise.resolve()
  private stopped = false
  constructor(private readonly catalog: AutomationCatalog, private readonly options: MonitorOptions) {
    this.stopClicks = options.notifications?.subscribe(id => {
      const notice = this.targets.get(id)
      if (notice) this.open(notice)
    }) ?? (() => {})
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
  open(notice: RunNotice): void { if (!this.stopped) this.options.open(notice) }
  private observe(): void {
    const snapshot = this.catalog.getSnapshot()
    if (this.stopped || !snapshot.catalog || snapshot.loading || snapshot.error) return
    for (const notice of this.tracker.consume(snapshot.catalog.tasks)) {
      if (!notificationsEnabled()) continue
      const notifications = this.options.notifications
      if (notifications) {
        const id = `${NOTIFICATION_PREFIX}${notice.runId}`
        this.targets.set(id, notice)
        if (this.targets.size > MAX_CLICK_TARGETS) this.targets.delete(this.targets.keys().next().value!)
        void notifications.show({ id, key: id, ...this.options.text(notice) }).catch(error => this.options.report(error))
        continue
      }
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
    clearInterval(this.timer); this.stopCatalog(); this.stopClicks()
    for (const close of this.native.values()) { try { close() } catch (error) { this.options.report(error) } }
    this.native.clear(); this.targets.clear(); this.catalog.dispose()
    await this.reconnecting
    await this.stream?.dispose()
    await this.pumping
  }
}
