import { afterEach, expect, it, vi } from 'vitest'
import { watchSessionNotifications } from '../src/notifications.js'

type Status = { running: boolean | undefined; pendingInteraction?: Record<string, unknown> & { key: string; kind: string }; completionUnread: boolean }
const en: Record<string, string> = { notifyTask: 'Task: {title}', notifyCompleted: 'Task completed', notifyApproval: 'Needs your confirmation',
  notifyQuestion: 'Needs your reply', notifyPlan: 'Plan awaiting confirmation', notifyPlanBody: 'Review the plan to continue' }
const t = (key: string, params?: Record<string, string>) => (en[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? '')

function setup() {
  let status = new Map<string, Status>()
  const listeners = new Set<() => void>()
  const rows: Record<string, { displayTitle: string; origin?: string; parentId?: string }> = {
    one: { displayTitle: 'Fix the build' }, child: { displayTitle: 'Helper', origin: 'subagent', parentId: 'one' }, 'automation-run': { displayTitle: 'Daily report' },
  }
  let click: ((id: string) => void) | undefined
  const bridge = { show: vi.fn(async () => true), subscribe: vi.fn((listener: (id: string) => void) => { click = listener; return () => { click = undefined } }) }
  const uiWorkspace = { openSession: vi.fn() }
  const services = {
    sessions: { list: { getSnapshot: () => ({ byId: rows }) } },
    uiSession: { sessionStatus: { getSnapshot: () => status, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) } } },
    uiWorkspace,
  }
  const publish = (entries: [string, Partial<Status>][]) => {
    status = new Map(entries.map(([id, value]) => [id, { running: undefined, completionUnread: false, ...value }]))
    for (const listener of listeners) listener()
  }
  const stop = watchSessionNotifications(services, bridge, t)
  return { bridge, uiWorkspace, publish, stop, click: (id: string) => click?.(id), listeners }
}
afterEach(() => { vi.unstubAllGlobals() })

it('treats the first status as history, then announces completions and each new request once', () => {
  const f = setup()
  f.publish([['one', { running: true, pendingInteraction: { key: 'approval:1', kind: 'approval' } }]])
  f.publish([['one', { running: true, pendingInteraction: { key: 'approval:1', kind: 'approval' } }]])
  expect(f.bridge.show).not.toHaveBeenCalled()
  f.publish([['one', { running: true, pendingInteraction: { key: 'approval:2', kind: 'approval', reason: 'Run npm install' } }]])
  f.publish([['one', { running: true, pendingInteraction: { key: 'q:3', kind: 'question', questions: [{ question: 'Which branch?' }] } }]])
  f.publish([['one', { running: true, pendingInteraction: { key: 'plan:4', kind: 'plan-review' } }]])
  f.publish([['one', { running: true }]])
  f.publish([['one', { running: false }]])
  expect(f.bridge.show.mock.calls.map(([notification]) => notification)).toEqual([
    { id: 'session:one', key: 'pending:approval:2', title: 'Needs your confirmation', body: 'Run npm install' },
    { id: 'session:one', key: 'pending:q:3', title: 'Needs your reply', body: 'Which branch?' },
    { id: 'session:one', key: 'pending:plan:4', title: 'Plan awaiting confirmation', body: 'Review the plan to continue' },
    { id: 'session:one', key: 'completed:one', title: 'Task completed', body: 'Task: Fix the build' },
  ])
})

it('leaves subagents and scheduled runs to their owners, honours the switch, and opens the clicked Session', () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null })
  const f = setup()
  f.publish([['one', { running: true }], ['child', { running: true }], ['automation-run', { running: true }]])
  f.publish([['one', { running: true }], ['child', { running: false }], ['automation-run', { running: false }]])
  expect(f.bridge.show).not.toHaveBeenCalled()
  storage.set('tpcowork-notification-enabled', 'false')
  f.publish([['one', { running: false }]])
  expect(f.bridge.show).not.toHaveBeenCalled()
  f.click('automation:run'); expect(f.uiWorkspace.openSession).not.toHaveBeenCalled()
  f.click('session:one'); expect(f.uiWorkspace.openSession).toHaveBeenCalledWith('one')
  f.stop()
  expect(f.listeners.size).toBe(0)
  f.click('session:one'); expect(f.uiWorkspace.openSession).toHaveBeenCalledOnce()
})
