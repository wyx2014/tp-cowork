/**
 * Signed-in API relay for skills. A skill's script calls `$DSH_TPCOWORK_API_URL/<api>/<path>` with the
 * `X-TPCowork-Key: $DSH_TPCOWORK_API_KEY` header; the relay checks the key, maps `<api>` to a configured internal API,
 * adds the user's TP Cowork Hub login as `Authorization: Bearer <token>`, forwards the request, and returns the API's
 * response unchanged. The token stays in the Host: scripts, the model and logs only ever see the per-run key, which
 * works on this machine's loopback address only. The API checks the Bearer token with the Hub to know who is asking.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'

/** Header carrying the per-run relay key; it is removed before forwarding. */
export const RELAY_KEY_HEADER = 'x-tpcowork-key'
/** Set on responses the relay writes itself, so a script can tell them from the API's own. */
export const RELAY_ERROR_HEADER = 'x-tpcowork-relay-error'
/** The Hub itself is always available under this name, for example `/hub/tpcoworkapi/convex/query` for `users:me`. */
export const HUB_API = 'hub'

export type RelayErrorCode = 'bad-key' | 'unknown-api' | 'bad-path' | 'login-required' | 'login-expired' | 'not-configured' | 'too-large' | 'upstream-unreachable'

const MESSAGES: Record<RelayErrorCode, string> = {
  'bad-key': 'TP Cowork relay key is missing or wrong; use $DSH_TPCOWORK_API_KEY.',
  'unknown-api': 'This API is not in the TP Cowork allowlist (toolbox config tpcoworkhub.apis).',
  'bad-path': 'The request path leaves the API\'s base address.',
  'login-required': '请先在 TP Cowork 中点击「连接使用」登录。',
  'login-expired': 'TP Cowork 登录已过期，请重新「连接使用」。',
  'not-configured': 'TP Cowork Hub is not configured.',
  'too-large': 'The request or response is larger than the relay allows.',
  'upstream-unreachable': 'The API could not be reached or timed out.',
}
const STATUS: Record<RelayErrorCode, number> = {
  'bad-key': 403, 'unknown-api': 404, 'bad-path': 400, 'login-required': 401, 'login-expired': 401,
  'not-configured': 503, 'too-large': 413, 'upstream-unreachable': 502,
}

/** Thrown by `token()` when the user cannot be authenticated. */
export class RelayAuthError extends Error {
  constructor(readonly code: 'login-required' | 'login-expired' | 'not-configured') { super(code) }
}

/** Hop-by-hop and identity headers are never passed through in either direction. */
const DROPPED = new Set(['host', 'connection', 'keep-alive', 'proxy-authorization', 'proxy-authenticate', 'proxy-connection', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'content-length', 'authorization', 'cookie', RELAY_KEY_HEADER])
/** fetch decodes compressed bodies, so the API's encoding and length no longer describe what the relay sends. */
const DROPPED_RESPONSE = new Set([...DROPPED, 'content-encoding', 'set-cookie'])

export interface RelayOptions {
  /** API name → base URL; `hub` is added by the caller from the Hub endpoint. */
  apis(): ReadonlyMap<string, string>
  /** The signed-in user's token, or a {@link RelayAuthError}. */
  token(): Promise<string>
  /** The Hub said 401 for this token: the login is no longer valid. */
  unauthorized(api: string, token: string): Promise<void> | void
  timeoutMs: number
  maxBytes: number
}

/** Validate configured API base URLs: plain HTTP(S) with no credentials, query or fragment. */
export function apiBase(url: string): string {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`relay API base must be an HTTP(S) URL without credentials, query or fragment: ${url}`)
  }
  return parsed.href.replace(/\/+$/u, '')
}

/** Where `/<api>/<rest>?<query>` goes, or why it may not. */
export function relayTarget(rawUrl: string, apis: ReadonlyMap<string, string>): { api: string; url: string } | RelayErrorCode {
  const url = new URL(rawUrl, 'http://relay.invalid')
  const [, api = '', ...rest] = url.pathname.split('/')
  const base = apis.get(decodeURIComponent(api))
  if (!api || base === undefined) return 'unknown-api'
  const target = new URL(`${base}/${rest.join('/')}${url.search}`)
  // Dot segments are resolved by URL; the result must stay under the API's own base path and origin.
  if (target.origin !== new URL(base).origin || !(target.href === base || target.href.startsWith(base + '/') || target.href.startsWith(base + '?'))) return 'bad-path'
  return { api: decodeURIComponent(api), url: target.href }
}

function fail(response: ServerResponse, code: RelayErrorCode): void {
  if (response.headersSent) { response.destroy(); return }
  response.writeHead(STATUS[code], { 'content-type': 'application/json; charset=utf-8', [RELAY_ERROR_HEADER]: code })
  response.end(JSON.stringify({ error: `tpcowork-${code}`, message: MESSAGES[code] }))
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer | 'too-large'> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > maxBytes) return 'too-large'
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

/**
 * Start the relay on this machine's loopback address.
 * @returns its base URL, its per-run key, and `close()`.
 */
export async function startRelay(options: RelayOptions): Promise<{ url: string; key: string; close(): Promise<void> }> {
  const key = randomBytes(32).toString('hex')
  const expected = Buffer.from(key)
  const server: Server = createServer((request, response) => { void handle(request, response) })
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const given = Buffer.from(String(request.headers[RELAY_KEY_HEADER] ?? ''))
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) { fail(response, 'bad-key'); return }
      const target = relayTarget(request.url ?? '/', options.apis())
      if (typeof target === 'string') { fail(response, target); return }
      let token: string
      try { token = await options.token() }
      catch (error) { fail(response, error instanceof RelayAuthError ? error.code : 'login-required'); return }
      const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readBody(request, options.maxBytes)
      if (body === 'too-large') { fail(response, 'too-large'); return }
      const headers = new Headers()
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined || DROPPED.has(name)) continue
        headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      headers.set('authorization', `Bearer ${token}`)
      let upstream: Response
      try {
        // Redirects are returned to the script, never followed with the user's login attached.
        upstream = await fetch(target.url, { method: request.method ?? 'GET', headers, ...(body?.length ? { body: new Uint8Array(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs) })
      } catch { fail(response, 'upstream-unreachable'); return }
      if (upstream.status === 401 && target.api === HUB_API) await options.unauthorized(target.api, token)
      const payload = Buffer.from(await upstream.arrayBuffer())
      if (payload.length > options.maxBytes) { fail(response, 'too-large'); return }
      const out: Record<string, string> = {}
      upstream.headers.forEach((value, name) => { if (!DROPPED_RESPONSE.has(name)) out[name] = value })
      response.writeHead(upstream.status, out)
      response.end(payload)
    } catch {
      fail(response, 'upstream-unreachable')
    }
  }
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${String(port)}`,
    key,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }),
  }
}
