import { describe, expect, it } from 'vitest'
import { mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'
import { SessionSkillCatalog } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import { hubFixture, deferred, password, sampleFiles, secret } from './tpcoworkhub-fixture.ts'
import { fingerprint, sha256 } from '../src/host/installer/files.ts'
import { sessionKey } from '../src/host/tpcoworkhub/index.ts'
import { ownerPeer } from '../../../../deepseek-harness/packages/api/gateway/tests/peer.ts'

describe('TpcoworkHub with real HTTP, DSH credentials, Gateway and profile installer', () => {
  it('accepts accessToken/userInfo with a numeric internal user ID and stores only the access token and public profile', async () => {
    const { service, state, login, ctx, requests } = await hubFixture()
    state.override = (request, response) => {
      if (request.url !== '/tpcoworkapi/users/login') return false
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ code: 200, message: 'success', data: {
        sub: 'adminpig', clientId: 'pig', iss: 'https://ispcloud.com', tokenType: 'Bearer', accessToken: secret,
        refreshToken: 'private-refresh-token', aud: ['pig'], license: 'https://ispcloud.com',
        nbf: 1.793758198209E9, iat: 1.793758198209E9, exp: 1.793794198209E9, expiresIn: 36000,
        scope: ['server'], jti: 'fixture-jti', userInfo: { id: 1, username: 'adminpig', name: 'Administrator',
          password: null, authorities: [], accountNonExpired: null, accountNonLocked: null,
          credentialsNonExpired: null, enabled: true, deptId: null, phone: '111****1111', attributes: {} },
      } }))
      return true
    }
    await login()
    expect(await service.account()).toMatchObject({ state: 'signed_in', user: { id: '1', username: 'adminpig', name: 'Administrator' } })
    const record = await ctx.credentials.readRecord(sessionKey)
    expect(record).toMatchObject({ kind: 'grant', payload: { token: secret, user: { id: '1', username: 'adminpig', name: 'Administrator' } } })
    expect(JSON.stringify(record)).not.toContain('private-refresh-token')
    expect(JSON.stringify(record)).not.toContain('111****1111')
    expect((await service.list({})).items).toHaveLength(2)
    expect(requests.at(-1)?.authorization).toBe(`Bearer ${secret}`)
  })
  it('continues to accept legacy token/user responses', async () => {
    const { service, state, login } = await hubFixture()
    state.legacyLogin = true
    await login()
    expect(await service.account()).toMatchObject({ state: 'signed_in', user: { id: 'user-1', username: 'fixture-user' } })
    expect((await service.list({})).items).toHaveLength(2)
  })
  it.each([
    { accessToken: '', userInfo: { id: 1, username: 'admin' } },
    { accessToken: '   ', userInfo: { id: 1, username: 'admin' } },
    { accessToken: secret, tokenType: 'Basic', userInfo: { id: 1, username: 'admin' } },
    { accessToken: secret, userInfo: { username: 'admin' } },
    { accessToken: secret, userInfo: { id: {}, username: 'admin' } },
  ])('rejects malformed new login responses without replacing the saved session (%#)', async data => {
    const { service, state, login, ctx } = await hubFixture()
    await login()
    const previous = await ctx.credentials.readRecord(sessionKey)
    state.override = (request, response) => {
      if (request.url !== '/tpcoworkapi/users/login') return false
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ code: 200, data }))
      return true
    }
    await expect(login()).rejects.toMatchObject({ code: 'tpcoworkhub/protocol' })
    expect(await ctx.credentials.readRecord(sessionKey)).toEqual(previous)
  })
  it('loads website catalog metadata with null optional fields and uses the published version', async () => {
    const { service, state, ctx } = await hubFixture()
    await service.acceptBrowserSession({ token: secret })
    state.override = (request, response) => {
      if (request.url !== '/tpcoworkapi/convex/query') return false
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ hasMore: false, nextCursor: null, page: [
        { skill: { _id: 'published', slug: 'published-skill', displayName: null, description: null, summary: null, version: null, latestVersionId: 'v1', tags: null, visibility: 'public', approvalStatus: 'approved' }, latestVersion: { _id: 'v1', version: '1.0.0' } },
        { skill: { _id: 'pending', slug: 'pending-skill', version: null, latestVersionId: null, visibility: 'public', approvalStatus: 'pending' } },
      ] }))
      return true
    }
    const page = await ctx.typertGateway.invoke({ peer: ownerPeer(ctx),  namespace: 'toolboxTpcoworkHub', method: 'list', args: { request: {} } })
    expect(page).toEqual({ items: [
      { id: 'published', name: 'published-skill', description: '', versionId: 'v1', version: '1.0.0', visibility: 'public', approvalStatus: 'approved' },
      { id: 'pending', name: 'pending-skill', description: '', versionId: '', version: '', visibility: 'public', approvalStatus: 'pending' },
    ] })
    expect(await service.account()).toMatchObject({ state: 'signed_in' })
  })
  it('rejects catalog metadata of the wrong type instead of treating it as an empty value', async () => {
    const { service, login, state } = await hubFixture()
    await login()
    state.override = (request, response) => {
      if (request.url !== '/tpcoworkapi/convex/query') return false
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ page: [{ skill: { _id: 'invalid', version: 42 } }] }))
      return true
    }
    await expect(service.list({})).rejects.toMatchObject({ code: 'tpcoworkhub/protocol' })
  })
  it('retains store metadata, searches tags and display names, and filters unpublished entries before pagination', async () => {
    const { service, login, state, ctx } = await hubFixture({ pageSize: 1 })
    await login()
    state.override = (request, response) => {
      if (request.url !== '/tpcoworkapi/convex/query') return false
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ isDone: true, page: [
        { skill: { id: 'approved', slug: 'research', displayName: 'Industry insights', tags: ' AI, research, AI, ', visibility: 'public', approvalStatus: 'approved' } },
        { skill: { id: 'private', slug: 'private', visibility: 'private', approvalStatus: 'approved' } },
        { skill: { id: 'pending', slug: 'submitted', tags: ['AI'], visibility: 'public', approvalStatus: 'pending' } },
        { skill: { id: 'rejected', slug: 'rejected', approvalStatus: 'rejected' } },
        { skill: { id: 'draft', slug: 'draft', visibility: 'public', approvalStatus: 'draft' } },
      ] }))
      return true
    }
    const page = await ctx.typertGateway.invoke({ peer: ownerPeer(ctx),  namespace: 'toolboxTpcoworkHub', method: 'list', args: { request: { query: 'AI' } } }) as Awaited<ReturnType<typeof service.list>>
    expect(page.items).toEqual([expect.objectContaining({ id: 'approved', displayName: 'Industry insights', tags: ['AI', 'research'], visibility: 'public', approvalStatus: 'approved' })])
    expect((await service.list({ query: 'AI', cursor: page.cursor })).items.map(item => item.id)).toEqual(['pending'])
    expect((await service.list({ query: 'INSIGHTS' })).items.map(item => item.id)).toEqual(['approved'])
    expect((await service.list({ query: 'private' })).items).toEqual([])
    expect((await service.list({ query: 'draft' })).items).toEqual([])
    expect((await service.list({ query: 'rejected' })).items.map(item => item.id)).toEqual(['rejected'])
  })
  it('previews verified SKILL.md through the Gateway without installing or downloading other resources', async () => {
    const { service, login, ctx, state, requests } = await hubFixture()
    await login()
    const result = await ctx.typertGateway.invoke({ peer: ownerPeer(ctx),  namespace: 'toolboxTpcoworkHub', method: 'detail', args: { request: { id: 'store-1', preview: true } } }) as Awaited<ReturnType<typeof service.detail>>
    expect(result.content).toBe(Buffer.from(state.files[0]!.bytes).toString('utf8'))
    expect(requests.filter(row => row.path.startsWith('/tpcoworkapi/skill-versions/files?'))).toHaveLength(1)
    expect((await ctx.toolboxSkills.inventory({})).items).toEqual([])
    state.corrupt = true
    await expect(service.detail({ id: 'store-1', preview: true })).rejects.toMatchObject({ code: 'tpcoworkhub/invalid-package' })
  })
  it('previews skills whose files have no stored content type, which the Hub schema allows', async () => {
    const { service, login, ctx, state } = await hubFixture()
    await login()
    state.nullContentType = true
    const result = await ctx.typertGateway.invoke({ peer: ownerPeer(ctx),  namespace: 'toolboxTpcoworkHub', method: 'detail', args: { request: { id: 'store-1', preview: true } } }) as Awaited<ReturnType<typeof service.detail>>
    expect(result.content).toBe(Buffer.from(state.files[0]!.bytes).toString('utf8'))
    expect(result.files[0]!.contentType).toBe('application/octet-stream')
  })
  it('previews and installs when the Hub serializes file sizes as numeric strings', async () => {
    const { service, login, ctx, state, installRequest, dir } = await hubFixture()
    await login()
    state.stringSizes = true
    const preview = await service.detail({ id: 'store-1', preview: true })
    expect(preview.files[0]!.size).toBe(state.files[0]!.bytes.byteLength)
    expect(preview.content).toBe(Buffer.from(state.files[0]!.bytes).toString('utf8'))
    const result = await ctx.typertGateway.invoke({ peer: ownerPeer(ctx),  namespace: 'toolboxTpcoworkHub', method: 'install', args: { request: installRequest('string-sizes') } }) as Awaited<ReturnType<typeof service.install>>
    expect(result.state).toBe('installed')
    expect(await readFile(join(dir, 'skills/hub-sample/SKILL.md'))).toEqual(Buffer.from(state.files[0]!.bytes))
  })
  it.each(['', '-1', '1.5', 'abc', '99999999999999999'])('rejects the malformed file size %j', async size => {
    const { service, login, state } = await hubFixture()
    await login()
    state.override = (request, response) => {
      if (request.url !== '/tpcoworkapi/skills/store-1') return false
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ code: 200, data: { skill: { id: 'store-1' }, latestVersion: { id: 'v', version: '1.0.0' }, files: [{ path: 'SKILL.md', size, sha256: 'a'.repeat(64), contentType: 'text/plain' }] } }))
      return true
    }
    await expect(service.detail({ id: 'store-1' })).rejects.toMatchObject({ code: 'tpcoworkhub/protocol', details: { field: 'files.0.size' } })
  })
  it('names the rejected field, never its value, when a detail response breaks the protocol', async () => {
    const { service, login, state } = await hubFixture()
    await login()
    state.override = (request, response) => {
      if (request.url !== '/tpcoworkapi/skills/store-1') return false
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ code: 200, data: { skill: { id: 'store-1' }, latestVersion: { id: 'v', version: '1.0.0' }, files: [{ path: 'SKILL.md', size: 1, sha256: secret, contentType: 'text/plain' }] } }))
      return true
    }
    const error = await service.detail({ id: 'store-1' }).catch(value => value)
    expect(error).toMatchObject({ code: 'tpcoworkhub/protocol', details: { field: 'files.0.sha256' } })
    expect(JSON.stringify(error.details)).not.toContain(secret)
  })
  it('allows read-only details for submissions without a version while rejecting them as install packages', async () => {
    const { service, login, state } = await hubFixture()
    await login()
    state.override = (request, response) => {
      if (request.url !== '/tpcoworkapi/skills/pending') return false
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ code: 200, data: { skill: { id: 'pending', slug: 'submitted', approvalStatus: 'pending', visibility: 'public' }, latestVersion: null, files: [] } }))
      return true
    }
    expect(await service.detail({ id: 'pending', preview: true })).toMatchObject({ skill: { approvalStatus: 'pending', versionId: '' }, files: [] })
    await expect(service.detail({ id: 'pending' })).rejects.toMatchObject({ code: 'tpcoworkhub/invalid-package' })
  })
  it('ignores environment overrides of the Hub address', async () => {
    const previous = { ...process.env }
    Object.assign(process.env, { DSH_DESKTOP_DEV_APP: '1', DSH_TPCOWORKHUB_URL: 'http://localhost:8080' })
    try {
      const { service } = await hubFixture({ endpoint: '' })
      expect((await service.browserAuth()).loginUrl).toBe('http://10.17.12.229:20255/desktop/authorize')
    } finally { process.env = previous }
  })
  it('replaces a local Hub address left in an older profile', async () => {
    const { service } = await hubFixture({ endpoint: 'http://localhost:8080' })
    expect((await service.browserAuth()).loginUrl).toBe('http://10.17.12.229:20255/desktop/authorize')
  })
  it('validates the website session, restores the shared desktop account and clears it on sign-out', async () => {
    const { ctx, endpoint, requests, service, start, attach } = await hubFixture()
    expect(await service.browserAuth()).toEqual({ loginUrl: endpoint + '/desktop/authorize', timeoutMs: 300000 })
    await ctx.typertGateway.invoke({ peer: ownerPeer(ctx),  namespace: 'toolboxTpcoworkHub', method: 'acceptBrowserSession', args: { request: { token: secret } } })
    expect(requests.some(request => (request.body as { path?: string })?.path === 'users:me')).toBe(true)
    const account = await service.account()
    expect(account).toMatchObject({ state: 'signed_in', user: { id: 'user-1', username: 'fixture-user', name: 'Fixture User' } })
    expect(JSON.stringify(account)).not.toContain(secret)
    expect((await service.list({})).items).toHaveLength(2)
    await expect(service.acceptBrowserSession({ token: 'invalid-website-token' })).rejects.toMatchObject({ code: 'tpcoworkhub/session-expired' })
    expect(await service.account()).toMatchObject({ state: 'signed_in', user: account.user })
    await ctx.fiber.dispose()
    const restarted = await start()
    const restored = (await attach(restarted)).service
    expect(await restored.account()).toMatchObject({ state: 'signed_in', user: account.user })
    await restored.logout()
    expect(await restored.account()).toMatchObject({ state: 'signed_out' })
    expect(await restarted.credentials.readRecord(sessionKey)).toBeUndefined()
  })
  it('logs in, searches/pages, validates details, installs binary resources and exposes /name and loader inventory', async () => {
    const { ctx, dir, home, service, state, requests, login, installRequest, start, attach } = await hubFixture({ pageSize: 1 })
    expect(await service.account()).toMatchObject({ configured: false, writable: true, state: 'signed_out' })
    await expect(service.list({})).rejects.toMatchObject({ code: 'tpcoworkhub/login-required' })
    expect(await login()).toEqual({ configured: true })
    expect(state.loginHash).toBe(password)
    expect(await service.account()).toMatchObject({ configured: true, state: 'signed_in' })
    const page = await ctx.typertGateway.invoke({ peer: ownerPeer(ctx),  namespace: 'toolboxTpcoworkHub', method: 'list', args: { request: {} } }) as Awaited<ReturnType<typeof service.list>>
    expect(page.items[0]!.name).toBe('hub-sample'); expect(page.cursor).toBeTruthy()
    expect((await service.list({ cursor: page.cursor! })).items[0]!.name).toBe('another')
    expect((await service.list({ query: 'ANOTHER' })).items).toHaveLength(1)
    expect(state.cursorRequests).toBe(2)
    await expect(service.list({ query: 'different', cursor: page.cursor! })).rejects.toMatchObject({ code: 'tpcoworkhub/catalog-expired' })
    const detail = await service.detail({ id: 'store-1' })
    expect(detail.fingerprint).toBe(fingerprint(state.files))
    const request = installRequest('first')
    const result = await ctx.typertGateway.invoke({ peer: ownerPeer(ctx),  namespace: 'toolboxTpcoworkHub', method: 'install', args: { request } }) as Awaited<ReturnType<typeof service.install>>
    expect(result.state).toBe('installed')
    expect(await service.install(request)).toEqual(result)
    expect((await service.install(installRequest('again'))).state).toBe('unchanged')
    expect(await readFile(join(dir, 'skills/hub-sample/assets/template.bin'))).toEqual(Buffer.from([0, 255, 10, 128, 200]))
    expect((await ctx.toolboxSkills.inventory({})).items).toEqual([expect.objectContaining({ id: result.skillId, origin: 'tpcoworkhub', enabled: true, readiness: { state: 'ready', checkedAt: expect.any(Number), reasons: [] } })])
    expect((await ctx.skills.list()).filter(isUserInvocable).map(item => item.name)).toContain('hub-sample')
    expect((await ctx.skills.get('hub-sample'))?.content).toContain('[helper]')
    // Exercise the actual cold-session /name catalog, with an isolated session observation.
    ctx.provide('agents', { get: () => undefined } as never)
    ctx.provide('sessionQuery', { observeSession: async () => ({ projections: { values: { workingDirectory: home } }, header: { cwd: home }, [Symbol.dispose]() {} }) } as never)
    ctx.provide('workingDirectory', { defaultDirectory: home } as never)
    const commandCatalog = new SessionSkillCatalog(ctx)
    expect((await commandCatalog.list({ sessionId: SessionId('cold-session') }, new AbortController().signal)).skills.map(item => item.name)).toContain('hub-sample')
    const restarted = await start()
    const restored = await attach(restarted)
    expect(await restored.service.account()).toMatchObject({ configured: true })
    expect((await restarted.skills.get('hub-sample'))?.resourceBase?.kind).toBe('directory')
    const profile = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(profile).not.toContain(secret); expect(profile).not.toContain(password)
    expect(await readFile(join(home, '.test-credentials.yaml'), 'utf8')).toContain('toolbox-tpcoworkhub/session')
    expect(JSON.stringify([page, detail, result])).not.toContain(secret)
    expect(requests.filter(row => row.path !== '/tpcoworkapi/users/login').every(row => row.authorization === `Bearer ${secret}`)).toBe(true)
  })
  it('marks expired credentials for explicit re-login and clears them on logout', async () => {
    const { service, state, login, ctx } = await hubFixture()
    await login(); state.expired = true
    await expect(service.list({})).rejects.toMatchObject({ code: 'tpcoworkhub/session-expired' })
    expect(await service.account()).toEqual({ configured: false, writable: true, state: 'expired' })
    expect(JSON.stringify(await ctx.credentials.readRecord(sessionKey))).not.toContain(secret)
    state.expired = false; await login()
    expect((await service.list({})).items.length).toBe(2)
    await service.logout()
    expect(await ctx.credentials.readRecord(sessionKey)).toBeUndefined()
    expect(await service.account()).toMatchObject({ state: 'signed_out' })
  })
  it('reports a restored login the Hub has expired as expired instead of signed in', async () => {
    const { ctx, service, state, login, start, attach } = await hubFixture()
    await login()
    expect(await service.account()).toMatchObject({ state: 'signed_in' })
    await ctx.fiber.dispose()
    // Overnight the Hub expires the access token; the restarted app must not keep showing the account.
    state.expired = true
    const restarted = await start()
    const restored = (await attach(restarted)).service
    expect(await restored.account()).toEqual({ configured: false, writable: true, state: 'expired' })
    expect(JSON.stringify(await restarted.credentials.readRecord(sessionKey))).not.toContain(secret)
  })
  it('treats users:me answering null for the token as an expired login, as the deployed Hub does', async () => {
    const { ctx, service, state, login, start, attach } = await hubFixture()
    await login()
    await ctx.fiber.dispose()
    // The Hub's convex/query is public: an expired token reads as anonymous, users:me is null with HTTP 200,
    // and the catalog still answers; only /skills/** and /skill-versions/** return 401.
    state.override = (req, res) => {
      if (req.url !== '/tpcoworkapi/convex/query') return false
      res.setHeader('content-type', 'application/json'); res.end('null'); return true
    }
    const restored = (await attach(await start())).service
    expect(await restored.account()).toEqual({ configured: false, writable: true, state: 'expired' })
    await expect(restored.list({})).rejects.toMatchObject({ code: 'tpcoworkhub/session-expired' })
  })
  it('keeps a restored login while the Hub is unreachable and checks it at most once per interval', async () => {
    const { ctx, service, state, login, start, attach, requests } = await hubFixture()
    await login()
    await ctx.fiber.dispose()
    state.override = (_req, res) => { res.statusCode = 503; res.end(); return true }
    const restarted = await start()
    const restored = (await attach(restarted)).service
    expect(await restored.account()).toMatchObject({ state: 'signed_in' })
    state.override = undefined
    expect(await restored.account()).toMatchObject({ state: 'signed_in' })
    const checks = requests.filter(row => (row.body as { path?: string } | undefined)?.path === 'users:me').length
    expect(await restored.account()).toMatchObject({ state: 'signed_in' })
    expect(requests.filter(row => (row.body as { path?: string } | undefined)?.path === 'users:me')).toHaveLength(checks)
  })
  it('supports explicitly configured SHA-256 login and rejects raw secrets in reference fields', async () => {
    const { login, state, service, requests } = await hubFixture({ passwordEncoding: 'sha256' })
    await login(); expect(state.loginHash).toBe(sha256(password))
    const count = requests.length
    await expect(service.login({ username: 'test', passwordRef: 'literal secret value' })).rejects.toMatchObject({ code: 'tpcoworkhub/invalid-request' })
    expect(requests).toHaveLength(count)
  })
  it('rejects stale versions, traversal, missing assets and corrupted bytes without committing a directory', async () => {
    const { login, service, state, dir, installRequest } = await hubFixture()
    await login()
    const stale = installRequest('stale'); state.versionId = 'version-2'
    expect((await service.install(stale)).error?.code).toBe('skills/tpcoworkhub-package-changed')
    state.badMetadata = true
    await expect(service.detail({ id: 'store-1' })).rejects.toMatchObject({ code: 'tpcoworkhub/invalid-package' })
    state.badMetadata = false; state.corrupt = true
    expect((await service.install(installRequest('corrupt'))).state).toBe('failed')
    state.corrupt = false; state.missingResource = true
    const incomplete = await service.detail({ id: 'store-1' })
    expect((await service.install(installRequest('incomplete', incomplete.fingerprint))).error?.code).toBe('skills/tpcoworkhub-invalid-package')
    await expect(readFile(join(dir, 'skills/hub-sample/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('only replaces its own unchanged tree and preserves user content on conflicts', async () => {
    const { login, service, state, dir, installRequest } = await hubFixture()
    await login()
    await service.install(installRequest('first'))
    state.files = sampleFiles('Updated [helper](scripts/helper.py).'); state.versionId = 'version-2'
    expect((await service.install(installRequest('no-replace'))).error?.code).toBe('skills/name-conflict')
    expect((await service.install({ ...installRequest('replace'), conflict: 'replace-owned' })).state).toBe('installed')
    await writeFile(join(dir, 'skills/hub-sample/scripts/helper.py'), 'user changes')
    expect((await service.install({ ...installRequest('preserve'), conflict: 'replace-owned' })).error?.code).toBe('skills/user-modified')
    expect(await readFile(join(dir, 'skills/hub-sample/scripts/helper.py'), 'utf8')).toBe('user changes')
  })
  it('cancels a download through the Gateway and retries with a new request, then withdraws its resolver on unload', async () => {
    const { login, service, state, ctx, dir, installRequest, fiber, installer } = await hubFixture()
    await login(); state.hold = deferred()
    const controller = new AbortController()
    const pending = ctx.typertGateway.invoke({ peer: ownerPeer(ctx),  namespace: 'toolboxTpcoworkHub', method: 'install', args: { request: installRequest('cancel') }, signal: controller.signal })
    await state.entered.promise
    controller.abort()
    await pending.catch(() => undefined)
    await installer.cancel({ operationId: 'cancel' })
    await expect(readFile(join(dir, 'skills/hub-sample/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    state.hold.resolve(); state.hold = undefined
    expect((await service.install(installRequest('retry'))).state).toBe('installed')
    await fiber.dispose()
    expect((await installer.install(installRequest('after-unload'))).error?.code).toBe('skills/source-unavailable')
    await expect(ctx.typertGateway.invoke({ peer: ownerPeer(ctx),  namespace: 'toolboxTpcoworkHub', method: 'account', args: {} })).rejects.toMatchObject({ code: 'gateway/definition-unavailable' })
  })
  it('times out network operations, refuses redirects and never exposes remote error bodies', async () => {
    const { login, service, state } = await hubFixture({ requestTimeoutMs: 100 })
    await login(); state.hold = deferred()
    const detail = await service.detail({ id: 'store-1' })
    const failed = await service.install({ requestId: 'timeout', source: { kind: 'tpcoworkhub', skillId: 'store-1', versionId: detail.skill.versionId, fingerprint: detail.fingerprint }, scope: { kind: 'user' }, conflict: 'reject' })
    expect(failed.error?.code).toBe('skills/tpcoworkhub-timeout')
    state.hold.resolve(); state.hold = undefined
    state.override = (req, res) => { if (req.url !== '/tpcoworkapi/convex/query') return false; res.statusCode = 302; res.setHeader('Location', 'http://127.0.0.1:1/' + secret); res.end(); return true }
    await expect(service.list({})).rejects.toMatchObject({ code: 'tpcoworkhub/network' })
    state.override = (_req, res) => { res.statusCode = 503; res.end(secret); return true }
    try { await service.list({}); throw new Error('expected failure') } catch (error) { expect(String(error)).not.toContain(secret); expect(error).toMatchObject({ code: 'tpcoworkhub/network' }) }
  })
  it('uploads the complete snapshot only on publish, excludes private files, and replays request IDs without duplicate publication', async () => {
    const { login, service, ctx, dir, installRequest, requests, state } = await hubFixture()
    await login(); const installed = await service.install(installRequest('first'))
    const path = join(dir, 'skills/hub-sample')
    await writeFile(join(path, '.env'), 'API_KEY=private')
    await writeFile(join(path, 'USER.md'), 'private profile')
    await mkdir(join(path, '.git')); await writeFile(join(path, '.git/config'), 'private')
    expect(requests.filter(row => row.path === '/tpcoworkapi/skills/publish')).toHaveLength(0)
    const request = { requestId: 'publish-once', sourceSkillId: installed.skillId!, slug: 'hub-sample', displayName: 'Shared sample', version: '1.0.0' }
    const result = await ctx.typertGateway.invoke({ peer: ownerPeer(ctx),  namespace: 'toolboxTpcoworkHub', method: 'publish', args: { request } })
    expect(result).toMatchObject({ skillId: 'published-1', fileCount: 3 })
    expect(state.uploaded.map(file => file.path).sort()).toEqual(['SKILL.md', 'assets/template.bin', 'scripts/helper.py'])
    expect(state.uploaded.find(file => file.path === 'assets/template.bin')?.bytes).toEqual(new Uint8Array([0, 255, 10, 128, 200]))
    expect(await service.publish(request)).toEqual(result)
    expect(requests.filter(row => row.path === '/tpcoworkapi/skills/publish')).toHaveLength(1)
    await expect(service.publish({ ...request, version: '2.0.0' })).rejects.toMatchObject({ code: 'tpcoworkhub/request-conflict' })
  })
  it('blocks embedded secrets, resource links to excluded personal files, symlinks and unlisted sources before any upload', async () => {
    const { login, service, dir, installRequest, requests } = await hubFixture()
    await login(); const installed = await service.install(installRequest('first'))
    const path = join(dir, 'skills/hub-sample')
    const request = { requestId: 'unsafe', sourceSkillId: installed.skillId!, slug: 'hub-sample', displayName: 'Sample', version: '1.0.0' }
    await writeFile(join(path, 'scripts/helper.py'), 'api_key = "a-real-looking-sensitive-value"')
    await expect(service.publish(request)).rejects.toMatchObject({ code: 'tpcoworkhub/unsafe-upload' })
    await writeFile(join(path, 'scripts/helper.py'), 'print("safe")')
    await symlink('/etc/hosts', join(path, 'assets/link'))
    await expect(service.publish({ ...request, requestId: 'link' })).rejects.toMatchObject({ code: 'tpcoworkhub/unsafe-upload' })
    await unlink(join(path, 'assets/link'))
    await writeFile(join(path, 'SKILL.md'), '---\nname: hub-sample\ndescription: Sample\n---\nRead [profile](USER.md).')
    await writeFile(join(path, 'USER.md'), 'personal profile')
    await expect(service.publish({ ...request, requestId: 'private-dependency' })).rejects.toMatchObject({ code: 'tpcoworkhub/invalid-package' })
    await expect(service.publish({ ...request, requestId: 'unknown', sourceSkillId: 'unknown' })).rejects.toMatchObject({ code: 'tpcoworkhub/source-changed' })
    expect(requests.filter(row => row.path === '/tpcoworkapi/skills/publish')).toHaveLength(0)
  })
  it('reports a rejected or uncertain upload without automatic publication retries', async () => {
    const { login, service, installRequest, requests, state } = await hubFixture()
    await login(); const installed = await service.install(installRequest('first'))
    const request = { requestId: 'rejected', sourceSkillId: installed.skillId!, slug: 'hub-sample', displayName: 'Sample', version: '1.0.0' }
    state.publishMode = 'rejected'
    await expect(service.publish(request)).rejects.toMatchObject({ code: 'tpcoworkhub/publish-rejected' })
    state.publishMode = 'business-failed'
    await expect(service.publish({ ...request, requestId: 'business-failed' })).rejects.toMatchObject({ code: 'tpcoworkhub/publish-rejected' })
    state.publishMode = 'invalid'
    const ambiguous = { ...request, requestId: 'ambiguous' }
    await expect(service.publish(ambiguous)).rejects.toMatchObject({ code: 'tpcoworkhub/publish-uncertain' })
    await expect(service.publish(ambiguous)).rejects.toMatchObject({ code: 'tpcoworkhub/publish-uncertain' })
    expect(requests.filter(row => row.path === '/tpcoworkapi/skills/publish')).toHaveLength(3)
  })
  it('does not log out on publish permission errors, and reports invalid sessions even with read-only credentials', async () => {
    const { login, service, state, installRequest, ctx } = await hubFixture()
    await login(); const installed = await service.install(installRequest('first'))
    state.override = (req, res) => { if (req.url !== '/tpcoworkapi/skills/publish') return false; res.statusCode = 403; res.end(secret); return true }
    await expect(service.publish({ requestId: 'forbidden', sourceSkillId: installed.skillId!, slug: 'hub-sample', displayName: 'Sample', version: '1.0.0' })).rejects.toMatchObject({ code: 'tpcoworkhub/publish-rejected' })
    expect(await service.account()).toMatchObject({ configured: true })
    ctx.credentials.modifyRecord = async () => { throw new Error('read-only') }
    state.expired = true
    await expect(service.list({})).rejects.toMatchObject({ code: 'tpcoworkhub/session-expired' })
    expect(await service.account()).toMatchObject({ configured: false, state: 'expired' })
    await expect(service.list({})).rejects.toMatchObject({ code: 'tpcoworkhub/session-expired' })
  })
})
