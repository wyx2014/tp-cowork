/** PromptHub is a remote content source, never an execution or installation registry. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-app-boot'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { randomUUID } from 'node:crypto'
import type {} from '../../host.ts'
import type { InstallSource, PromptHubApi, PromptHubFile, PromptHubSkill } from '../../contracts/index.ts'
import type { SkillInstaller } from '../installer/index.ts'
import { parseSkill, sha256, validateFiles, type SkillFile } from '../installer/files.ts'
import { SkillError } from '../installer/errors.ts'
import { parse, PromptHubError } from './errors.ts'
import { decode, detail, fileContentSchema, loginResultSchema, page, websiteUserSchema } from './protocol.ts'
import { browserSessionSchema, detailSchema, hostContribution, hubInstallSchema, listSchema, loginSchema, publishResultSchema, publishSchema, userSchema } from './remote.ts'
import { uploadFiles } from './upload.ts'

export const name = 'toolbox-prompthub'
export const inject = ['credentials', 'skills', 'profileContext', 'typert', 'toolboxInstaller']
export interface Config { endpoint: string; passwordEncoding: 'legacy' | 'sha256'; requestTimeoutMs: number; pageSize: number; maxCatalogItems: number; maxResponseBytes: number; browserAuthTimeoutMs: number }
export const Config = z.object({
  endpoint: z.string().default('http://localhost:8080'), passwordEncoding: z.union(['legacy', 'sha256']).default('legacy'),
  requestTimeoutMs: z.number().min(1).default(30000), pageSize: z.number().min(1).max(100).default(30),
  maxCatalogItems: z.number().min(1).default(10000), maxResponseBytes: z.number().min(1).default(96 * 1024 * 1024),
  browserAuthTimeoutMs: z.number().min(1000).max(900000).default(300000),
})
export const sessionKey = credentialKey(name, 'session')
type Session = { endpoint: string; token?: string; expired?: boolean; user?: import('../../contracts/prompthub.ts').PromptHubUser }
type PublishResult = Awaited<ReturnType<PromptHubApi['publish']>>
function session(record: CredentialRecord | undefined): Session | undefined {
  if (record?.kind !== 'grant' || !record.payload || typeof record.payload !== 'object') return
  const raw = record.payload as Partial<Session>
  if (typeof raw.endpoint !== 'string' || (raw.token !== undefined && typeof raw.token !== 'string')) return
  const user = userSchema.safeParse(raw.user)
  return { endpoint: raw.endpoint, ...(raw.token ? { token: raw.token } : {}), ...(raw.expired === true ? { expired: true } : {}), ...(user.success ? { user: user.data } : {}) }
}
export class ToolboxPromptHub extends TypertRemoteService implements PromptHubApi {
  private revision = 0
  private readonly lifetime = new AbortController()
  private authLifetime = new AbortController()
  private authTail: Promise<unknown> = Promise.resolve()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly publications = new Map<string, { key: string; promise: Promise<PublishResult> }>()
  private readonly pages = new Map<string, { query: string; items: PromptHubSkill[]; expires: number }>()
  private readonly rejected = new Set<string>()
  constructor(ctx: Context, readonly config: Config, readonly installer: SkillInstaller) {
    super(ctx, 'toolboxPromptHub')
    ctx.on('credentials/record-updated', key => {
      if (key !== sessionKey) return
      this.authLifetime.abort(); this.authLifetime = new AbortController(); this.pages.clear(); this.changed()
    })
    ctx.effect(() => installer.registerSource('prompthub', async (source, signal) => {
      try { return await this.run(signal, active => this.download(source, active)) }
      catch (error) {
        // T2 preserves SkillError codes in InstallResult; do not lose actionable source failures.
        if (error instanceof PromptHubError) throw new SkillError(`skills/${error.code.replace('/', '-')}`)
        throw error
      }
    }))
    ctx.effect(() => async () => { this.lifetime.abort(); await Promise.allSettled([...this.pending]); this.pages.clear() })
  }
  private changed(): void { this.ctx.emit('toolbox/changed', { domain: 'prompthub', revision: ++this.revision }) }
  private endpoint(): string {
    try {
      const input = this.config.endpoint || process.env.DSH_PROMPTHUB_URL
      if (!input) throw new Error()
      const url = new URL(input)
      if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error()
      return url.href.replace(/\/+$/, '')
    } catch { throw new PromptHubError('not-configured') }
  }
  private run<T>(signal: AbortSignal | undefined, work: (active: AbortSignal) => Promise<T>, authenticated = true): Promise<T> {
    const active = AbortSignal.any([this.lifetime.signal, ...(authenticated ? [this.authLifetime.signal] : []), ...(signal ? [signal] : [])])
    const pending = (async () => {
      try { active.throwIfAborted(); return await work(active) }
      catch (error) {
        if (error instanceof PromptHubError || error instanceof SkillError) throw error
        if (active.aborted) throw new PromptHubError('cancelled')
        throw new PromptHubError('operation-failed')
      }
    })()
    this.pending.add(pending)
    void pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending))
    return pending
  }
  private async stored(): Promise<Session | undefined> {
    try { return session(await this.ctx.credentials.readRecord(sessionKey)) }
    catch { throw new PromptHubError('credentials-unavailable') }
  }
  private async token(): Promise<string> {
    const endpoint = this.endpoint()
    const record = await this.stored()
    if (record?.endpoint !== endpoint || !record.token) throw new PromptHubError(record?.endpoint === endpoint && record.expired ? 'session-expired' : 'login-required')
    if (this.rejected.has(sha256(endpoint + '\0' + record.token))) throw new PromptHubError('session-expired')
    return record.token
  }
  async account(): ReturnType<PromptHubApi['account']> {
    let endpoint: string
    try { endpoint = this.endpoint() } catch { return { configured: false, writable: false, state: 'unconfigured' } }
    try {
      const record = await this.stored()
      const { writable } = await this.ctx.credentials.describeRecord(sessionKey)
      const expired = record?.endpoint === endpoint && (record.expired || (record.token && this.rejected.has(sha256(endpoint + '\0' + record.token))))
      const configured = record?.endpoint === endpoint && !!record.token && !expired
      return { configured, writable, state: configured ? 'signed_in' : expired ? 'expired' : 'signed_out', ...(configured && record?.user ? { user: record.user } : {}) }
    } catch { throw new PromptHubError('credentials-unavailable') }
  }
  async browserAuth(): ReturnType<PromptHubApi['browserAuth']> {
    return { loginUrl: this.endpoint() + '/desktop/authorize', timeoutMs: this.config.browserAuthTimeoutMs }
  }
  acceptBrowserSession(request: Parameters<PromptHubApi['acceptBrowserSession']>[0], signal?: AbortSignal): ReturnType<PromptHubApi['acceptBrowserSession']> {
    return this.run(signal, active => {
      const work = this.authTail.then(async () => {
        const { token } = parse(browserSessionSchema, request)
        const endpoint = this.endpoint()
        if (!(await this.ctx.credentials.describeRecord(sessionKey)).writable) throw new PromptHubError('credentials-unavailable')
        const raw = await this.request('/api/convex/query', { method: 'POST', body: JSON.stringify({ path: 'users:me', args: {} }) }, active, token, false)
        const user = decode(websiteUserSchema, raw)
        active.throwIfAborted()
        try { await this.ctx.credentials.modifyRecord(sessionKey, async () => ({ kind: 'grant', payload: { endpoint, token, user } })) }
        catch { throw new PromptHubError('credentials-unavailable') }
        this.rejected.delete(sha256(endpoint + '\0' + token))
        return { configured: true }
      })
      this.authTail = work.catch(() => undefined)
      return work
    }, false)
  }
  login(request: Parameters<PromptHubApi['login']>[0], signal?: AbortSignal): ReturnType<PromptHubApi['login']> {
    return this.run(signal, active => {
      const work = this.authTail.then(async () => {
        const input = parse(loginSchema, request)
        const endpoint = this.endpoint()
        let password: string
        try {
          if (!(await this.ctx.credentials.describeRecord(sessionKey)).writable) throw new Error()
          const resolved = await this.ctx.credentials.resolve(credentialRef(input.passwordRef))
          if (!resolved) throw new Error()
          password = resolved.value
        } catch { throw new PromptHubError('credentials-unavailable') }
        const raw = await this.request('/api/users/login', { method: 'POST', body: JSON.stringify({ username: input.username.trim(), passwordHash: this.config.passwordEncoding === 'sha256' ? sha256(password) : password }) }, active)
        const result = decode(loginResultSchema, raw)
        active.throwIfAborted()
        try { await this.ctx.credentials.modifyRecord(sessionKey, async () => ({ kind: 'grant', payload: { endpoint, token: result.token, user: result.user } })) }
        catch { throw new PromptHubError('credentials-unavailable') }
        this.rejected.delete(sha256(endpoint + '\0' + result.token))
        return { configured: true }
      })
      this.authTail = work.catch(() => undefined)
      return work
    }, false)
  }
  async logout(): Promise<void> {
    // Abort current downloads immediately; serialize deletion after any login already committing.
    this.authLifetime.abort(); this.authLifetime = new AbortController()
    return this.run(undefined, active => {
      const work = this.authTail.then(async () => {
        active.throwIfAborted()
        try { await this.ctx.credentials.deleteRecord(sessionKey) }
        catch { throw new PromptHubError('credentials-unavailable') }
        this.pages.clear(); this.changed()
      })
      this.authTail = work.catch(() => undefined)
      return work
    }, false)
  }
  list(request: Parameters<PromptHubApi['list']>[0], signal?: AbortSignal): ReturnType<PromptHubApi['list']> {
    return this.run(signal, async active => {
      const input = parse(listSchema, request)
      const token = await this.token()
      const query = (input.query ?? '').trim().toLowerCase()
      let key: string, offset = 0, items: PromptHubSkill[]
      if (input.cursor) {
        const match = /^([a-f0-9-]{36}):(\d+)$/.exec(input.cursor)
        if (!match) throw new PromptHubError('invalid-request')
        key = match[1]!; offset = Number(match[2])
        const snapshot = this.pages.get(key)
        if (!snapshot || snapshot.expires < Date.now() || snapshot.query !== query || !Number.isSafeInteger(offset) || offset >= snapshot.items.length) throw new PromptHubError('catalog-expired')
        items = snapshot.items
      } else {
        const records = new Map<string, PromptHubSkill>()
        const seen = new Set<string>()
        let cursor: string | null = null
        do {
          const result = page(await this.request('/api/convex/query', { method: 'POST', body: JSON.stringify({ path: 'skills:listPublicPageV4', args: cursor ? { paginationOpts: { numItems: 100, cursor } } : {} }) }, active, token, false))
          for (const item of result.items) records.set(item.id, item)
          if (records.size > this.config.maxCatalogItems || (result.next && seen.has(result.next)) || seen.size >= 100) throw new PromptHubError('catalog-limit')
          cursor = result.next
          if (cursor) seen.add(cursor)
        } while (cursor)
        items = [...records.values()].filter(item => {
          const visible = (!item.visibility && !item.approvalStatus) || (item.visibility === 'public' && item.approvalStatus === 'approved') || ['pending', 'rejected'].includes(item.approvalStatus ?? '')
          return visible && [item.name, item.displayName, item.description, ...(item.tags ?? [])].some(value => value?.toLowerCase().includes(query))
        })
        key = randomUUID()
        if (this.pages.size >= 16) this.pages.delete(this.pages.keys().next().value!)
        this.pages.set(key, { query, items, expires: Date.now() + 5 * 60_000 })
      }
      const next = offset + this.config.pageSize
      return { items: items.slice(offset, next), ...(next < items.length ? { cursor: `${key}:${next}` } : {}) }
    })
  }
  detail(request: Parameters<PromptHubApi['detail']>[0], signal?: AbortSignal): ReturnType<PromptHubApi['detail']> {
    return this.run(signal, async active => {
      const input = parse(detailSchema, request), token = await this.token()
      const snapshot = await this.readDetail(input.id, active, token, input.preview)
      if (!input.preview || !snapshot.skill.versionId) return snapshot
      const file = await this.readFile(snapshot.files.find(file => file.path === 'SKILL.md')!, snapshot.skill.versionId, active, token)
      return { ...snapshot, content: new TextDecoder('utf-8', { fatal: true }).decode(file.bytes) }
    })
  }
  private async readDetail(id: string, signal: AbortSignal, token: string, allowUnversioned = false) {
    return detail(await this.request(`/api/skills/${encodeURIComponent(id)}`, {}, signal, token), id, this.installer.options.maxBytes, this.installer.options.maxFiles, allowUnversioned)
  }
  private async readFile(meta: PromptHubFile, versionId: string, signal: AbortSignal, token: string): Promise<SkillFile> {
    const query = new URLSearchParams({ versionId, path: meta.path })
    const raw = decode(fileContentSchema, await this.request(`/api/skill-versions/files?${query}`, {}, signal, token))
    const bytes = Buffer.from(raw.content, raw.encoding === 'base64' ? 'base64' : 'utf8')
    if (raw.path !== meta.path || raw.size !== meta.size || raw.sha256 !== meta.sha256 || bytes.byteLength !== meta.size || sha256(bytes) !== meta.sha256) throw new PromptHubError('invalid-package')
    return { path: meta.path, bytes, sha256: meta.sha256 }
  }
  private async download(source: InstallSource, signal: AbortSignal): Promise<SkillFile[]> {
    if (source.kind !== 'prompthub') throw new PromptHubError('invalid-request')
    const token = await this.token()
    const snapshot = await this.readDetail(source.skillId, signal, token)
    if (snapshot.skill.versionId !== source.versionId || snapshot.fingerprint !== source.fingerprint) throw new PromptHubError('package-changed')
    const files: SkillFile[] = []
    for (const meta of snapshot.files) {
      files.push(await this.readFile(meta, source.versionId, signal, token))
    }
    try {
      validateFiles(files, this.installer.options.maxBytes, this.installer.options.maxFiles)
      if (parseSkill(files.find(file => file.path === 'SKILL.md')!.bytes).name !== snapshot.skill.name) throw new PromptHubError('invalid-package')
    } catch { throw new PromptHubError('invalid-package') }
    signal.throwIfAborted()
    return files
  }
  install(request: Parameters<PromptHubApi['install']>[0], signal?: AbortSignal): ReturnType<PromptHubApi['install']> {
    return this.run(signal, async active => {
      const input = parse(hubInstallSchema, request)
      const pending = this.installer.install(input)
      const cancel = () => { void this.installer.cancel({ operationId: input.requestId }) }
      active.addEventListener('abort', cancel, { once: true })
      if (active.aborted) cancel()
      try { const result = await pending; if (result.state === 'installed') this.changed(); return result }
      finally { active.removeEventListener('abort', cancel) }
    })
  }
  publish(request: Parameters<PromptHubApi['publish']>[0], signal?: AbortSignal): ReturnType<PromptHubApi['publish']> {
    const input = parse(publishSchema, request)
    const key = JSON.stringify(input)
    const old = this.publications.get(input.requestId)
    if (old) {
      if (old.key !== key) return Promise.reject(new PromptHubError('request-conflict'))
      return old.promise
    }
    // Never evict a possibly committed upload: a replay must not publish again during this Host lifetime.
    if (this.publications.size >= 256) return Promise.reject(new PromptHubError('request-limit'))
    const promise = this.run(signal, async active => {
      const token = await this.token()
      const files = await uploadFiles(this.ctx, input.sourceSkillId, this.installer.options.maxBytes, this.installer.options.maxFiles, token, active)
      if (parseSkill(files.find(file => file.path === 'SKILL.md')!.bytes).name !== input.slug) throw new PromptHubError('invalid-request')
      const form = new FormData()
      for (const [key, value] of Object.entries({ slug: input.slug, displayName: input.displayName, version: input.version, changelog: '', visibility: 'public', category: 'general', tags: '' })) form.set(key, value)
      for (const file of files) form.append('files', new Blob([Uint8Array.from(file.bytes)], { type: 'application/octet-stream' }), file.path)
      active.throwIfAborted()
      let result: PublishResult
      try {
        const raw = await this.request('/api/skills/publish', { method: 'POST', headers: { 'Idempotency-Key': input.requestId }, body: form }, active, token)
        // status is deliberately not interpreted as approved/public: returned IDs only confirm receipt.
        const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
        if (['failed', 'error', 'rejected'].includes(String(value.status))) throw new PromptHubError('publish-rejected')
        result = decode(publishResultSchema, { skillId: value.skillId, versionId: value.versionId, fingerprint: value.fingerprint, fileCount: value.fileCount })
        if (result.fileCount !== files.length) throw new PromptHubError('protocol')
      } catch (error) {
        if (error instanceof PromptHubError && ['prompthub/publish-rejected', 'prompthub/session-expired'].includes(error.code)) throw error
        throw new PromptHubError('publish-uncertain')
      }
      this.changed()
      return result
    })
    this.publications.set(input.requestId, { key, promise })
    return promise
  }
  private async request(path: string, init: RequestInit, signal: AbortSignal, token?: string, enveloped = true): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs)
    const active = AbortSignal.any([signal, timeout])
    const publishing = path === '/api/skills/publish'
    try {
      const response = await fetch(this.endpoint() + path, { ...init, redirect: 'error', signal: active,
        headers: { ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      })
      if (response.status === 401) {
        await response.body?.cancel()
        if (!token) throw new PromptHubError('login-failed')
        await this.expire(token)
        throw new PromptHubError('session-expired')
      }
      if (!response.ok) { await response.body?.cancel(); throw new PromptHubError(publishing ? (response.status >= 500 ? 'publish-uncertain' : 'publish-rejected') : 'network') }
      const reader = response.body?.getReader()
      if (!reader) throw new PromptHubError('protocol')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > this.config.maxResponseBytes) throw new PromptHubError('protocol')
          chunks.push(value)
        }
      } finally { await reader.cancel(); reader.releaseLock() }
      let payload: unknown
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new PromptHubError('protocol') }
      if (!enveloped) return payload
      if (!payload || typeof payload !== 'object' || !('code' in payload)) throw new PromptHubError('protocol')
      const envelope = payload as { code: unknown; data?: unknown }
      if (envelope.code === 401) {
        if (!token) throw new PromptHubError('login-failed')
        await this.expire(token); throw new PromptHubError('session-expired')
      }
      if (envelope.code !== 200) throw new PromptHubError(publishing ? 'publish-rejected' : token ? 'remote-rejected' : 'login-failed')
      return envelope.data
    } catch (error) {
      if (error instanceof PromptHubError) throw error
      if (signal.aborted) throw new PromptHubError('cancelled')
      if (timeout.aborted) throw new PromptHubError('timeout')
      throw new PromptHubError('network')
    }
  }
  private async expire(token: string): Promise<void> {
    const endpoint = this.endpoint()
    this.rejected.add(sha256(endpoint + '\0' + token))
    try {
      await this.ctx.credentials.modifyRecord(sessionKey, async current => {
        const value = session(current)
        return value?.endpoint === endpoint && value.token === token ? { kind: 'grant', payload: { endpoint, expired: true } } : undefined
      })
    } catch { /* Report authentication failure even when a read-only credential provider cannot clear it. */ }
    this.changed()
  }
}
export function applyPromptHubModule(ctx: Context, config: Config): void {
  // Host-only seam. Structural access also works when T7 emits skills and PromptHub as separate entries.
  const installer = ctx.get('toolboxInstaller') as SkillInstaller | undefined
  if (!installer || typeof installer.registerSource !== 'function' || !installer.options) throw new PromptHubError('installer-unavailable')
  ctx.typert.register(hostContribution)
  new ToolboxPromptHub(ctx, config, installer)
}
export const apply = applyPromptHubModule
