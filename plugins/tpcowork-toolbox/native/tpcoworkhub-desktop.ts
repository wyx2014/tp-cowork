/** System-browser authentication with a temporary loopback callback and Host-owned credentials.
 * Built to a standalone ESM payload and installed into the desktop shell's lib/tpcoworkhub/desktop.js;
 * the shell only ever imports this file dynamically through a thin, generic loader (see
 * deepseek-harness/apps/desktop/src/tpcoworkhub-plugin.ts) and never contains TP Cowork Hub logic itself. */
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import { shell, type BrowserWindow } from 'electron'

/** Safe account and authentication progress for the sidebar; mirrors TpcoworkHubAccountState in the shell. */
export interface TpcoworkHubAccountState {
  readonly status: 'signed_out' | 'signed_in' | 'expired' | 'unconfigured' | 'unavailable'
  readonly phase: 'idle' | 'waiting' | 'committing'
  readonly user?: { readonly id: string; readonly username: string; readonly name?: string }
  readonly error?: 'failed' | 'timeout'
}

/** Native dependencies supplied by the desktop shell's loader. */
export interface DesktopTpcoworkHubOptions {
  readonly owner: () => BrowserWindow | undefined
  readonly hostUrl: () => string | undefined
  readonly send: (url: string, init: RequestInit) => Promise<Response>
  readonly changed: (state: TpcoworkHubAccountState) => void
}

type Invoke = (method: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>
type Failure = 'failed' | 'timeout' | 'cancelled'
interface AuthenticationAttempt {
  controller: AbortController
  committing: boolean
}
class AuthenticationError extends Error {
  constructor(readonly code: Failure) { super(code) }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Create an authenticated client of the installed TP Cowork Hub Host service.
 * @param hostUrl - current authenticated local Host URL.
 * @param send - Electron's cookie-preserving HTTP client.
 * @returns the native-only RPC caller, which never returns Host diagnostics.
 */
export function createTpcoworkHubClient(hostUrl: () => string | undefined,
  send: (url: string, init: RequestInit) => Promise<Response>): Invoke {
  return async (method, args, signal) => {
    const host = hostUrl()
    if (host === undefined) throw new AuthenticationError('failed')
    const rpcId = randomUUID()
    const route = `toolboxTpcoworkHub/${method}`
    const response = await send(new URL(`/api/${route}`, host).href, {
      method: 'POST', credentials: 'include', redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: route, payload: { args } }),
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) { await response.body?.cancel(); throw new AuthenticationError('failed') }
    const envelope: unknown = await response.json()
    if (!record(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
      || !record(envelope.result) || envelope.result.ok !== true) throw new AuthenticationError('failed')
    return envelope.result.value
  }
}

/** Own one system-browser authorization attempt and the credential handoff to the Host. */
export class DesktopTpcoworkHub {
  private snapshot: TpcoworkHubAccountState = { status: 'signed_out', phase: 'idle' }
  private pending: Promise<TpcoworkHubAccountState> | undefined
  private attempt: AuthenticationAttempt | undefined
  private signingOut: Promise<TpcoworkHubAccountState> | undefined
  private generation = 0
  private disposed = false

  /** @param owner - primary application window. @param invoke - private Host caller.
   * @param changed - safe state publisher. @param openBrowser - system website opener.
   */
  constructor(private readonly owner: () => BrowserWindow | undefined, private readonly invoke: Invoke,
    private readonly changed: (state: TpcoworkHubAccountState) => void,
    private readonly openBrowser: (url: string) => Promise<void> = url => shell.openExternal(url)) {}

  private publish(state: TpcoworkHubAccountState): TpcoworkHubAccountState {
    this.snapshot = state
    if (!this.disposed) {
      try { this.changed(state) }
      catch (_error) { console.error('TP Cowork Hub account state could not be delivered to the application') }
    }
    return state
  }

  private async read(): Promise<TpcoworkHubAccountState> {
    const value = await this.invoke('account', {})
    if (!record(value) || typeof value.configured !== 'boolean'
      || !['signed_out', 'signed_in', 'expired', 'unconfigured'].includes(String(value.state))) throw new AuthenticationError('failed')
    const status = value.state as 'signed_out' | 'signed_in' | 'expired' | 'unconfigured'
    let user: TpcoworkHubAccountState['user']
    if (status === 'signed_in' && value.user !== undefined) {
      if (!record(value.user) || typeof value.user.id !== 'string' || typeof value.user.username !== 'string'
        || (value.user.name !== undefined && typeof value.user.name !== 'string')) throw new AuthenticationError('failed')
      user = { id: value.user.id, username: value.user.username, ...(value.user.name === undefined ? {} : { name: value.user.name }) }
    }
    return { status, phase: 'idle', ...(user === undefined ? {} : { user }) }
  }

  /** @returns the current Host account, or a visible unavailable state on read failure. */
  async state(): Promise<TpcoworkHubAccountState> {
    if (this.pending !== undefined || this.signingOut !== undefined) return this.snapshot
    const generation = this.generation
    let state: TpcoworkHubAccountState
    try { state = await this.read() }
    catch (_error) { state = { status: 'unavailable', phase: 'idle', error: 'failed' } }
    return generation === this.generation ? this.publish(state) : this.snapshot
  }

  /** @returns the coalesced authentication result after explicit website confirmation. */
  start(): Promise<TpcoworkHubAccountState> {
    if (this.disposed) return Promise.resolve({ status: 'unavailable', phase: 'idle', error: 'failed' })
    if (this.signingOut !== undefined) return this.signingOut
    if (this.pending !== undefined) return this.pending
    this.generation++
    const attempt: AuthenticationAttempt = { controller: new AbortController(), committing: false }
    this.attempt = attempt
    const { error: _previousError, ...previous } = this.snapshot
    this.publish({ ...previous, phase: 'waiting' })
    this.pending = this.authenticate(attempt).finally(() => { this.pending = undefined; this.attempt = undefined })
    return this.pending
  }

  private async authenticate(attempt: AuthenticationAttempt): Promise<TpcoworkHubAccountState> {
    try {
      const options = await this.invoke('browserAuth', {}, attempt.controller.signal)
      attempt.controller.signal.throwIfAborted()
      if (!record(options) || typeof options.loginUrl !== 'string' || typeof options.timeoutMs !== 'number'
        || !Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000) throw new AuthenticationError('failed')
      const login = new URL(options.loginUrl)
      if (login.username || login.password || !(login.protocol === 'https:'
        || (login.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(login.hostname)))) throw new AuthenticationError('failed')
      const state = await this.browserSession(login, options.timeoutMs, attempt)
      try { this.focusOwner() }
      catch (_error) { console.error('TP Cowork Hub signed in, but the application window could not be focused') }
      return this.publish(state)
    } catch (error) {
      const code = attempt.controller.signal.aborted ? 'cancelled' : error instanceof AuthenticationError ? error.code : 'failed'
      let state: TpcoworkHubAccountState
      try { state = await this.read() }
      catch (_readError) { state = { status: 'unavailable', phase: 'idle' } }
      return this.publish({ ...state, ...(code === 'cancelled' ? {} : { error: code }) })
    }
  }

  private focusOwner(): void {
    const owner = this.owner()
    if (owner === undefined || owner.isDestroyed()) return
    if (owner.isMinimized()) owner.restore()
    owner.show(); owner.focus()
  }

  private async browserSession(login: URL, timeoutMs: number, attempt: AuthenticationAttempt): Promise<TpcoworkHubAccountState> {
    const state = randomBytes(32).toString('base64url')
    const server = createServer()
    let deadline: ReturnType<typeof setTimeout> | undefined
    let abort = (): void => {}
    try {
      return await new Promise<TpcoworkHubAccountState>((resolve, reject) => {
        let settled = false
        let accepting = false
        let callbackHost = ''
        const finish = (value: TpcoworkHubAccountState | AuthenticationError): void => {
          if (settled) return
          settled = true
          if (value instanceof AuthenticationError) reject(value)
          else resolve(value)
        }
        const respond = (response: ServerResponse, status: number, result: string, complete?: () => void): void => {
          if (response.destroyed || response.writableEnded) { complete?.(); return }
          if (complete !== undefined) response.once('close', complete)
          response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' })
          response.end(JSON.stringify({ status: result }), complete)
        }
        server.on('request', (request, response) => {
          if (request.headers.host !== callbackHost || request.headers.origin !== login.origin || request.url !== '/callback') {
            respond(response, 403, 'rejected'); return
          }
          response.setHeader('access-control-allow-origin', login.origin)
          response.setHeader('vary', 'Origin')
          if (request.method === 'OPTIONS') {
            response.setHeader('access-control-allow-methods', 'POST')
            response.setHeader('access-control-allow-headers', 'content-type')
            response.setHeader('access-control-allow-private-network', 'true')
            respond(response, 204, 'ready'); return
          }
          if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json') {
            respond(response, 405, 'rejected'); return
          }
          let body = ''
          let bytes = 0
          let oversized = false
          request.setEncoding('utf8')
          request.on('error', () => { respond(response, 400, 'rejected') })
          request.on('data', (chunk: string) => {
            bytes += Buffer.byteLength(chunk)
            if (bytes > 65536) { oversized = true; body = ''; respond(response, 413, 'rejected') }
            else if (!oversized) body += chunk
          })
          request.on('end', () => {
            if (oversized) return
            let payload: unknown
            try { payload = JSON.parse(body) }
            catch (_error) { respond(response, 400, 'rejected'); return }
            body = ''
            if (!record(payload) || payload.state !== state) { respond(response, 403, 'rejected'); return }
            if (settled || accepting) { respond(response, 409, 'expired'); return }
            if (payload.action === 'cancel') {
              respond(response, 200, 'cancelled', () => { finish(new AuthenticationError('cancelled')) }); return
            }
            if (payload.action !== 'confirm' || typeof payload.token !== 'string'
              || payload.token.length === 0 || payload.token.length > 32768) { respond(response, 400, 'rejected'); return }
            accepting = true
            attempt.committing = true
            clearTimeout(deadline)
            this.publish({ ...this.snapshot, phase: 'committing' })
            const token = payload.token
            void (async () => {
              const accepted = await this.invoke('acceptBrowserSession', { request: { token } }, attempt.controller.signal)
              if (!record(accepted) || accepted.configured !== true) throw new AuthenticationError('failed')
              const account = await this.read()
              if (account.status !== 'signed_in') throw new AuthenticationError('failed')
              respond(response, 200, 'signed_in', () => { finish(account) })
            })().catch(() => { respond(response, 400, 'failed', () => { finish(new AuthenticationError('failed')) }) })
          })
        })
        server.on('error', () => { finish(new AuthenticationError('failed')) })
        abort = () => { finish(new AuthenticationError('cancelled')) }
        server.listen(0, '127.0.0.1', () => {
          attempt.controller.signal.addEventListener('abort', abort, { once: true })
          if (attempt.controller.signal.aborted) { abort(); return }
          const address = server.address()
          if (address === null || typeof address === 'string') { finish(new AuthenticationError('failed')); return }
          callbackHost = `127.0.0.1:${address.port}`
          const url = new URL(login)
          url.searchParams.set('redirect_uri', `http://${callbackHost}/callback`)
          url.searchParams.set('state', state)
          deadline = setTimeout(() => { finish(new AuthenticationError('timeout')) }, timeoutMs)
          void this.openBrowser(url.href).catch(() => { finish(new AuthenticationError('failed')) })
        })
      })
    } finally {
      clearTimeout(deadline)
      attempt.controller.signal.removeEventListener('abort', abort)
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  }

  /** @returns after the active login has stopped; an ongoing Host commit is allowed to settle. */
  async cancel(): Promise<TpcoworkHubAccountState> {
    if (this.attempt !== undefined && !this.attempt.committing) this.attempt.controller.abort()
    return await this.pending ?? this.snapshot
  }

  /** @returns after clearing the shared Host session, or a visible failure if deletion fails. */
  signOut(): Promise<TpcoworkHubAccountState> {
    if (this.signingOut !== undefined) return this.signingOut
    this.generation++
    this.signingOut = (async () => {
      await this.cancel()
      this.publish({ ...this.snapshot, phase: 'committing' })
      try { await this.invoke('logout', {}); return this.publish(await this.read()) }
      catch (_error) { return this.publish({ status: 'unavailable', phase: 'idle', error: 'failed' }) }
    })().finally(() => { this.signingOut = undefined })
    return this.signingOut
  }

  /** Stop publishing, cancel pending authentication and await callback listener cleanup. */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.cancel()
    await this.signingOut
  }
}

/** Factory consumed by the desktop shell's generic native-plugin loader. */
export function createDesktopTpcoworkHub(options: DesktopTpcoworkHubOptions): DesktopTpcoworkHub {
  return new DesktopTpcoworkHub(options.owner, createTpcoworkHubClient(options.hostUrl, options.send), options.changed)
}
