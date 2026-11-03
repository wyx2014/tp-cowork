import { createServer, type IncomingMessage, type Server } from 'node:http'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { RelayAuthError, relayTarget, startRelay } from '../src/host/tpcoworkhub/relay.ts'
import { bundledPythonPath } from '../src/runtime-paths.ts'

const closers: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })

/** A stand-in internal API: it identifies the caller from the Bearer token, as a real one asks the Hub. */
async function fakeApi() {
  const seen: { method: string; url: string; headers: IncomingMessage['headers']; body: string }[] = []
  const users: Record<string, { _id: string; username: string; name: string }> = { 'token-zhangsan': { _id: 'u1', username: 'zhangsan', name: '张三' } }
  const server: Server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      seen.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body })
      const user = users[String(request.headers.authorization ?? '').replace(/^Bearer /u, '')]
      if (request.url === '/api/redirect') { response.writeHead(302, { location: 'https://elsewhere.example/steal' }); response.end(); return }
      if (!user) { response.writeHead(401, { 'content-type': 'application/json' }); response.end('{"error":"unauthorized"}'); return }
      response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'session=api' })
      response.end(JSON.stringify(request.url?.startsWith('/hub/tpcoworkapi/convex/query') ? user : { caller: user.username, path: request.url, body }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  closers.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))
  return { base: `http://127.0.0.1:${String((server.address() as { port: number }).port)}`, seen }
}

async function relay(base: string, token: () => Promise<string>, unauthorized: (api: string, token: string) => void = () => {}) {
  const started = await startRelay({
    apis: () => new Map([['crm', `${base}/api`], ['hub', `${base}/hub`]]),
    token, unauthorized, timeoutMs: 5000, maxBytes: 1024 * 1024,
  })
  closers.push(started.close)
  return started
}

describe('skill API relay', () => {
  it('forwards to the allowlisted API with the signed-in user\'s login, so the API knows who is calling', async () => {
    const api = await fakeApi()
    const { url, key } = await relay(api.base, async () => 'token-zhangsan')
    const response = await fetch(`${url}/crm/customers?mine=1`, { headers: { 'x-tpcowork-key': key, cookie: 'local=1', 'x-trace': 't1' } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ caller: 'zhangsan', path: '/api/customers?mine=1', body: '' })
    expect(response.headers.get('set-cookie')).toBeNull()
    const [request] = api.seen
    expect(request!.headers.authorization).toBe('Bearer token-zhangsan')
    // The relay key and the script's cookies never reach the API; ordinary headers do.
    expect(request!.headers['x-tpcowork-key']).toBeUndefined()
    expect(request!.headers.cookie).toBeUndefined()
    expect(request!.headers['x-trace']).toBe('t1')

    const posted = await fetch(`${url}/crm/orders`, { method: 'POST', headers: { 'x-tpcowork-key': key, 'content-type': 'application/json' }, body: '{"sku":"A1"}' })
    expect(await posted.json()).toEqual({ caller: 'zhangsan', path: '/api/orders', body: '{"sku":"A1"}' })
  })

  it('refuses a wrong key, an API outside the allowlist, and paths that leave the API', async () => {
    const api = await fakeApi()
    const { url, key } = await relay(api.base, async () => 'token-zhangsan')
    const bad = await fetch(`${url}/crm/customers`, { headers: { 'x-tpcowork-key': 'nope' } })
    expect([bad.status, bad.headers.get('x-tpcowork-relay-error')]).toEqual([403, 'bad-key'])
    const unknown = await fetch(`${url}/payroll/all`, { headers: { 'x-tpcowork-key': key } })
    expect([unknown.status, unknown.headers.get('x-tpcowork-relay-error')]).toEqual([404, 'unknown-api'])
    // Encoded dot segments are resolved first, so the request falls outside every API and is refused.
    expect(relayTarget('/crm/%2e%2e/%2e%2e/admin', new Map([['crm', 'https://crm.intra/api']]))).toBe('unknown-api')
    expect(relayTarget('/crm/../hub/x', new Map([['crm', 'https://crm.intra/api']]))).toBe('unknown-api')
    expect(relayTarget('/crm/v1/x?y=1', new Map([['crm', 'https://crm.intra/api']]))).toEqual({ api: 'crm', url: 'https://crm.intra/api/v1/x?y=1' })
    expect(api.seen).toEqual([])
  })

  it('tells the script to sign in, and never follows a redirect with the login attached', async () => {
    const api = await fakeApi()
    const signedOut = await relay(api.base, async () => { throw new RelayAuthError('login-required') })
    const response = await fetch(`${signedOut.url}/crm/customers`, { headers: { 'x-tpcowork-key': signedOut.key } })
    expect([response.status, response.headers.get('x-tpcowork-relay-error')]).toEqual([401, 'login-required'])
    expect((await response.json()).message).toContain('连接使用')

    const signedIn = await relay(api.base, async () => 'token-zhangsan')
    const redirect = await fetch(`${signedIn.url}/crm/redirect`, { headers: { 'x-tpcowork-key': signedIn.key }, redirect: 'manual' })
    expect([redirect.status, redirect.headers.get('location')]).toEqual([302, 'https://elsewhere.example/steal'])
    expect(api.seen.filter(request => request.url.includes('steal'))).toEqual([])
  })

  it('marks the login expired when the Hub rejects it, and passes other APIs\' own errors through', async () => {
    const api = await fakeApi()
    const expired: string[] = []
    const { url, key } = await relay(api.base, async () => 'token-revoked', (name, token) => { expired.push(`${name}:${token}`) })
    const hub = await fetch(`${url}/hub/tpcoworkapi/convex/query`, { method: 'POST', headers: { 'x-tpcowork-key': key }, body: '{}' })
    expect([hub.status, hub.headers.get('x-tpcowork-relay-error')]).toEqual([401, null])
    const crm = await fetch(`${url}/crm/customers`, { headers: { 'x-tpcowork-key': key } })
    expect(crm.status).toBe(401)
    expect(expired).toEqual(['hub:token-revoked'])
  })

  it('runs the bundled demo skill: whoami.py prints the signed-in user through the relay', async () => {
    const python = bundledPythonPath(process.platform, new URL('../src/runtime-paths.ts', import.meta.url).href)
    if (!existsSync(python)) return
    const api = await fakeApi()
    const script = fileURLToPath(new URL('../resources/skills/tpcowork-api-auth/scripts/whoami.py', import.meta.url))
    const run = async (token: () => Promise<string>) => {
      const { url, key } = await relay(api.base, token)
      try {
        const { stdout } = await promisify(execFile)(python, [script], { env: { ...process.env, DSH_TPCOWORK_API_URL: url, DSH_TPCOWORK_API_KEY: key } })
        return JSON.parse(stdout)
      } catch (error) { return JSON.parse((error as { stdout: string }).stdout) }
    }
    expect(await run(async () => 'token-zhangsan')).toEqual({ signedIn: true, id: 'u1', username: 'zhangsan', name: '张三' })
    expect(await run(async () => { throw new RelayAuthError('login-expired') })).toMatchObject({ signedIn: false })
    // The script never had the token in its environment or output.
    expect(JSON.stringify(api.seen.map(request => request.headers['x-tpcowork-key']))).not.toContain('token-zhangsan')
  })
})
