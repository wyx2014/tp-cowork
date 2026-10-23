import { afterEach, expect, it, vi } from 'vitest'
import { createNavigation } from '../src/navigation.js'

function source<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    listeners,
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    set(next: T) { value = next; for (const listener of listeners) listener() },
  }
}

const disposers: (() => void)[] = []
afterEach(() => { for (const dispose of disposers.splice(0)) dispose() })
async function settle() { await Promise.resolve() }

function fixture() {
  const rows = Object.fromEntries(['a', 'b', 'c'].map(id => [id, { id, retainedBy: { mainView: id === 'a' ? 1 : 0 } }]))
  const sessions = { list: source({ phase: 'ready', byId: rows }), subagentAddress: () => undefined }
  const workspaces = { list: source({ archivedSessionIds: [] as string[] }) }
  const panelInfo = source({ activePanelId: null as string | null })
  const panels = source(['toolbox', 'schedules'])
  const layout = { panelInfo, selectPanel: (id: string | null) => panelInfo.set({ activePanelId: id }) }
  const uiWorkspace = { openSession: vi.fn((id: string) => {
    // Native navigation retains the destination before releasing the previous main view.
    sessions.list.set({ phase: 'ready', byId: { ...sessions.list.getSnapshot().byId, [id]: { id, retainedBy: { mainView: 1 } } } })
    sessions.list.set({ phase: 'ready', byId: Object.fromEntries(Object.entries(sessions.list.getSnapshot().byId)
      .map(([key, row]) => [key, { ...row, retainedBy: { mainView: key === id ? 1 : 0 } }])) })
    layout.selectPanel(null)
  }) }
  const slots = { entries: () => panels.getSnapshot().map(key => ({ options: { key } })),
    subscribe: (_: string, listener: () => void) => panels.subscribe(listener) }
  const navigation = createNavigation({ layout, sessions, workspaces, uiWorkspace, slots })
  disposers.push(() => navigation.dispose())
  const state = navigation.source.getSnapshot
  const current = () => panelInfo.getSnapshot().activePanelId ?? Object.values(sessions.list.getSnapshot().byId).find(row => row.retainedBy.mainView)?.id
  return { navigation, state, current, layout, sessions, workspaces, panels, uiWorkspace }
}

it('replays session and panel visits once, coalescing retain/release and panel updates', async () => {
  const f = fixture()
  expect(f.state()).toEqual({ canBack: false, canForward: false, error: false })
  f.layout.selectPanel('toolbox'); await settle()
  f.uiWorkspace.openSession('b'); await settle()
  f.layout.selectPanel('schedules'); await settle()
  for (const expected of ['b', 'toolbox', 'a']) {
    f.navigation.move(-1); await settle(); expect(f.current()).toBe(expected)
  }
  expect(f.state()).toMatchObject({ canBack: false, canForward: true })
  for (const expected of ['toolbox', 'b', 'schedules']) {
    f.navigation.move(1); await settle(); expect(f.current()).toBe(expected)
  }
  expect(f.state()).toMatchObject({ canBack: true, canForward: false })
})

it('ignores duplicate visits and clears forward history after a new selection', async () => {
  const f = fixture()
  f.uiWorkspace.openSession('b'); await settle()
  f.uiWorkspace.openSession('b'); await settle()
  f.navigation.move(-1); await settle()
  expect(f.current()).toBe('a')
  expect(f.state().canBack).toBe(false)
  f.uiWorkspace.openSession('c'); await settle()
  expect(f.state().canForward).toBe(false)
  f.navigation.move(-1); await settle()
  expect(f.current()).toBe('a')
})

it.each(['deleted', 'archived', 'unloaded'])('skips a %s target while preserving valid visits', async kind => {
  const f = fixture()
  f.uiWorkspace.openSession('b'); await settle()
  f.layout.selectPanel('toolbox'); await settle()
  f.uiWorkspace.openSession('c'); await settle()
  if (kind === 'deleted') {
    const { b, ...byId } = f.sessions.list.getSnapshot().byId
    f.sessions.list.set({ phase: 'ready', byId })
  } else if (kind === 'archived') f.workspaces.list.set({ archivedSessionIds: ['b'] })
  else f.panels.set(['schedules'])
  await settle()
  f.navigation.move(-1); await settle()
  expect(f.current()).toBe(kind === 'unloaded' ? 'b' : 'toolbox')
  f.navigation.move(-1); await settle()
  expect(f.current()).toBe('a')
  expect(f.state().canBack).toBe(false)
})

it('keeps the cursor on the current page if opening a target fails', async () => {
  const f = fixture()
  f.uiWorkspace.openSession('b'); await settle()
  f.uiWorkspace.openSession.mockImplementationOnce(() => { throw new Error('unavailable') })
  f.navigation.move(-1); await settle()
  expect(f.current()).toBe('b')
  expect(f.state()).toEqual({ canBack: true, canForward: false, error: true })
  f.navigation.move(-1); await settle()
  expect(f.current()).toBe('a')
  expect(f.state().error).toBe(false)
})

it('bounds history to 50 visits and releases subscriptions and queued observations', async () => {
  const f = fixture()
  for (let index = 0; index < 60; index++) {
    f.layout.selectPanel(index % 2 ? 'toolbox' : 'schedules'); await settle()
  }
  let steps = 0
  while (f.state().canBack) { f.navigation.move(-1); await settle(); steps++ }
  expect(steps).toBe(49)
  f.layout.selectPanel(null)
  f.navigation.dispose(); await settle()
  expect([f.sessions.list, f.workspaces.list, f.panels, f.layout.panelInfo].every(store => store.listeners.size === 0)).toBe(true)
  f.navigation.move(-1)
  expect(f.current()).toBe('a')
})
