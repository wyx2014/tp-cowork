/** Real Client Gateway/Connection with a tiny shell that can leave the automation page. */
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import * as Registry from '@deepseek-ai/dsh-typert-registry/client'
import * as Connection from '@deepseek-ai/dsh-client-connection/client'
import * as Gateway from '@deepseek-ai/dsh-api-gateway/client'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { primitives } from './ui-primitives.js'

const ctx = new Context(), timers = new Set()
const set = window.setInterval.bind(window), clear = window.clearInterval.bind(window)
window.setInterval = (...args) => { const timer = set(...args); timers.add(timer); return timer }
window.clearInterval = timer => { timers.delete(timer); clear(timer) }
window.nativeEvents = []; window.streamFrames = []; window.warnings = []
const Native = window.Notification
if (Native) window.Notification = new Proxy(Native, { construct(target, args) {
  const notification = Reflect.construct(target, args)
  window.nativeEvents.push({ type: 'constructed', title: args[0], body: args[1].body, tag: args[1].tag })
  notification.addEventListener('show', () => window.nativeEvents.push({ type: 'show', tag: args[1].tag }))
  notification.addEventListener('error', () => window.nativeEvents.push({ type: 'error', tag: args[1].tag }))
  notification.addEventListener('close', () => window.nativeEvents.push({ type: 'close', tag: args[1].tag }))
  notification.addEventListener('click', event => window.nativeEvents.push({ type: 'click', tag: args[1].tag, trusted: event.isTrusted }))
  return notification
} })
window.__DSH_TRANSPORT__ = { rpc: {
  call: async (_channel, endpoint, payload, signal) => (await fetch('/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint, args: payload.args }), signal,
  })).json(),
  open: async function* (_channel, endpoint, payload, signal) {
    if (endpoint === 'automationChanges/watch') {
      try {
        const response = await fetch('/stream', { method: 'POST', body: JSON.stringify({ endpoint, args: payload.args }), signal })
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''
        try {
          for (;;) {
            const { value, done } = await reader.read(); if (done) break
            buffer += value
            let at
            while ((at = buffer.indexOf('\n')) >= 0) {
              const frame = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1)
              if (frame.error) throw new Error(frame.error.message)
              window.streamFrames.push(frame.value)
              yield frame.value
            }
          }
          throw new Error('change carrier ended')
        } catch (error) { throw error }
        finally { await reader.cancel().catch(() => {}) }
      } catch (error) { error.dshRemoteStreamFailure = { kind: 'carrier' }; throw error }
    }
    yield { type: 'ready', clientId: 'sync-client', host: { home: '/fixture' } }
    await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }) })
  },
} }
await ctx.plugin(Registry); await ctx.plugin(Connection); await ctx.plugin(Gateway)
new SlotRegistry(ctx)
const locale = new LocaleRuntime(ctx); ctx.provide('locale', locale); locale.setLocale('en')
const projects = { items: [] }
ctx.provide('workspaces', { list: { getSnapshot: () => projects, subscribe: () => () => {} } })
ctx.provide('sessions', { list: { getSnapshot: () => ({ ids: [], projectionsBySession: {} }), subscribe: () => () => {} } })
ctx.provide('uiWorkspace', { registerSessionGroup: () => () => {}, startSession: () => { throw new Error('unexpected session creation') }, openSession: () => { throw new Error('unexpected conversation navigation') } })
let panel = 'schedules', render
ctx.provide('layout', { selectPanel: id => { panel = id; render() } })
ctx.slots.register({ name: 'root', children: {
  main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' }, 'shell.overlay': { kind: 'list', scope: 'root' },
} }, () => null)
let registration
window.__ModuleLoader__ = { load(value) { registration = value } }
await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '/client.js'; script.onload = resolve; script.onerror = reject; document.head.append(script) })
const plugin = registration.factory(name => {
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  if (name !== 'react') throw new Error(`Unexpected external ${name}`)
  return React
})
const fiber = await ctx.plugin(plugin)
const main = ctx.slots.entries('main').find(entry => entry.options.key === 'schedules')
const overlay = ctx.slots.entries('shell.overlay').find(entry => entry.options.id === 'automation.results')
if (!main || !overlay) throw new Error('automation slots missing')
const root = createRoot(document.getElementById('app'))
render = () => root.render(React.createElement(React.Fragment, null,
  panel === 'schedules' ? React.createElement(main.component) : React.createElement('p', { 'data-other-panel': true }, 'Another page'),
  React.createElement(overlay.component)))
render()
window.fixture = {
  leave: () => { panel = null; render() },
  remote: ctx.remote,
  reconnect: () => ctx.connection.reconnect(),
  snapshot: () => ctx.automation.list(),
  dispose: async () => {
    root.unmount(); await fiber.dispose()
    const result = { main: ctx.slots.entries('main').length, overlay: ctx.slots.entries('shell.overlay').length, intervals: timers.size,
      services: Boolean(ctx.get('automation')), styles: document.querySelectorAll('style[data-plugin="@tpcowork/dsh-automation"]').length }
    await ctx.fiber.dispose(); return result
  },
}
window.ready = true
