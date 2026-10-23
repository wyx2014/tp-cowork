// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as React from 'react'
import * as ReactDom from 'react-dom'
import * as jsx from 'react/jsx-runtime'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import * as stores from '@deepseek-ai/dsh-client-store'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { ClientRoster, createClientTest, webApp } from '../../../../deepseek-harness/packages/test-support/client-runtime/src/assembly/index.ts'
import * as CordisUI from '../../../../deepseek-harness/packages/extensions/ui-cordis/src/client/index.ts'
import { ViewportInputs, useOperationActive, useResizeWarning } from '../src/viewport.jsx'
import { BrowserSurface, viewportScale } from '../src/pane.jsx'
import { importSummary } from '../src/import-summary.js'
import { ImportPrompt } from '../src/import-prompt.jsx'
import { IMPORT_PROMPT_DEFER_MS, importPromptPending } from '../src/import-preferences.js'
import { en } from '../src/locales.js'

const t = (key: string) => (en as Record<string, string>)[key] ?? key
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

it('commits a viewport size on Enter or blur, rejects out-of-range input and resets on Escape', () => {
  const onChange = vi.fn()
  const view = render(React.createElement(ViewportInputs, { viewport: { width: 1280, height: 720 }, onChange, t }))
  const width = view.getByLabelText('Browser viewport width') as HTMLInputElement
  fireEvent.change(width, { target: { value: '200' } })
  fireEvent.keyDown(width, { key: 'Enter' })
  expect(width.getAttribute('aria-invalid')).toBe('true')
  expect(view.getByRole('alert').textContent).toBe('Enter an integer between 320 and 3840')
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.keyDown(width, { key: 'Escape' })
  expect(width.value).toBe('1280')
  expect(view.queryByRole('alert')).toBeNull()
  fireEvent.change(width, { target: { value: '1024' } })
  fireEvent.keyDown(width, { key: 'Enter' })
  expect(onChange).toHaveBeenLastCalledWith({ width: 1024, height: 720 })
  const height = view.getByLabelText('Browser viewport height')
  fireEvent.change(height, { target: { value: '900' } })
  fireEvent.blur(height)
  expect(onChange).toHaveBeenLastCalledWith({ width: 1280, height: 900 })
})

it('uses the reference resize handles: eight edges, edge directions, 1/10 px keys and clamped sizes', () => {
  const onResize = vi.fn()
  const anchorRef = React.createRef()
  const view = render(React.createElement(BrowserSurface, { anchorRef, responsive: true, viewport: { width: 1280, height: 720 }, zoom: '100',
    onResize, t, warning: false, resized: () => {} }))
  const handles = view.getAllByRole('separator')
  expect(handles).toHaveLength(8)
  const [left, right, , bottom, , , , corner] = handles
  expect(view.container.querySelector('[data-responsive-browser-mode="active"]')).not.toBeNull()
  fireEvent.pointerDown(right, { clientX: 1280, clientY: 100, pointerId: 1, button: 0 })
  fireEvent.pointerMove(right, { clientX: 1380, clientY: 400, pointerId: 1, buttons: 1 })
  expect(view.container.querySelector('.tpcb-resize-preview')!.textContent).toBe('1380 × 720')
  fireEvent.pointerUp(right, { clientX: 1380, clientY: 400, pointerId: 1 })
  expect(onResize).toHaveBeenLastCalledWith({ width: 1380, height: 720 })
  // Dragging the left edge further left widens the centered page.
  fireEvent.pointerDown(left, { clientX: 0, clientY: 0, pointerId: 2, button: 0 })
  fireEvent.pointerUp(left, { clientX: -50, clientY: 0, pointerId: 2 })
  expect(onResize).toHaveBeenLastCalledWith({ width: 1330, height: 720 })
  fireEvent.keyDown(bottom, { key: 'ArrowDown' })
  expect(onResize).toHaveBeenLastCalledWith({ width: 1280, height: 721 })
  fireEvent.keyDown(corner, { key: 'ArrowRight', shiftKey: true })
  expect(onResize).toHaveBeenLastCalledWith({ width: 1290, height: 720 })
  fireEvent.pointerDown(corner, { clientX: 0, clientY: 0, pointerId: 3, button: 0 })
  fireEvent.pointerUp(corner, { clientX: -5000, clientY: -5000, pointerId: 3 })
  expect(onResize).toHaveBeenLastCalledWith({ width: 320, height: 320 })
  // Fit keeps the reference's 16 px canvas padding and never enlarges the page.
  expect(viewportScale({ width: 672, height: 392 }, { width: 1280, height: 720 }, 'fit')).toBe(0.5)
  expect(viewportScale({ width: 4000, height: 4000 }, { width: 1280, height: 720 }, 'fit')).toBe(1)
  expect(viewportScale(null, { width: 1280, height: 720 }, '150')).toBe(1.5)
})

it('keeps the operation indicator for five seconds after the last step, and warns about one resize per cycle', () => {
  vi.useFakeTimers()
  let active = false
  let warn!: () => void
  let warning = false
  function Probe({ state, operating }: { state: unknown; operating: boolean }) {
    active = useOperationActive(state as never, ['tab', 'session'])
    const [visible, resized] = useResizeWarning(operating)
    warn = resized; warning = visible
    return null
  }
  const view = render(React.createElement(Probe, { state: { operations: { session: true }, operationUntil: {} }, operating: true }))
  expect(active).toBe(true)
  view.rerender(React.createElement(Probe, { state: { operations: { session: false }, operationUntil: { session: Date.now() + 5000 } }, operating: true }))
  expect(active).toBe(true)
  act(() => { warn() })
  expect(warning).toBe(true)
  act(() => { vi.advanceTimersByTime(3000) })
  expect(warning).toBe(false)
  act(() => { warn() })
  expect(warning).toBe(false)
  act(() => { vi.advanceTimersByTime(2000) })
  expect(active).toBe(false)
  // A new cycle may warn again.
  view.rerender(React.createElement(Probe, { state: { operations: {}, operationUntil: {} }, operating: false }))
  view.rerender(React.createElement(Probe, { state: { operations: { tab: true }, operationUntil: {} }, operating: true }))
  act(() => { warn() })
  expect(warning).toBe(true)
})

it('summarizes Chrome imports with the reference wording', () => {
  expect(importSummary({ success: true, cookies: { imported: 3, skipped: 0 }, localStorage: { originsImported: 2, entriesImported: 5 } }, t))
    .toBe('Imported 3 cookies and 5 LocalStorage entries from 2 sites.')
  expect(importSummary({ success: true, cookies: { imported: 3, skipped: 4 }, localStorage: { originsImported: 2, entriesImported: 5 } }, t))
    .toBe('Imported 3 cookies and 5 LocalStorage entries from 2 sites; 4 cookies were not imported.')
  expect(importSummary({ success: false, error: 'chrome_profile_locked' }, t)).toMatch(/Chrome profile is in use/)
  expect(importSummary({ success: false, error: 'something_new' }, t)).toBe(en.importUnavailable)
})

const ID = '@tpcowork/dsh-browser'
let plugin: unknown
const modules: Record<string, unknown> = { react: React, 'react-dom': ReactDom, 'react/jsx-runtime': jsx, '@deepseek-ai/dsh-client-store': stores, '@deepseek-ai/dsh-client-ui-primitives': primitives }
;(window as never as { __ModuleLoader__: unknown }).__ModuleLoader__ = { load: (registration: { factory: (require: (name: string) => unknown) => unknown }) => { plugin = registration.factory(name => {
  if (!(name in modules)) throw new Error(`Unexpected client external ${name}`)
  return modules[name]
}) } }
new Function(readFileSync(resolve(import.meta.dirname, '..', process.env.BROWSER_TEST_OUTPUT ?? 'lib', 'client.js'), 'utf8'))()
const assembled = createClientTest({ roster: ClientRoster.of([...webApp.rows, { name: ID, inject: [], immediately: false }]), provide: { [ID]: plugin, '@deepseek-ai/dsh-client-ui-cordis': CordisUI } })

assembled('shows the page favicon or the operating indicator in the tab title, and toggles certificate checking from settings', async ({ start }) => {
  const request = vi.fn(async (op: string) => op === 'snapshot' ? { enabled: true, tabs: [], downloads: [], permissions: {}, requests: [], security: { allowInsecureCertificates: false } } : {})
  vi.stubGlobal('dshDesktop', { browserAutomation: { subscribe: () => () => {}, request } })
  const c = await start()
  const props = { t: c.ctx.locale.bind('tpcoworkBrowser'), useStore: (select: (value: unknown) => unknown) => select({ byTab: {} }),
    useTabInfo: () => ({ tab: { id: 'ui', navigation: { params: { nativeId: 'native' } } } }) }
  const title = c.ctx.slots.entries('sidebar.right.pane.tab.title').find(row => row.options.key === ID)!
  const page = { id: 'native', sessionId: 'one', title: 'Example', favicon: 'https://example.com/favicon.ico' }
  const browser = (state: object) => (select: (value: unknown) => unknown) => select({ tabs: [page], bindings: {}, operations: {}, operationUntil: {}, ...state })
  const idle = render(React.createElement(title.component, { ...props, useBrowser: browser({}) }))
  const icon = idle.container.querySelector('img')!
  expect(icon.getAttribute('src')).toBe(page.favicon)
  expect(icon.getAttribute('referrerpolicy')).toBe('no-referrer')
  fireEvent.error(icon)
  expect(idle.container.querySelector('img')).toBeNull()
  expect(idle.container.textContent).toContain('Example')
  idle.unmount()
  const busy = render(React.createElement(title.component, { ...props, useBrowser: browser({ operations: { one: true } }) }))
  expect(busy.getByRole('img', { name: 'Assistant is browsing' })).toBeTruthy()
  busy.unmount()

  const settings = c.ctx.slots.entries('settings.section').find(row => row.options.id === ID)!
  const injected = { request, useBrowser: (select: (value: unknown) => unknown) => select({ enabled: true, permissions: {}, downloads: [], security: { allowInsecureCertificates: false } }) }
  const section = render(React.createElement(settings.component, { ...props, ...injected }))
  fireEvent.click(section.getByRole('switch', { name: 'Ignore certificate errors' }))
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith('security', { allowInsecureCertificates: true }))
  section.unmount()
  // Chromium keeps earlier certificate decisions for the process, so a saved change waits for a restart.
  const pending = render(React.createElement(settings.component, { ...props, ...injected,
    useBrowser: (select: (value: unknown) => unknown) => select({ enabled: true, permissions: {}, downloads: [], security: { allowInsecureCertificates: true, restartRequired: true } }) }))
  expect(pending.getByText('Certificate setting saved. Restart the app to take effect.')).toBeTruthy()
}, 60000)

it('defers the Chrome import for five days on Not now or Escape, and remembers a permanent decline', async () => {
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now)
  expect(importPromptPending(undefined)).toBe(true)
  expect(importPromptPending({ choice: 'dismissed' })).toBe(false)
  expect(importPromptPending({ choice: 'imported' })).toBe(false)

  // The prompt covers its pane, and stays hidden while the pane has no size.
  const pane = document.createElement('div')
  pane.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} })
  const anchor = { current: pane }
  const onDecide = vi.fn()
  const failing = render(React.createElement(ImportPrompt, { anchor, t, onDecide, onImport: async () => ({ success: false, error: 'chrome_profile_locked' }) }))
  const dialog = failing.getByRole('dialog', { name: 'Stay signed in to your sites' })
  expect(dialog.textContent).toContain('Passwords are never imported.')
  fireEvent.click(failing.getByRole('button', { name: 'Import cookies' }))
  expect((await failing.findByRole('alert')).textContent).toMatch(/Chrome profile is in use/)
  fireEvent.click(failing.getByRole('button', { name: 'Not now' }))
  expect(onDecide).toHaveBeenLastCalledWith({ deferredUntil: now + IMPORT_PROMPT_DEFER_MS })
  fireEvent.keyDown(failing.getByRole('button', { name: 'Try again' }), { key: 'Escape' })
  expect(onDecide).toHaveBeenLastCalledWith({ deferredUntil: now + IMPORT_PROMPT_DEFER_MS })
  fireEvent.click(failing.getByRole('button', { name: "Don't show again" }))
  expect(onDecide).toHaveBeenLastCalledWith({ choice: 'dismissed' })
  failing.unmount()

  const onImport = vi.fn(async () => ({ success: true, cookies: { imported: 3, skipped: 0 }, localStorage: { originsImported: 2, entriesImported: 5 } }))
  const passing = render(React.createElement(ImportPrompt, { anchor, t, onDecide, onImport }))
  fireEvent.click(passing.getByRole('button', { name: 'Import cookies' }))
  expect((await passing.findByRole('status')).textContent).toBe('Imported 3 cookies and 5 LocalStorage entries from 2 sites.')
  expect(passing.queryByRole('button', { name: 'Not now' })).toBeNull()
  fireEvent.click(passing.getByRole('button', { name: 'Done' }))
  expect(onDecide).toHaveBeenLastCalledWith({ choice: 'imported' })
  expect(onImport).toHaveBeenCalledOnce()
})

assembled('shares the import decision across browser panes, conversations and plugin restarts', async ({ start }) => {
  const request = vi.fn(async (op: string) => op === 'snapshot'
    ? { enabled: true, tabs: [], downloads: [], permissions: {}, requests: [] }
    : { success: true })
  vi.stubGlobal('dshDesktop', { browserAutomation: { subscribe: () => () => {}, request } })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} })
  const c = await start()
  const pane = () => c.ctx.slots.entries('sidebar.right.pane.tab').find(row => row.options.key === ID)!
  const mountPane = (sessionId: string, tabId: string) => {
    const entry = pane()
    const injected = entry.inject!({} as never) as any
    const scoped = (entry.store as ReturnType<typeof stores.defineStore>).create(sessionId)
    const tab = { id: tabId, visible: true, navigation: {}, actions: { bindCommands: () => () => {} } }
    return render(React.createElement(entry.component, {
      ...injected, sessionId, t, useTabInfo: () => ({ tab }),
      useStore: (select: any) => select(React.useSyncExternalStore(scoped.subscribe, scoped.getSnapshot)), actions: scoped.actions,
      useBrowser: (select: any) => select({ enabled: true, tabs: [], bindings: {}, operations: {}, operationUntil: {} }),
      useImportPrompt: (select: any) => select(React.useSyncExternalStore(injected.hooks.importPrompt.subscribe, injected.hooks.importPrompt.getSnapshot)),
      mount: async () => () => {}, unmount: () => {},
    }))
  }
  const first = mountPane('first-conversation', 'first-tab')
  fireEvent.click(await first.findByRole('button', { name: "Don't show again" }))
  expect(first.queryByRole('dialog', { hidden: true })).toBeNull()
  first.unmount()
  for (const [sessionId, tabId] of [['first-conversation', 'new-tab'], ['second-conversation', 'other-tab']]) {
    const next = mountPane(sessionId, tabId)
    expect(next.queryByRole('dialog', { hidden: true })).toBeNull()
    next.unmount()
  }
  await c.reload(ID)
  const restarted = mountPane('third-conversation', 'restarted-tab')
  expect(restarted.queryByRole('dialog', { hidden: true })).toBeNull()
  restarted.unmount()

  // Manual import in Settings also suppresses future offers, even before closing its result card.
  const injected = pane().inject!({} as never) as any
  act(() => injected.decideImportPrompt({}))
  await injected.request('importChrome')
  await c.reload(ID)
  const imported = mountPane('fourth-conversation', 'imported-tab')
  expect(imported.queryByRole('dialog', { hidden: true })).toBeNull()
}, 60000)
