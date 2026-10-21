/** MCP configuration is a DSH profile setting; tools, resources and prompts belong to a task's Agent scope. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import type { McpConnectionStatus } from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '../../host.ts'
import type { Catalog, McpApi, McpDefinition, McpItem, McpEditorEntry, TaskContext } from '../../contracts/index.ts'
import { connect } from './connection.ts'
import { parseDefinition, editorEntrySchema, importRequestSchema } from './schema.ts'
import { hostContribution } from './remote.ts'
export { defaultMcpDefinitions } from './defaults.ts'

export const name = 'toolbox-mcp'
export const inject = ['typert', 'settings', 'tools', 'credentials']
export interface McpRecord { definition: McpDefinition; revision: number }
export interface Config {
  settingsEntry: string
  settingsPath: string[]
  servers: Volatile<McpRecord[]>
  removedBundled: Volatile<string[]>
  configRevision: Volatile<number>
  connectTimeoutMs: number
}
const binding = z.object({ ref: z.string().role('credential-ref'), target: z.union(['header', 'env', 'url-query']), key: z.string() })
const base = { id: z.string(), label: z.string(), origin: z.union(['bundled', 'custom']), enabled: z.boolean(), credentials: z.array(binding), connectTimeout: z.number().min(1).max(300), toolTimeout: z.number().min(1).max(600) }
const definition = z.union([
  z.object({ ...base, transport: z.const('stdio'), command: z.string(), args: z.array(z.string()), cwd: z.string() }),
  z.object({ ...base, transport: z.const('streamable-http'), endpoint: z.string() }),
])
export const Config = z.object({
  settingsEntry: z.string().default('toolbox-mcp'), settingsPath: z.array(z.string()).default([]),
  servers: z.array(z.object({ definition, revision: z.number().step(1).min(1) })).default([]).volatile(),
  removedBundled: z.array(z.string()).default([]).volatile(), configRevision: z.number().step(1).min(1).default(1).volatile(),
  connectTimeoutMs: z.number().min(1).max(120000).default(15000),
})
interface Activity {
  ids: Set<string>
  controller: AbortController
  close(): Promise<void>
  finish(): void
}
export interface TaskMcpLease {
  /** Aborts on disconnect, reconfiguration or owner disposal. The task runner must observe this signal. */
  readonly signal: AbortSignal
  close(): Promise<void>
}
/** Host-only admission boundary, deliberately absent from Remote. T6 must await it before driving the Agent. */
export interface McpTaskRuntime {
  openTask(context: TaskContext, agentCtx: Context, signal: AbortSignal): Promise<TaskMcpLease>
}
declare module '@deepseek-ai/cordis' { interface Context { toolboxMcpRuntime: McpTaskRuntime } }

export class ToolboxMcp extends TypertRemoteService implements McpApi, McpTaskRuntime {
  private revision = 1
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private readonly active = new Set<Activity>()
  private readonly observations = new Map<string, McpConnectionStatus>()
  private readonly live = new Map<object, McpConnectionStatus>()
  private readonly discovered = new Map<string, number>()
  private readonly probes = new Map<string, Activity>()
  private readonly pinned = new WeakMap<object, Map<string, string>>()
  private readonly sessions = new WeakSet<object>()
  constructor(ctx: Context, readonly config: Config) { super(ctx, 'toolboxMcp') }
  changed(id?: string): void {
    void this.ctx.parallel('toolbox/changed', { domain: 'mcp', revision: ++this.revision, ...(id ? { id } : {}) })
      .catch(() => { this.ctx.logger.warn('toolbox-mcp: 状态订阅者处理失败。') })
  }
  private records(): McpRecord[] {
    const ids = new Set<string>()
    return this.config.servers.get().map(row => {
      const definition = parseDefinition(row.definition)
      if (ids.has(definition.id) || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('toolbox/mcp-invalid-profile: 请修复重复标识或配置版本。')
      ids.add(definition.id)
      return { definition, revision: row.revision }
    })
  }
  private find(id: string): McpRecord {
    const row = this.records().find(row => row.definition.id === id)
    if (!row) throw new Error('toolbox/mcp-not-found: 服务器已被移除，请刷新列表。')
    return row
  }
  private async item(row: McpRecord): Promise<McpItem> {
    const def = row.definition
    const reasons: McpItem['readiness']['reasons'] = []
    const credentials: McpItem['credentials'] = []
    for (const ref of new Set(def.credentials.map(binding => binding.ref))) {
      try {
        const info = await this.ctx.credentials.describe(credentialRef(ref))
        credentials.push({ ref, configured: info.configured, writable: info.writable })
        if (!info.configured) reasons.push({ code: 'needs_configuration', message: `请在 TP Cowork 凭证中配置 ${ref}。` })
      } catch { credentials.push({ ref, configured: false, writable: false }); reasons.push({ code: 'credentials_unavailable', message: 'TP Cowork 凭证服务暂不可用。' }) }
    }
    if (!def.enabled) reasons.push({ code: 'disabled', message: '服务器已禁用。' })
    if (!(def.transport === 'stdio' ? def.command.trim() : def.endpoint)) reasons.push({ code: 'needs_configuration', message: def.id === 'playwright' ? '请由默认资源安装器配置已核对版本的 Playwright 启动命令。' : '请配置服务器地址或启动命令。' })
    const snapshot = this.observations.get(def.id)
    const failed = snapshot?.state === 'error'
    if (!reasons.length && failed) reasons.push({ code: 'probe_failed', message: '连接失败，请检查网络、服务与凭证后重新探测。' })
    return { id: def.id, label: def.label, origin: def.origin, configRevision: row.revision, installed: true, enabled: def.enabled,
      readiness: { state: reasons.length ? failed && reasons[0]?.code === 'probe_failed' ? 'error' : 'blocked' : snapshot?.state === 'connecting' || snapshot?.state === 'reconnecting' ? 'checking' : 'ready', reasons, ...(snapshot ? { checkedAt: snapshot.observedAt } : {}) },
      connection: snapshot?.state ?? 'disconnected', generation: snapshot?.generation ?? 0, toolCount: snapshot?.toolCount ?? 0,
      ...(snapshot ? { observedAt: snapshot.observedAt } : {}), credentials }
  }
  async inventory(): Promise<Catalog<McpItem>> {
    const revision = this.revision
    const items = await Promise.all(this.records().map(row => this.item(row)))
    return { revision, complete: true, items }
  }
  async definition(request: { id: string }): Promise<McpDefinition> { return structuredClone(this.find(request.id).definition) }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => { if (this.closed) throw new Error('toolbox/mcp-disposed'); return work() })
    this.tail = result.catch(() => {})
    return result
  }
  private async write(rows: McpRecord[], removed?: string[]): Promise<void> {
    const descriptor = this.ctx.settings.describe().find(row => row.ns === this.config.settingsEntry)
    if (!descriptor) throw new Error('toolbox/mcp-settings-missing: 请检查工具箱的 TP Cowork profile 配置入口。')
    try {
      await this.ctx.settings.mutate(this.config.settingsEntry, [
        { op: 'set', path: [...this.config.settingsPath, 'servers'], value: rows },
        { op: 'set', path: [...this.config.settingsPath, 'configRevision'], value: Math.max(this.config.configRevision.get(), ...this.records().map(row => row.revision), ...rows.map(row => row.revision)) },
        ...(removed ? [{ op: 'set' as const, path: [...this.config.settingsPath, 'removedBundled'], value: removed }] : []),
      ], descriptor.revision)
    } catch { throw new Error('toolbox/mcp-settings-write-failed: 配置已变化或无法保存，请刷新后重试。') }
  }
  private assertRevision(expected: number): void {
    if (expected !== this.revision) throw new Error('toolbox/stale-selection: 列表已变化，请刷新后重试。')
  }
  private nextConfigRevision(): number {
    const revision = Math.max(this.config.configRevision.get(), ...this.records().map(row => row.revision)) + 1
    if (!Number.isSafeInteger(revision)) throw new Error('toolbox/mcp-config-version-exhausted')
    return revision
  }
  private editorEntry(request: unknown): McpEditorEntry {
    const entry = editorEntrySchema.parse(request)
    const definition = parseDefinition(entry.definition)
    for (const ref of Object.keys(entry.secretValues ?? {})) {
      // The editor may only create fresh, private references. Existing/shared
      // references are retained by name and are never overwritten by this API.
      if (!/^TPCOWORK_MCP_[a-f0-9]{32}$/i.test(ref) || !definition.credentials.some(binding => binding.ref === ref)) throw new Error('toolbox/mcp-invalid-binding')
    }
    return { definition, ...(entry.secretValues ? { secretValues: entry.secretValues } : {}) }
  }
  private async withSecrets<T>(entries: McpEditorEntry[], work: () => Promise<T>): Promise<T> {
    const values = entries.flatMap(entry => Object.entries(entry.secretValues ?? {}))
    const written: string[] = []
    const previous = JSON.stringify(this.records())
    if (new Set(values.map(([ref]) => ref)).size !== values.length) throw new Error('toolbox/mcp-invalid-binding')
    try {
      for (const [ref, value] of values) {
        const info = await this.ctx.credentials.describe(credentialRef(ref))
        if (info.configured || !info.writable) throw new Error('toolbox/mcp-credentials-unavailable')
        await this.ctx.credentials.set(credentialRef(ref), value)
        written.push(ref)
      }
      if (JSON.stringify(this.records()) !== previous) throw new Error('toolbox/stale-selection')
      return await work()
    } catch {
      await Promise.allSettled(written.map(ref => this.ctx.credentials.unset(credentialRef(ref))))
      throw new Error('toolbox/mcp-editor-save-failed')
    }
  }
  create(request: { expectedRevision: number } & McpEditorEntry): Promise<McpItem> {
    const definition = parseDefinition(request.definition)
    const entry = this.editorEntry({ definition, ...(request.secretValues ? { secretValues: request.secretValues } : {}) })
    return this.serialize(async () => {
      this.assertRevision(request.expectedRevision)
      const rows = this.records()
      if (rows.some(row => row.definition.id === definition.id)) throw new Error('toolbox/mcp-already-exists')
      if (definition.origin !== 'custom') throw new Error('toolbox/mcp-bundled-owner: 默认项由资源安装器配置。')
      const row = { definition, revision: this.nextConfigRevision() }
      await this.withSecrets([entry], () => this.write([...rows, row])); this.changed(definition.id)
      return this.item(row)
    })
  }
  update(request: { expectedRevision: number } & McpEditorEntry): Promise<McpItem> {
    const definition = parseDefinition(request.definition)
    const entry = this.editorEntry({ definition, ...(request.secretValues ? { secretValues: request.secretValues } : {}) })
    return this.serialize(async () => {
      this.assertRevision(request.expectedRevision)
      const current = this.find(definition.id)
      if (current.definition.origin !== definition.origin) throw new Error('toolbox/mcp-origin-immutable')
      const row = { definition, revision: this.nextConfigRevision() }
      await this.withSecrets([entry], () => this.write(this.records().map(old => old.definition.id === definition.id ? row : old)))
      await this.stopId(definition.id); this.observations.delete(definition.id); this.discovered.delete(definition.id); this.changed(definition.id)
      return this.item(row)
    })
  }
  importDefinitions(request: Parameters<McpApi['importDefinitions']>[0]): Promise<Catalog<McpItem>> {
    const input = importRequestSchema.parse(request)
    const entries = input.entries.map(({ replace, ...entry }) => ({ ...this.editorEntry(entry), replace }))
    return this.serialize(async () => {
      this.assertRevision(input.expectedRevision)
      let rows = this.records()
      const revision = this.nextConfigRevision()
      const seen = new Set<string>()
      for (const entry of entries) {
        const { definition } = entry
        if (seen.has(definition.id)) throw new Error('toolbox/mcp-already-exists')
        seen.add(definition.id)
        const old = rows.find(row => row.definition.id === definition.id)
        if (!!old !== entry.replace || (old ? old.definition.origin !== definition.origin : definition.origin !== 'custom')) throw new Error('toolbox/mcp-import-conflict')
        rows = [...rows.filter(row => row.definition.id !== definition.id), { definition, revision }]
      }
      await this.withSecrets(entries, () => this.write(rows))
      for (const id of seen) { await this.stopId(id); this.observations.delete(id); this.discovered.delete(id) }
      this.changed()
      return this.inventory()
    })
  }
  async probeDraft(request: McpEditorEntry, signal: AbortSignal): Promise<{ ok: boolean; toolCount: number }> {
    if (this.closed) throw new Error('toolbox/mcp-disposed')
    const entry = this.editorEntry(request)
    const activity = this.activity([], signal)
    const isolated = createScope(this.ctx, {})
    let toolCount = 0
    try {
      const connection = await connect(isolated.ctx, entry.definition, activity.controller.signal, this.config.connectTimeoutMs, snapshot => {
        if (snapshot.state === 'connected') toolCount = snapshot.toolCount
      }, entry.secretValues)
      await connection.close()
      activity.controller.signal.throwIfAborted()
      return { ok: true, toolCount }
    } catch { return { ok: false, toolCount: 0 } }
    finally { await isolated.dispose(); this.finish(activity) }
  }
  async setEnabled(request: { expectedRevision: number; id: string; enabled: boolean }): Promise<McpItem> {
    return this.update({ expectedRevision: request.expectedRevision, definition: { ...this.find(request.id).definition, enabled: request.enabled } })
  }
  remove(request: { expectedRevision: number; id: string }): Promise<void> {
    return this.serialize(async () => {
      this.assertRevision(request.expectedRevision)
      const current = this.find(request.id)
      const removed = current.definition.origin === 'bundled' ? [...new Set([...this.config.removedBundled.get(), request.id])] : undefined
      await this.write(this.records().filter(row => row.definition.id !== request.id), removed)
      await this.stopId(request.id); this.observations.delete(request.id); this.discovered.delete(request.id); this.changed(request.id)
    })
  }
  private observe(token: object, id: string, snapshot: McpConnectionStatus): void {
    if (snapshot.state === 'connected') this.discovered.set(id, snapshot.toolCount)
    if (snapshot.state === 'disconnected' || snapshot.state === 'error') this.live.delete(token)
    else this.live.set(token, snapshot)
    // An independent probe or a second task cannot overwrite another task's live connection.
    const priority = { connected: 0, connecting: 1, reconnecting: 2, error: 3, disconnected: 4 }
    const terminal = snapshot.state === 'disconnected' && this.observations.get(id)?.state === 'error' ? { ...snapshot, state: 'error' as const } : snapshot
    const current = [...this.live.values()].filter(row => row.serverName === id).sort((a, b) => priority[a.state] - priority[b.state])[0] ?? terminal
    this.observations.set(id, { ...current, toolCount: current.state === 'disconnected' ? this.discovered.get(id) ?? 0 : current.toolCount, generation: (this.observations.get(id)?.generation ?? 0) + 1 })
    this.changed(id)
  }
  private async stopId(id: string): Promise<void> {
    await Promise.all([...this.active].filter(row => row.ids.has(id)).map(row => row.close()))
  }
  private activity(ids: string[], signal: AbortSignal): Activity {
    const controller = new AbortController()
    const cancel = () => controller.abort()
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    let stopping: Promise<void> | undefined
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    const activity: Activity = { ids: new Set(ids), controller, close: () => {
      controller.abort()
      return stopping ??= gate.promise
    }, finish: () => { signal.removeEventListener('abort', cancel); this.active.delete(activity); gate.resolve() } }
    this.active.add(activity)
    // Lifecycle completions are installed before any connection can start.
    return activity
  }
  private finish(activity: Activity): void { activity.finish() }
  async probe(request: { id: string }, signal: AbortSignal): Promise<McpItem> {
    if (this.closed) throw new Error('toolbox/mcp-disposed')
    const row = this.find(request.id)
    const item = await this.item(row)
    if (item.readiness.state === 'blocked' && item.readiness.reasons.some(reason => reason.code !== 'disabled')) return item
    while (this.probes.has(request.id)) await this.probes.get(request.id)!.close()
    if (this.find(request.id).revision !== row.revision) throw new Error('toolbox/mcp-stale-config')
    const activity = this.activity([request.id], signal)
    const token = {}
    this.probes.set(request.id, activity)
    const isolated = createScope(this.ctx, {})
    let successful: McpItem | undefined
    try {
      const connection = await connect(isolated.ctx, row.definition, activity.controller.signal, this.config.connectTimeoutMs, snapshot => this.observe(token, request.id, snapshot))
      successful = await this.item(row)
      await connection.close()
    } catch {
      this.observe(token, request.id, { serverName: request.id, state: activity.controller.signal.aborted ? 'disconnected' : 'error', generation: 0, toolCount: 0, observedAt: Date.now() })
    } finally {
      await isolated.dispose()
      if (this.probes.get(request.id) === activity) this.probes.delete(request.id)
      this.finish(activity)
    }
    // A probe proves discovery, then disconnects. It never grants runtime capabilities.
    const result = await this.item(this.find(request.id))
    if (successful && !activity.controller.signal.aborted && result.configRevision === row.revision) result.toolCount = successful.toolCount
    return result
  }
  async openTask(context: TaskContext, agentCtx: Context, signal: AbortSignal): Promise<TaskMcpLease> {
    if (this.closed) throw new Error('toolbox/mcp-disposed')
    const key = scopeOf(agentCtx)
    if (!key || (key as Agent).id !== context.sessionId) throw new Error('toolbox/mcp-agent-scope-mismatch')
    const pin = JSON.stringify({ taskId: context.taskId, mcp: context.mcp })
    const pins = this.pinned.get(key) ?? new Map<string, string>()
    if (pins.has(context.taskId) && pins.get(context.taskId) !== pin) throw new Error('toolbox/mcp-selection-fixed: 已提交的任务快照不能更改 MCP 选择。')
    if (this.sessions.has(key)) throw new Error('toolbox/mcp-task-already-open')
    if (new Set(context.mcp.map(row => row.id)).size !== context.mcp.length) throw new Error('toolbox/mcp-duplicate-selection')
    const rows = context.mcp.map(selection => {
      const row = this.find(selection.id)
      if (row.revision !== selection.configRevision || !row.definition.enabled) throw new Error('toolbox/mcp-stale-config')
      return row
    })
    pins.set(context.taskId, pin); this.pinned.set(key, pins); this.sessions.add(key)
    const activity = this.activity(rows.map(row => row.definition.id), signal)
    const scope = createScope(agentCtx, key)
    let stopping: Promise<void> | undefined
    const close = () => stopping ??= Promise.resolve().then(async () => {
      activity.controller.abort()
      await scope.dispose()
      this.sessions.delete(key); this.finish(activity)
    })
    const cancel = () => { void close().catch(() => {}) }
    activity.controller.signal.addEventListener('abort', cancel, { once: true })
    scope.ctx.on('agent/disposed', ({ agent }) => { if (agent === key) return close() })
    scope.ctx.effect(() => () => {
      activity.controller.signal.removeEventListener('abort', cancel)
      activity.controller.abort()
      this.sessions.delete(key); this.finish(activity)
    })
    // A management disable/remove stops this task's complete MCP scope.
    activity.close = close
    try {
      for (const row of rows) {
        const ready = await this.item(row)
        if (ready.readiness.state === 'blocked') throw new Error('toolbox/mcp-needs-configuration')
        const token = {}
        await connect(scope.ctx, row.definition, activity.controller.signal, this.config.connectTimeoutMs, snapshot => {
          this.observe(token, row.definition.id, snapshot)
          if (snapshot.state === 'error') void close().catch(() => {})
        })
      }
      activity.controller.signal.throwIfAborted()
      // Revalidate at the end of asynchronous preparation; no stale config can reach execution.
      for (const row of rows) if (this.find(row.definition.id).revision !== row.revision) throw new Error('toolbox/mcp-stale-config')
      return { close, signal: activity.controller.signal }
    } catch {
      await close()
      throw new Error('toolbox/mcp-task-unavailable: MCP 准备失败或已取消，请刷新配置后重新提交任务。')
    }
  }
  async reconfigure(): Promise<void> {
    await Promise.all([...this.active].map(activity => activity.close()))
    this.observations.clear(); this.discovered.clear(); this.changed()
  }
  async dispose(): Promise<void> { this.closed = true; await this.reconfigure(); await this.tail }
}

/** T7 mounts this module inside the existing toolbox bundle; it opens no default connections. */
export function applyMcpModule(ctx: Context, config: Config): void {
  ctx.typert.register(hostContribution)
  const service = new ToolboxMcp(ctx, config)
  ctx.provide('toolboxMcpRuntime', service)
  let servers = JSON.stringify(config.servers.get())
  ctx.on('settings/document-updated', ns => {
    if (ns !== config.settingsEntry) return
    const current = JSON.stringify(config.servers.get())
    if (current === servers) return
    servers = current
    return service.reconfigure()
  })
  ctx.on('credentials/reference-updated', () => service.reconfigure())
  ctx.effect(() => () => service.dispose())
}
export const apply = applyMcpModule
