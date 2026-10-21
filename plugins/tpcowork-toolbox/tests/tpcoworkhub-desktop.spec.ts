import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTpcoworkHubClient, DesktopTpcoworkHub } from '../native/tpcoworkhub-desktop.ts'

const native = vi.hoisted(() => ({ open: vi.fn<(url: string) => Promise<void>>() }))
vi.mock('electron', () => ({ shell: { openExternal: native.open } }))

const websiteToken = 'fixture-website-session'
const user = { id: 'fixture-user', username: 'fixture', name: 'Fixture account' }
const changed = vi.fn()
const owner = { isDestroyed: () => false, isMinimized: () => false, show: vi.fn(), restore: vi.fn(), focus: vi.fn() }
let auth: DesktopTpcoworkHub
let loggedIn: boolean
let invoke: ReturnType<typeof vi.fn<(method: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>>

beforeEach(() => {
  vi.clearAllMocks()
  loggedIn = false
  native.open.mockResolvedValue()
  invoke = vi.fn(async (method, args) => {
    if (method === 'browserAuth') return { loginUrl: 'https://hub.example.com/desktop/authorize', timeoutMs: 1000 }
    if (method === 'acceptBrowserSession') {
      expect(args).toEqual({ request: { token: websiteToken } }); loggedIn = true; return { configured: true }
    }
    if (method === 'logout') { loggedIn = false; return }
    if (method === 'account') {
      return { configured: loggedIn, writable: true, state: loggedIn ? 'signed_in' : 'signed_out', ...(loggedIn ? { user } : {}) }
    }
    throw new Error('unexpected operation')
  })
  auth = new DesktopTpcoworkHub(() => owner as never, invoke, changed)
})
afterEach(async () => { await auth.dispose() })

async function callback() {
  await vi.waitFor(() => { expect(native.open).toHaveBeenCalledOnce() })
  const url = new URL(native.open.mock.calls[0]![0])
  const target = url.searchParams.get('redirect_uri')!
  const state = url.searchParams.get('state')!
  return { url, target, state,
    post: (payload: object, origin = url.origin) => fetch(target, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ state, ...payload }),
    }),
  }
}

it('opens the system browser and publishes only the Host-verified account after website confirmation', async () => {
  const pending = auth.start()
  const browser = await callback()
  expect(browser.url.origin + browser.url.pathname).toBe('https://hub.example.com/desktop/authorize')
  expect(browser.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(new URL(browser.target).hostname).toBe('127.0.0.1')
  expect(native.open.mock.calls[0]![0]).not.toContain(websiteToken)
  expect(changed).toHaveBeenCalledWith({ status: 'signed_out', phase: 'waiting' })
  expect(invoke.mock.calls.some(call => call[0] === 'acceptBrowserSession')).toBe(false)
  const response = await browser.post({ action: 'confirm', token: websiteToken })
  expect(await response.json()).toEqual({ status: 'signed_in' })
  expect(await pending).toEqual({ status: 'signed_in', phase: 'idle', user })
  expect(owner.focus).toHaveBeenCalledOnce()
  expect(JSON.stringify(changed.mock.calls)).not.toContain(websiteToken)
  await expect(browser.post({ action: 'confirm', token: websiteToken })).rejects.toThrow()
  expect(await auth.signOut()).toEqual({ status: 'signed_out', phase: 'idle' })
})

it('accepts the website preflight and rejects foreign origins, wrong state and oversized requests without consuming the attempt', async () => {
  const pending = auth.start()
  const browser = await callback()
  const preflight = await fetch(browser.target, {
    method: 'OPTIONS', headers: { origin: browser.url.origin, 'access-control-request-method': 'POST' },
  })
  expect(preflight.status).toBe(204)
  expect(preflight.headers.get('access-control-allow-origin')).toBe(browser.url.origin)
  expect((await browser.post({ action: 'confirm', token: websiteToken }, 'https://untrusted.example.com')).status).toBe(403)
  expect((await browser.post({ action: 'confirm', token: websiteToken, state: 'another-attempt' })).status).toBe(403)
  expect((await browser.post({ action: 'confirm', token: 'x'.repeat(66000) })).status).toBe(413)
  expect(invoke.mock.calls.some(call => call[0] === 'acceptBrowserSession')).toBe(false)
  expect((await browser.post({ action: 'confirm', token: websiteToken })).status).toBe(200)
  expect((await pending).status).toBe('signed_in')
})

it.each(['desktop', 'website'])('coalesces login clicks and cancels from the %s without accepting a later token', async (source) => {
  const pending = auth.start()
  expect(auth.start()).toBe(pending)
  const browser = await callback()
  if (source === 'desktop') await auth.cancel()
  else expect(await (await browser.post({ action: 'cancel' })).json()).toEqual({ status: 'cancelled' })
  expect(await pending).toEqual({ status: 'signed_out', phase: 'idle' })
  expect(invoke.mock.calls.some(call => call[0] === 'acceptBrowserSession')).toBe(false)
  await expect(browser.post({ action: 'confirm', token: websiteToken })).rejects.toThrow()
})

it('closes the callback listener on timeout', async () => {
  const pending = auth.start()
  const browser = await callback()
  expect(await pending).toMatchObject({ status: 'signed_out', error: 'timeout' })
  await expect(browser.post({ action: 'confirm', token: websiteToken })).rejects.toThrow()
})

it('preserves an existing account when the Host rejects the browser token', async () => {
  loggedIn = true
  const implementation = invoke.getMockImplementation()!
  invoke.mockImplementation(async (method, args, signal) => {
    if (method === 'acceptBrowserSession') throw new Error(websiteToken)
    return implementation(method, args, signal)
  })
  const pending = auth.start()
  const browser = await callback()
  const response = await browser.post({ action: 'confirm', token: websiteToken })
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ status: 'failed' })
  expect(await pending).toEqual({ status: 'signed_in', phase: 'idle', user, error: 'failed' })
  expect(JSON.stringify(changed.mock.calls)).not.toContain(websiteToken)
})

it('waits for a credential commit before completing sign-out and rejects a duplicate callback', async () => {
  let finishCommit: () => void = () => {}
  const committed = new Promise<void>((resolve) => { finishCommit = resolve })
  const implementation = invoke.getMockImplementation()!
  invoke.mockImplementation(async (method, args, signal) => {
    if (method === 'acceptBrowserSession') await committed
    return implementation(method, args, signal)
  })
  const pending = auth.start()
  const browser = await callback()
  const confirmation = browser.post({ action: 'confirm', token: websiteToken })
  await vi.waitFor(() => { expect(invoke.mock.calls.some(call => call[0] === 'acceptBrowserSession')).toBe(true) })
  expect((await browser.post({ action: 'confirm', token: websiteToken })).status).toBe(409)
  const signingOut = auth.signOut()
  expect(invoke.mock.calls.some(call => call[0] === 'logout')).toBe(false)
  finishCommit()
  expect((await confirmation).status).toBe(200)
  expect((await pending).status).toBe('signed_in')
  expect(await signingOut).toEqual({ status: 'signed_out', phase: 'idle' })
  expect(loggedIn).toBe(false)
})

it('reports a system-browser launch failure without storing credentials', async () => {
  native.open.mockRejectedValue(new Error('No system browser'))
  expect(await auth.start()).toMatchObject({ status: 'signed_out', phase: 'idle', error: 'failed' })
  expect(invoke.mock.calls.some(call => call[0] === 'acceptBrowserSession')).toBe(false)
})

it('uses authenticated Host RPC and rejects uncorrelated replies', async () => {
  let invalid = false
  const send = vi.fn(async (_url: string, init: RequestInit) => {
    if (typeof init.body !== 'string') throw new Error('Expected a JSON RPC request')
    const request: unknown = JSON.parse(init.body)
    if (typeof request !== 'object' || request === null || !('rpcId' in request) || typeof request.rpcId !== 'string') {
      throw new Error('Expected an RPC correlation ID')
    }
    return Response.json({ type: 'server-response', rpcId: invalid ? 'other-call' : request.rpcId, result: { ok: true, value: { configured: true } } })
  })
  const call = createTpcoworkHubClient(() => 'http://127.0.0.1:4567', send)
  expect(await call('acceptBrowserSession', { request: { token: websiteToken } })).toEqual({ configured: true })
  expect(send.mock.calls[0]![0]).toBe('http://127.0.0.1:4567/api/toolboxTpcoworkHub/acceptBrowserSession')
  expect(send.mock.calls[0]![1]).toMatchObject({ credentials: 'include', redirect: 'error' })
  invalid = true
  await expect(call('account', {})).rejects.toThrow('failed')
})
