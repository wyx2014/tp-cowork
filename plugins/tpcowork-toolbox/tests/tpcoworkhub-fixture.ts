import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { skillsFixture } from './skills-fixture.ts'
import * as hub from '../src/host/tpcoworkhub/index.ts'
import { fingerprint, sha256, type SkillFile } from '../src/host/installer/files.ts'

export const secret = 'fixture-session-credential-not-real'
export const password = 'fixture-password-not-real'
export function sampleFiles(body = 'Use [helper](scripts/helper.py) and [template](assets/template.bin).'): SkillFile[] {
  return [
    ['SKILL.md', Buffer.from(`---\nname: hub-sample\ndescription: A shared skill\n---\n${body}\n`)],
    ['scripts/helper.py', Buffer.from('print("hello")\n')], ['assets/template.bin', Buffer.from([0, 255, 10, 128, 200])],
  ].map(([path, bytes]) => ({ path: path as string, bytes: bytes as Buffer, sha256: sha256(bytes as Buffer) }))
}
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
export async function hubFixture(config: Partial<hub.Config> = {}) {
  const base = await skillsFixture()
  const requests: { path: string; body: unknown; authorization?: string }[] = []
  const state = {
    files: sampleFiles(), versionId: 'version-1', expired: false, corrupt: false, badMetadata: false, missingResource: false,
    publishMode: 'ok' as 'ok' | 'rejected' | 'invalid' | 'disconnect' | 'business-failed',
    hold: undefined as undefined | ReturnType<typeof deferred>, entered: deferred(),
    uploaded: [] as { path: string; bytes: Uint8Array }[], loginHash: '', cursorRequests: 0,
    override: undefined as undefined | ((req: IncomingMessage, res: ServerResponse) => boolean),
  }
  const json = (res: ServerResponse, data: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)) }
  const envelope = (res: ServerResponse, data: unknown) => json(res, { code: 200, message: 'ok', data })
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const bytes = Buffer.concat(chunks)
      const path = req.url!
      const body = req.headers['content-type']?.includes('application/json') && bytes.length ? JSON.parse(bytes.toString('utf8')) : undefined
      requests.push({ path, body, ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) })
      if (state.override?.(req, res)) return
      if (path === '/tpcoworkapi/users/login') { state.loginHash = body.passwordHash; envelope(res, { token: secret, user: { id: 'user-1', username: body.username } }); return }
      if (req.headers.authorization !== `Bearer ${secret}` || state.expired) { res.statusCode = 401; json(res, { code: 401, message: secret }); return }
      if (path === '/tpcoworkapi/convex/query') {
        if (body.path === 'users:me') { json(res, { _id: 'user-1', username: 'fixture-user', name: 'Fixture User' }); return }
        const second = !!body.args.paginationOpts
        if (second) state.cursorRequests++
        json(res, { page: [{ skill: { _id: second ? 'other' : 'store-1', slug: second ? 'another' : 'hub-sample', summary: second ? 'Another description' : 'A shared skill', latestVersionId: state.versionId } }], isDone: second, continueCursor: second ? null : 'server-next' }); return
      }
      if (path === '/tpcoworkapi/skills/store-1') {
        const files = state.files.filter(file => !state.missingResource || file.path !== 'scripts/helper.py')
          .map(file => ({ path: file.path, size: file.bytes.byteLength, sha256: file.sha256, contentType: 'application/octet-stream' }))
        if (state.badMetadata) files.push({ ...files[0]!, path: '../escape' })
        envelope(res, { skill: { id: 'store-1', slug: 'hub-sample', description: 'A shared skill' }, latestVersion: { id: state.versionId, version: '1.0.0' }, files }); return
      }
      if (path.startsWith('/tpcoworkapi/skill-versions/files?')) {
        state.entered.resolve()
        if (state.hold) await state.hold.promise
        const file = state.files.find(file => file.path === new URL(path, 'http://fixture').searchParams.get('path'))!
        envelope(res, { path: file.path, size: file.bytes.byteLength, sha256: file.sha256, contentType: 'application/octet-stream', encoding: file.path.endsWith('.bin') ? 'base64' : 'utf8', content: state.corrupt ? 'corrupted' : Buffer.from(file.bytes).toString(file.path.endsWith('.bin') ? 'base64' : 'utf8') }); return
      }
      if (path === '/tpcoworkapi/skills/publish') {
        const form = await new Request('http://fixture', { method: 'POST', headers: { 'content-type': req.headers['content-type']! }, body: bytes }).formData()
        state.uploaded = await Promise.all(form.getAll('files').map(async value => { const file = value as File; return { path: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } }))
        if (state.publishMode === 'disconnect') { req.socket.destroy(); return }
        if (state.publishMode === 'rejected') { res.statusCode = 409; json(res, { message: secret }); return }
        if (state.publishMode === 'invalid') { res.end('not JSON ' + secret); return }
        envelope(res, { status: state.publishMode === 'business-failed' ? 'failed' : 'pending', skillId: 'published-1', versionId: 'published-version', fingerprint: 'opaque-service-fingerprint', fileCount: state.uploaded.length }); return
      }
      res.statusCode = 404; res.end()
    } catch { if (!res.writableEnded) { res.statusCode = 500; res.end() } }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(async () => { state.hold?.resolve(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) })
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const attach = async (ctx: typeof base.ctx) => {
    await ctx.plugin(LocalCredentials, { path: join(base.home, '.test-credentials.yaml'), watch: false })
    await ctx.credentials.set(credentialRef('HUB_PASSWORD'), password)
    const fiber = await ctx.plugin(hub, { endpoint, ...config })
    return { service: ctx.toolboxTpcoworkHub as hub.ToolboxTpcoworkHub, fiber }
  }
  const { service, fiber } = await attach(base.ctx)
  const login = () => service.login({ username: 'fixture-user', passwordRef: 'HUB_PASSWORD' })
  const installRequest = (requestId: string, hash = fingerprint(state.files)) => ({ requestId, source: { kind: 'tpcoworkhub' as const, skillId: 'store-1', versionId: state.versionId, fingerprint: hash }, scope: { kind: 'user' as const }, conflict: 'reject' as const })
  return { ...base, endpoint, state, requests, service, fiber, login, installRequest, attach }
}
