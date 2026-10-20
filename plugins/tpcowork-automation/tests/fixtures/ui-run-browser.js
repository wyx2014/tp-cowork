/** Browser shell fixture: real Cordis, Client Gateway, slots, locale and host React. */
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import * as Registry from '@deepseek-ai/dsh-typert-registry/client'
import * as Connection from '@deepseek-ai/dsh-client-connection/client'
import * as Gateway from '@deepseek-ai/dsh-api-gateway/client'
import { ClientSessions } from '../../../../../deepseek-harness/packages/api/session-controller/src/client/sessions/service.ts'
import { UiWorkspaceService } from '../../../../../deepseek-harness/packages/client/ui-workspace/src/client/navigation.ts'
import sessionRemote from '../../../../../deepseek-harness/packages/api/session-controller/lib/typert.remote-client.js'
import permissionRemote from '../../../../../deepseek-harness/packages/interaction/permission-presets/lib/typert.remote-client.js'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { primitives } from './ui-primitives.js'
import { flushSync } from 'react-dom'

const params = new URLSearchParams(location.search)
const ctx = new Context()
const intervals = new Set()
const originalSet = window.setInterval.bind(window)
const originalClear = window.clearInterval.bind(window)
window.setInterval = (...args) => { const timer = originalSet(...args); intervals.add(timer); return timer }
window.clearInterval = timer => { intervals.delete(timer); originalClear(timer) }
window.__DSH_TRANSPORT__ = { rpc: {
  call: async (_channel, endpoint, payload, signal) => (await fetch('/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint, args: payload.args }), signal,
  })).json(),
  open: async function* (_channel, endpoint, payload, signal) {
    if (endpoint === 'session/follow' || endpoint === 'automationChanges/watch') {
      const response = await fetch('/stream', { method: 'POST', body: JSON.stringify({ endpoint, args: payload.args }), signal })
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break
          buffer += value
          let newline
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const frame = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1)
            if (frame.error) { const error = new Error(frame.error.message); error.dshRemoteStreamFailure = { kind: 'remote', code: frame.error.code, details: frame.error.details }; throw error }
            yield frame.value
          }
        }
      } finally { await reader.cancel().catch(() => {}) }
      return
    }
    yield { type: 'ready', clientId: 'ui-browser-fixture', host: { home: '/fixture' } }
    await new Promise(resolve => {
      if (signal.aborted) resolve()
      else signal.addEventListener('abort', resolve, { once: true })
    })
  },
} }
await ctx.plugin(Registry)
await ctx.plugin(Connection)
await ctx.plugin(Gateway)
await ctx.remote.$mount(sessionRemote)
await ctx.remote.$mount(permissionRemote)
const sessions = new ClientSessions(ctx, ctx.remote)
await sessions.refresh()
const slots = new SlotRegistry(ctx)
const locale = new LocaleRuntime(ctx); ctx.provide('locale', locale)
locale.setLocale(params.get('locale') ?? 'en')
const projects = await (await fetch('/projects')).json()
const workspaceSnapshot = { items: projects }
ctx.provide('workspaces', { list: { getSnapshot: () => workspaceSnapshot, subscribe: () => () => {} } })
// Only the outer shell is a fixture. Session opening and reference transfer use production controllers.
const conversationRoot = createRoot(document.getElementById('conversation'))
function Transcript({ reference }) {
  const events = React.useSyncExternalStore(reference.binding.eventSource.subscribe.bind(reference.binding.eventSource), reference.binding.eventSource.getSnapshot.bind(reference.binding.eventSource))
  const list = React.useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  return React.createElement('section', { 'aria-label': 'Existing result conversation' },
    React.createElement('h2', null, list.byId[reference.sessionId]?.title ?? reference.sessionId),
    React.createElement('pre', null, events.entries.filter(({ event }) => ['user/message', 'assistant/message', 'assistant/live-chunk'].includes(event.type)).map(({ event }) => JSON.stringify(event.data)).join('\n')))
}
let navigation
ctx.provide('layout', { selectPanel: () => {
  queueMicrotask(() => {
    const reference = navigation.mainReference
    window.openedSession = reference?.sessionId
    conversationRoot.render(reference ? React.createElement(Transcript, { reference, key: reference.sessionId }) : null)
  })
} })
const navSnapshot = { phase: 'pending', items: [], archivedSessionIds: [] }
const navWorkspaces = { list: { getSnapshot: () => navSnapshot, subscribe: () => () => {} } }
navigation = new UiWorkspaceService(ctx, {}, navWorkspaces, sessions, {}, () => {})
slots.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } } }, () => null)
let registration
window.__ModuleLoader__ = { load(value) { registration = value } }
await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '/client.js'; script.onload = resolve; script.onerror = reject; document.head.append(script) })
const required = []
const plugin = registration.factory(name => {
  required.push(name)
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  if (name !== 'react') throw new Error(`Unexpected Client external ${name}`)
  return React
})
const fiber = await ctx.plugin(plugin)
const entry = slots.entries('main').find(entry => entry.options.key === 'schedules')
if (!entry) throw new Error('automation main slot did not activate')
const root = createRoot(document.getElementById('app'))
root.render(React.createElement(entry.component))
window.fixture = {
  required,
  closeConversation: () => { flushSync(() => conversationRoot.render(null)); navigation.clearMain() },
  references: id => sessions.retainInfo(id).getSnapshot(),
  sessionIds: () => sessions.list.getSnapshot().ids,
  slots: () => slots.entries('main').length,
  dispose: async () => {
    root.unmount(); conversationRoot.unmount()
    await fiber.dispose()
    const remaining = { main: slots.entries('main').length, sidebar: slots.entries('sidebar.panellist').length, styles: document.querySelectorAll('style[data-plugin="@tpcowork/dsh-automation"]').length }
    await ctx.fiber.dispose()
    return { ...remaining, intervals: intervals.size }
  },
}
window.ready = true
