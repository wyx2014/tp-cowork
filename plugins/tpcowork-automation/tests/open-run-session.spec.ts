/** Exercise result navigation against the production Client Session lifecycle. */
import { Context } from '@deepseek-ai/cordis'
import Registry from '@deepseek-ai/dsh-typert-registry'
import { apply as applyConnection } from '@deepseek-ai/dsh-client-connection/client'
import { apply as applyGateway, inject as gatewayInject } from '@deepseek-ai/dsh-api-gateway/client'
import { RemoteMock, ok } from '@deepseek-ai/dsh-remote-mock'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { ClientSessions } from '../../../../deepseek-harness/packages/api/session-controller/src/client/sessions/service.ts'
import sessionRemote from '../../../../deepseek-harness/packages/api/session-controller/lib/typert.remote-client.js'
import { ev } from '../../../../deepseek-harness/packages/api/session-controller/tests/event-script.client.ts'
import { followScript, history, sessionWorld } from '../../../../deepseek-harness/packages/api/session-controller/tests/remote/session.client.ts'
import { openRunSession, runSessionFailureKey } from '../src/open-run-session.ts'

const id = SessionId('automation-result')
const title = '2026-10-20 - Daily report'
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function harness() {
  const mock = RemoteMock.create().load(sessionWorld)
    .unary('session/list', ok({ items: [{ sessionId: id, updatedAt: 1, running: false, blank: false, agentAvailable: false }] }))
    .stream('session/follow', followScript(history([
      ev.turnStart(SessionSeq(0), 1), ev.user(SessionSeq(1), 'Daily report'),
      ev.assistant(SessionSeq(2), 1, 'Persisted automation result'), ev.turnEnd(SessionSeq(3), 1),
    ])))
  vi.stubGlobal('location', { hostname: '127.0.0.1', search: '' })
  // Generated Remote descriptors encode named wire parameters; RemoteMock scripts use positions.
  const positional = (payload: { args: object }) => ({ args: Object.values(payload.args) })
  vi.stubGlobal('__DSH_TRANSPORT__', { rpc: {
    call: (channel: string, endpoint: string, payload: { args: object }, signal: AbortSignal) => mock.rpc.call(channel, endpoint, positional(payload), signal),
    open: (channel: string, endpoint: string, payload: { args: object }, signal: AbortSignal) => mock.rpc.open(channel, endpoint, positional(payload), signal),
  } })
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Registry)
  await ctx.plugin({ inject: [], apply: applyConnection })
  await ctx.plugin({ inject: gatewayInject, apply: applyGateway })
  await ctx.remote.$mount(sessionRemote)
  const sessions = new ClientSessions(ctx, ctx.remote)
  await sessions.refresh()
  const navigate = vi.fn(() => {
    const reference = sessions.retain(id, { source: 'automationResult' })
    ctx.effect(() => () => reference.release())
  })
  return { mock, sessions, navigate, signal: new AbortController().signal }
}

it.each(['rejected result', 'thrown request'])('opens persisted history when a title update fails: %s', async mode => {
  const h = await harness()
  const failure = { code: 'gateway/internal', message: 'Agent resume is unavailable', details: {} }
  if (mode === 'rejected result') h.mock.remote.session.rename.mockResolvedValue({ ok: false, error: failure })
  else h.mock.remote.session.rename.mockRejectedValue(new Error(failure.message))
  const report = vi.fn()
  await openRunSession(h.sessions, h.navigate, id, title, h.signal, report)
  expect(h.navigate).toHaveBeenCalledWith(id)
  await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1))
  expect(h.sessions.binding(id)?.session.getSnapshot().openState).toBe('open')
  expect(JSON.stringify(h.sessions.binding(id)?.eventSource.getSnapshot().entries)).toContain('Persisted automation result')
})

it('opens the result without waiting for a pending title update', async () => {
  const h = await harness()
  const rename = Promise.withResolvers<Awaited<ReturnType<typeof h.mock.remote.session.rename>>>()
  h.mock.remote.session.rename.mockReturnValue(rename.promise)
  try {
    await openRunSession(h.sessions, h.navigate, id, title, h.signal)
    expect(h.navigate).toHaveBeenCalledWith(id)
    expect(h.mock.remote.session.rename).toHaveBeenCalledTimes(1)
  } finally { rename.resolve(ok({ title, seq: 4 })) }
})

it('opens a known result without depending on another catalog refresh', async () => {
  const h = await harness()
  h.mock.remote.session.list.mockResolvedValue({ ok: false, error: { code: 'gateway/internal', message: 'Catalog unavailable', details: {} } })
  await openRunSession(h.sessions, h.navigate, id, title, h.signal)
  expect(h.navigate).toHaveBeenCalledWith(id)
  expect(h.mock.remote.session.list).toHaveBeenCalledTimes(1)
})

it('refreshes an undiscovered result before retaining its existing history', async () => {
  const h = await harness()
  h.sessions.handleSessionRemoved(id)
  await vi.waitFor(() => expect(h.sessions.list.getSnapshot().byId[id]).toBeUndefined())
  await openRunSession(h.sessions, h.navigate, id, title, h.signal)
  expect(h.navigate).toHaveBeenCalledWith(id)
  expect(h.mock.remote.session.list).toHaveBeenCalledTimes(2)
})

it('opens persisted history when the live Host Session is released during loading', async () => {
  const h = await harness()
  const opening = Promise.withResolvers<ReturnType<typeof history>>()
  h.mock.stream('session/follow', followScript(opening.promise))
  const pending = openRunSession(h.sessions, h.navigate, id, title, h.signal)
  const opened = expect(pending).resolves.toBeUndefined()
  await h.mock.streams.opened('session/follow', 1)
  // The executor disposes its live Agent after persisting the completed run.
  h.sessions.handleSessionRemoved(id)
  opening.resolve(history([
    ev.turnStart(SessionSeq(0), 1), ev.user(SessionSeq(1), 'Daily report'),
    ev.assistant(SessionSeq(2), 1, 'Persisted automation result'), ev.turnEnd(SessionSeq(3), 1),
  ]))
  await opened
  expect(h.navigate).toHaveBeenCalledWith(id)
  expect(h.sessions.binding(id)?.session.getSnapshot()).toMatchObject({ openState: 'open', removed: true })
  expect(JSON.stringify(h.sessions.binding(id)?.eventSource.getSnapshot().entries)).toContain('Persisted automation result')
})

it('does not report a missing conversation when catalog discovery fails', async () => {
  const h = await harness()
  h.sessions.handleSessionRemoved(id)
  await vi.waitFor(() => expect(h.sessions.list.getSnapshot().byId[id]).toBeUndefined())
  h.mock.remote.session.list.mockResolvedValue({ ok: false, error: { code: 'gateway/internal', message: 'Catalog unavailable', details: {} } })
  const failure = await openRunSession(h.sessions, h.navigate, id, title, h.signal).catch(error => error)
  expect(failure).toBeInstanceOf(Error)
  expect(runSessionFailureKey(failure)).toBe('openFailed')
  expect(h.navigate).not.toHaveBeenCalled()
})

it('preserves an actual history failure without navigating or retaining a broken result', async () => {
  const h = await harness()
  const failure = new RemoteError('session/not-found', 'The result was deleted', { sessionId: id })
  h.mock.stream('session/follow', followScript({ ok: false, error: failure }))
  await expect(openRunSession(h.sessions, h.navigate, id, title, h.signal)).rejects.toMatchObject(failure)
  expect(h.navigate).not.toHaveBeenCalled()
  expect(h.mock.remote.session.rename).not.toHaveBeenCalled()
  expect(h.sessions.retainInfo(id).getSnapshot().referenceCount).toBe(0)
})

it('cancels an outstanding history read without navigating or leaking its reference', async () => {
  const h = await harness()
  const opening = Promise.withResolvers<ReturnType<typeof history>>()
  h.mock.stream('session/follow', followScript(opening.promise))
  const controller = new AbortController()
  const pending = openRunSession(h.sessions, h.navigate, id, title, controller.signal)
  const rejected = expect(pending).rejects.toThrow('Cancelled navigation')
  await h.mock.streams.opened('session/follow', 1)
  controller.abort(new Error('Cancelled navigation'))
  await rejected
  opening.resolve(history([]))
  expect(h.navigate).not.toHaveBeenCalled()
  expect(h.sessions.retainInfo(id).getSnapshot().referenceCount).toBe(0)
})
