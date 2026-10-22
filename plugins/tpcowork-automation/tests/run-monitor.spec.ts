/** Terminal delivery, in-flight invalidation, durable acknowledgement and plugin teardown. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AutomationCatalog } from '../src/ui-state.ts'
import { AutomationRunMonitor, NOTIFICATIONS_ENABLED_KEY, RunNotificationTracker, desktopDelivery } from '../src/run-monitor.ts'
import { payloadSchema } from '../src/schemas.ts'
import { watchChanges } from '../src/changes.ts'
import type { AutomationServiceApi, ScheduleTasksPayload } from '../src/types.ts'

const payload = (status: 'running' | 'completed' | 'error' = 'running', viewedAt?: number): ScheduleTasksPayload => payloadSchema.parse({
  status: { enabled: true, jobs: 1, next_wake_at_ms: null },
  tasks: [{ id: 'task', name: 'Report', prompt: 'Private prompt', createdAt: 1, updatedAt: 1, status: 'active', executionMode: 'agent', totalRuns: 1, mcpPresets: [], schedule: { frequency: 'manual' },
    runs: [{ id: 'run', runId: 'run', scheduledTaskId: 'task', ownsSession: false, executionMode: 'agent', status, trigger: 'manual', startedAt: 2, ...(status !== 'running' ? { completedAt: 3 } : {}),
      resultType: 'none', conversationAvailable: false, ...(viewedAt === undefined ? {} : { viewedAt }) }],
  }],
})
const empty = (): ScheduleTasksPayload => ({ tasks: [], status: { enabled: true, jobs: 0, next_wake_at_ms: null } })
function service(list: () => Promise<ScheduleTasksPayload>): AutomationServiceApi {
  return { list, create: list, update: list, delete: list, pause: list, resume: list, runNow: list, markRunViewed: list, deleteRun: list }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { resolve, promise } }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('notification identities', () => {
  it('silences initial history and deduplicates run IDs across reset revisions, reorder, removal and reappearance', () => {
    const tracker = new RunNotificationTracker()
    expect(tracker.consume(payload('completed').tasks)).toEqual([])
    expect(tracker.consume(payload('error').tasks)).toEqual([])
    expect(tracker.consume([])).toEqual([])
    expect(tracker.consume(payload('completed').tasks)).toEqual([])
    const next = payload('error'); next.tasks[0]!.runs[0]!.id = 'new-run'
    expect(tracker.consume(next.tasks)).toMatchObject([{ runId: 'new-run', status: 'error' }])
    expect(tracker.consume(next.tasks)).toEqual([])
  })
  it('does not confuse bound running or an acknowledged terminal with a new result', () => {
    const tracker = new RunNotificationTracker()
    expect(tracker.consume(payload().tasks)).toEqual([])
    const bound = payload(); bound.tasks[0]!.runs[0]!.sessionId = 'allocated'
    expect(tracker.consume(bound.tasks)).toEqual([])
    expect(tracker.consume(payload('completed', 10).tasks)).toEqual([])
  })
})

describe('authoritative refresh races', () => {
  it('drops a read invalidated by a push and immediately follows it with a new read', async () => {
    const old = deferred<ScheduleTasksPayload>()
    const list = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(empty())
    const catalog = new AutomationCatalog(service(list)); const reading = catalog.refresh()
    catalog.invalidate(); old.resolve(payload('completed')); await reading
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    expect(catalog.getSnapshot().catalog?.tasks).toEqual([])
    catalog.dispose()
  })
  it('cannot restore deleted rows when a poll and push race a mutation', async () => {
    const old = deferred<ScheduleTasksPayload>(), deletion = deferred<ScheduleTasksPayload>()
    const catalog = new AutomationCatalog(service(vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(empty())))
    const reading = catalog.refresh()
    const writing = catalog.mutate(() => deletion.promise)
    catalog.invalidate(); deletion.resolve(empty()); expect(await writing).toBe(true)
    old.resolve(payload('completed')); await reading
    await vi.waitFor(() => expect(catalog.getSnapshot()).toMatchObject({ pending: false, catalog: { tasks: [] } }))
    catalog.dispose()
  })
  it('preserves the maximum viewedAt without resurrecting records absent from a Host response', async () => {
    let current = payload('completed', 20)
    const catalog = new AutomationCatalog(service(async () => current))
    await catalog.refresh(); current = payload('completed', 5); await catalog.refresh()
    expect(catalog.getSnapshot().catalog?.tasks[0]!.runs[0]!.viewedAt).toBe(20)
    current = empty(); await catalog.refresh(); expect(catalog.getSnapshot().catalog?.tasks).toEqual([])
    catalog.dispose()
  })
})

describe('global monitor lifetime', () => {
  it('polls in two seconds without a mounted page, sends success/error once, and closes timers/native handles', async () => {
    vi.useFakeTimers()
    let current = payload()
    const list = vi.fn(async () => current), deliver = vi.fn(() => vi.fn()), open = vi.fn()
    const catalog = new AutomationCatalog(service(list))
    const monitor = new AutomationRunMonitor(catalog, { open, text: notice => ({ title: notice.status, body: notice.taskName }), deliver, report: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    expect(deliver).not.toHaveBeenCalled()
    current = payload('completed'); await vi.advanceTimersByTimeAsync(2000)
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(deliver.mock.calls[0]![0]).toMatchObject({ title: 'completed', body: 'Report', target: { taskId: 'task', runId: 'run' } })
    await vi.advanceTimersByTimeAsync(4000); expect(deliver).toHaveBeenCalledTimes(1)
    current = payload('error'); current.tasks[0]!.runs[0]!.id = 'second'
    await vi.advanceTimersByTimeAsync(2000); expect(deliver).toHaveBeenCalledTimes(2)
    const closes = deliver.mock.results.map(result => result.value)
    await monitor.dispose()
    expect(vi.getTimerCount()).toBe(0); closes.forEach(close => expect(close).toHaveBeenCalledOnce())
    const count = list.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000); expect(list).toHaveBeenCalledTimes(count)
  })
  it('keeps first successful history silent after an initial load failure; late reads after disposal deliver nothing', async () => {
    vi.useFakeTimers()
    const late = deferred<ScheduleTasksPayload>()
    const list = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(payload('error')).mockReturnValueOnce(late.promise)
    const deliver = vi.fn(), catalog = new AutomationCatalog(service(list))
    const monitor = new AutomationRunMonitor(catalog, { open: vi.fn(), text: () => ({ title: '', body: '' }), deliver, report: vi.fn() })
    await vi.advanceTimersByTimeAsync(2000); expect(deliver).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000); await monitor.dispose()
    late.resolve(payload('completed')); await vi.advanceTimersByTimeAsync(0)
    expect(deliver).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
})

describe('desktop system notifications', () => {
  it('announces each new result natively, opens only announced runs on click, and honours the notification switch', async () => {
    vi.useFakeTimers()
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null })
    let current = payload()
    let click: ((id: string) => void) | undefined
    const unsubscribe = vi.fn()
    const notifications = { show: vi.fn(async () => true), subscribe: vi.fn((listener: (id: string) => void) => { click = listener; return unsubscribe }) }
    const deliver = vi.fn(), open = vi.fn()
    const monitor = new AutomationRunMonitor(new AutomationCatalog(service(async () => current)), { open, notifications, deliver, report: vi.fn(),
      text: notice => ({ title: notice.status === 'error' ? 'Automation failed' : 'Automation completed', body: notice.taskName }) })
    await vi.advanceTimersByTimeAsync(0)
    current = payload('completed'); await vi.advanceTimersByTimeAsync(2000)
    expect(notifications.show).toHaveBeenCalledExactlyOnceWith({ id: 'automation:run', key: 'automation:run', title: 'Automation completed', body: 'Report' })
    expect(deliver).not.toHaveBeenCalled()
    click!('automation:unknown'); expect(open).not.toHaveBeenCalled()
    click!('automation:run'); expect(open).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task', runId: 'run' }))
    storage.set(NOTIFICATIONS_ENABLED_KEY, 'false')
    current = payload('error'); current.tasks[0]!.runs[0]!.id = 'second'
    await vi.advanceTimersByTimeAsync(2000); expect(notifications.show).toHaveBeenCalledOnce()
    await monitor.dispose(); expect(unsubscribe).toHaveBeenCalledOnce()
    click!('automation:run'); expect(open).toHaveBeenCalledOnce()
  })
})

it('bridges committed Host invalidations to independent cancellable subscribers and sends no prompt data', async () => {
  const ctx = new Context(), one = new AbortController(), two = new AbortController()
  const a = watchChanges(ctx, one.signal)[Symbol.asyncIterator](), b = watchChanges(ctx, two.signal)[Symbol.asyncIterator]()
  try {
    expect((await a.next()).value).toEqual({ type: 'ready' }); await b.next()
    const next = a.next()
    await ctx.parallel('automation/changed', { revision: 1, taskId: 'task', runId: 'run', reason: 'run_finished' })
    expect((await next).value).toEqual({ type: 'changed', change: { revision: 1, taskId: 'task', runId: 'run', reason: 'run_finished' } })
    one.abort(); expect((await a.next()).done).toBe(true)
    expect((await b.next()).value.type).toBe('changed')
    const idle = b.next(); two.abort(); expect((await idle).done).toBe(true)
  } finally { one.abort(); two.abort(); await ctx.fiber.dispose() }
})

it('does not request permission, focuses the window on native click, and disables clicks on cleanup', () => {
  const close = vi.fn(), open = vi.fn(), focus = vi.fn()
  const instance = { onclick: null as (() => void) | null, close }
  const Native = vi.fn(function () { return instance })
  Object.assign(Native, { permission: 'denied' })
  vi.stubGlobal('Notification', Native); vi.stubGlobal('window', { focus })
  const notice = { title: 'Completed', body: 'Report', target: { taskId: 'task', runId: 'run' }, open }
  expect(desktopDelivery(notice)).toBeUndefined(); expect(Native).not.toHaveBeenCalled()
  Object.assign(Native, { permission: 'granted' })
  const dispose = desktopDelivery(notice)!
  instance.onclick!(); expect(focus).toHaveBeenCalledOnce(); expect(open).toHaveBeenCalledOnce()
  dispose(); expect(instance.onclick).toBeNull()
})
