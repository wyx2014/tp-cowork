import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import McpResources from '@deepseek-ai/dsh-mcp-resources'
import { createScope } from '@deepseek-ai/dsh-scope'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { McpDefinition, TaskContext } from '../src/contracts/index.ts'
import * as mcp from '../src/host/mcp/index.ts'
import { parseDefinition } from '../src/host/mcp/schema.ts'
import { sanitizeMcpError } from '../../../../deepseek-harness/packages/mcp/mcp-client/src/redact.ts'
import { startHttpMcpFixture } from '../../../../deepseek-harness/packages/mcp/mcp-client/tests/http-fixture.ts'
import { ownerPeer } from '../../../../deepseek-harness/packages/api/gateway/tests/peer.ts'

const roots: Context[] = []
vi.setConfig({ testTimeout: 15000 })
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })
const stdio: McpDefinition = { id: 'local', label: 'Local', origin: 'custom', enabled: true, transport: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('../../../../deepseek-harness/packages/mcp/mcp-client/tests/fixtures/toolbox-server.mjs', import.meta.url))], credentials: [] }
function task(sessionId: string, ids = ['local']): TaskContext {
  return { schemaVersion: 1, taskId: 'task-' + sessionId, sessionId, submittedAt: Date.now(), catalogRevision: 1, team: null, skills: [], mcp: ids.map(id => ({ id, configRevision: 1 })) }
}
async function setup(definitions: McpDefinition[] = [stdio], secrets: Record<string, string> = {}, timeoutMs = 10000) {
  const ctx = new Context(); roots.push(ctx)
  await ctx.plugin(TypertRegistry); await ctx.plugin(RemoteAccess); await ctx.plugin(TypertGateway); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(McpResources)
  let rows = definitions.map(definition => ({ definition: structuredClone(definition), revision: 1 }))
  let removed: string[] = []; let settingsRevision = 1; let configRevision = 1
  const write = vi.fn(async (_namespace, operations, expected) => {
    expect(expected).toBe(settingsRevision++)
    for (const operation of operations) {
      if (operation.path.at(-1) === 'servers') rows = structuredClone(operation.value)
      if (operation.path.at(-1) === 'removedBundled') removed = structuredClone(operation.value)
      if (operation.path.at(-1) === 'configRevision') configRevision = operation.value
    }
  })
  await ctx.plugin({ apply(inner: Context) {
    inner.provide('settings', { describe: () => [{ ns: 'toolbox-mcp', revision: settingsRevision }], mutate: write } as never)
    inner.provide('credentials', { describe: async ref => ({ configured: !!secrets[ref], writable: true }), resolve: async ref => secrets[ref] ? { value: secrets[ref], source: 'test' } : undefined,
      set: async (ref, value) => { secrets[ref] = value }, unset: async ref => { delete secrets[ref] } } as never)
  } })
  const module = await ctx.plugin({ inject: mcp.inject, apply(inner: Context) {
    mcp.apply(inner, { settingsEntry: 'toolbox-mcp', settingsPath: [], servers: { get: () => rows } as never, removedBundled: { get: () => removed } as never, configRevision: { get: () => configRevision } as never, connectTimeoutMs: timeoutMs })
  } })
  const service = ctx.toolboxMcp as mcp.ToolboxMcp
  const agent = (id: string) => { const key = { id } as unknown as Agent; return { key, scope: createScope(ctx, key) } }
  const call = (name: string, agent?: Agent, args: unknown = {}) => ctx.tools.execute({ name, arguments: args, ...(agent ? { agent } : {}), signal: new AbortController().signal, callId: ToolCallId('test-' + Math.random()) })
  return { ctx, service, module, agent, call, write, removed: () => removed }
}
describe('MCP profile management and native runtime', () => {
  it('stores editor values in credentials, retains public references and rolls back new secrets when persistence fails', async () => {
    const secrets: Record<string, string> = {}
    const { service, write } = await setup([], secrets)
    const ref = 'TPCOWORK_MCP_' + 'a'.repeat(32)
    const definition: McpDefinition = { ...stdio, credentials: [{ ref, target: 'env', key: 'API_KEY' }], connectTimeout: 15, toolTimeout: 30 }
    const request = { expectedRevision: (await service.inventory()).revision, definition, secretValues: { [ref]: 'EDITOR_PRIVATE_VALUE' } }
    write.mockRejectedValueOnce(new Error('fixture persistence failed'))
    await expect(service.create(request)).rejects.toThrow('editor-save-failed')
    expect(secrets).toEqual({}); expect((await service.inventory()).items).toEqual([])
    await service.create(request)
    expect(secrets[ref]).toBe('EDITOR_PRIVATE_VALUE')
    expect(await service.definition({ id: 'local' })).toEqual(definition)
    expect(JSON.stringify(await service.inventory())).not.toContain('EDITOR_PRIVATE_VALUE')
    expect(JSON.stringify(write.mock.calls)).not.toContain('EDITOR_PRIVATE_VALUE')
    await service.update({ expectedRevision: (await service.inventory()).revision, definition: { ...definition, label: 'Renamed' } })
    expect(secrets[ref]).toBe('EDITOR_PRIVATE_VALUE')
    await expect(service.update({ expectedRevision: (await service.inventory()).revision, definition, secretValues: { [ref]: 'OVERWRITE' } })).rejects.toThrow('editor-save-failed')
    expect(secrets[ref]).toBe('EDITOR_PRIVATE_VALUE')
  })
  it('imports a reviewed batch atomically, preserving ownership and rejecting conflicts and stale catalogs', async () => {
    const { service, write } = await setup()
    const revision = (await service.inventory()).revision
    await expect(service.importDefinitions({ expectedRevision: revision, entries: [{ definition: { ...stdio, id: 'new' }, replace: false }, { definition: stdio, replace: false }] })).rejects.toThrow('import-conflict')
    expect(write).not.toHaveBeenCalled()
    const result = await service.importDefinitions({ expectedRevision: revision, entries: [{ definition: { ...stdio, id: 'new' }, replace: false }, { definition: { ...stdio, label: 'Replaced' }, replace: true }] })
    expect(result.items.map(row => row.id)).toEqual(['new', 'local'])
    expect((await service.definition({ id: 'local' })).label).toBe('Replaced')
    expect(write).toHaveBeenCalledOnce()
    await expect(service.importDefinitions({ expectedRevision: revision, entries: [{ definition: { ...stdio, id: 'other' }, replace: false }] })).rejects.toThrow('stale-selection')
    expect(write).toHaveBeenCalledOnce()
  })
  it('tests an unsaved HTTP draft with entered headers without persisting or exposing its tools', async () => {
    const http = await startHttpMcpFixture()
    try {
      const { ctx, service, write } = await setup([])
      const ref = 'TPCOWORK_MCP_' + 'b'.repeat(32)
      const before = await service.inventory()
      const result = await service.probeDraft({ definition: { id: 'draft', label: 'Draft', origin: 'custom', enabled: true, transport: 'streamable-http', endpoint: http.url, credentials: [{ ref, target: 'header', key: 'Authorization' }] }, secretValues: { [ref]: 'Bearer DRAFT_PRIVATE_VALUE' } }, new AbortController().signal)
      expect(result).toEqual({ ok: true, toolCount: 1 })
      expect(http.authorization).toContain('Bearer DRAFT_PRIVATE_VALUE')
      expect(await service.inventory()).toEqual(before); expect(write).not.toHaveBeenCalled()
      expect(ctx.tools.schemas().some(tool => tool.name.startsWith('mcp__draft__'))).toBe(false)
    } finally { await http.close() }
  })
  it('CRUD uses DSH settings revisions, preserves custom entries and bundled removal tombstones', async () => {
    const bundled = mcp.defaultMcpDefinitions()
    const { service, removed, write } = await setup([...bundled, stdio])
    expect((await service.inventory()).items.filter(row => row.readiness.state === 'blocked')).toHaveLength(3)
    let revision = (await service.inventory()).revision
    await service.create({ expectedRevision: revision, definition: { ...stdio, id: 'manual' } })
    await expect(service.remove({ id: 'manual', expectedRevision: revision })).rejects.toThrow('stale-selection')
    revision = (await service.inventory()).revision
    await service.setEnabled({ id: 'manual', enabled: false, expectedRevision: revision })
    expect((await service.definition({ id: 'manual' })).enabled).toBe(false)
    await service.remove({ id: 'juyuan', expectedRevision: (await service.inventory()).revision })
    expect(removed()).toEqual(['juyuan'])
    expect((await service.inventory()).items.map(row => row.id)).toContain('local')
    expect(write).toHaveBeenCalledTimes(3)
    expect(bundled.map(row => row.id)).toEqual(['juyuan', 'caihui_mcp', 'playwright'])
    const old = (await service.inventory()).items.find(row => row.id === 'manual')!.configRevision
    await service.remove({ id: 'manual', expectedRevision: (await service.inventory()).revision })
    const recreated = await service.create({ definition: { ...stdio, id: 'manual' }, expectedRevision: (await service.inventory()).revision })
    expect(recreated.configRevision).toBeGreaterThan(old)
  })
  it('real stdio probe discovers tools, emits status, then withdraws all capabilities', async () => {
    const { ctx, service, call } = await setup()
    const states: string[] = []
    ctx.on('toolbox/changed', change => { if (change.domain === 'mcp') states.push(String(change.revision)) })
    ctx.on('mcp/connection-status', () => { throw new Error('fixture observer failure') })
    ctx.on('toolbox/changed', () => { throw new Error('fixture observer failure') })
    const result = await service.probe({ id: 'local' }, new AbortController().signal)
    expect(result.connection).toBe('disconnected'); expect(result.toolCount).toBe(2)
    expect(result.readiness.state).toBe('ready'); expect(states.length).toBeGreaterThanOrEqual(3)
    expect((await call('mcp__local__ping')).isError).toBe(true)
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('TOOLBOX_PRIVATE')
  })
  it('tests an unsaved stdio draft without changing the catalog and honors cancellation', async () => {
    const { service, ctx, write } = await setup([])
    const before = await service.inventory()
    expect(await service.probeDraft({ definition: stdio }, new AbortController().signal)).toEqual({ ok: true, toolCount: 2 })
    expect(await service.inventory()).toEqual(before)
    expect(write).not.toHaveBeenCalled()
    expect(ctx.tools.schemas().some(tool => tool.name.startsWith('mcp__local__'))).toBe(false)
    const cancelled = new AbortController(); cancelled.abort()
    expect(await service.probeDraft({ definition: stdio }, cancelled.signal)).toEqual({ ok: false, toolCount: 0 })
  })
  it('isolates tools, resources and instructions between concurrent tasks and enforces native permission', async () => {
    const { ctx, service, agent, call } = await setup()
    const a = agent('a'), b = agent('b')
    const abort = new AbortController()
    const lease = await service.openTask(task('a'), a.scope.ctx, abort.signal)
    expect((await call('mcp__local__ping', a.key)).value).toMatchObject({ content: [{ text: 'pong' }] })
    expect((await call('mcp__local__ping', b.key)).isError).toBe(true)
    expect((await call('list_mcp_resources', a.key, { server: 'local' })).isError).not.toBe(true)
    expect((await call('list_mcp_resources', b.key, { server: 'local' })).isError).toBe(true)
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: a.key }))).toContain('TOOLBOX_PRIVATE_INSTRUCTIONS')
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: b.key }))).not.toContain('TOOLBOX_PRIVATE_INSTRUCTIONS')
    const second = await service.openTask(task('b'), b.scope.ctx, new AbortController().signal)
    await lease.close()
    expect((await call('mcp__local__ping', b.key)).isError).not.toBe(true)
    await expect(service.openTask({ ...task('a'), mcp: [] }, a.scope.ctx, abort.signal)).rejects.toThrow('selection-fixed')
    let deny = () => {}
    const permission = await b.scope.ctx.plugin({ inject: ['tools'], apply(inner: Context) { deny = inner.tools.guard(() => 'permission-denied-by-test') } })
    expect((await call('mcp__local__ping', b.key)).isError).toBe(true)
    deny(); await permission.dispose(); await second.close()
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: b.key }))).not.toContain('TOOLBOX_PRIVATE_INSTRUCTIONS')
  })
  it('cancel and profile disable drain live connections; stale revisions cannot execute', async () => {
    const { service, agent, call } = await setup()
    const a = agent('a'), controller = new AbortController()
    const lease = await service.openTask(task('a'), a.scope.ctx, controller.signal)
    controller.abort(); await lease.close()
    expect((await call('mcp__local__ping', a.key)).isError).toBe(true)
    const b = agent('b')
    await service.openTask(task('b'), b.scope.ctx, new AbortController().signal)
    await service.setEnabled({ id: 'local', enabled: false, expectedRevision: (await service.inventory()).revision })
    expect((await call('mcp__local__ping', b.key)).isError).toBe(true)
    await expect(service.openTask(task('c'), agent('c').scope.ctx, new AbortController().signal)).rejects.toThrow('stale-config')
    expect((await service.inventory()).items[0]?.readiness.reasons[0]?.code).toBe('disabled')
    const probe = await service.probe({ id: 'local' }, new AbortController().signal)
    expect(probe.enabled).toBe(false); expect(probe.toolCount).toBe(2)
    expect((await call('mcp__local__ping', b.key)).isError).toBe(true)
  })
  it('switches capabilities for the next message on the same Agent while retaining each submitted pin', async () => {
    const { service, agent, call } = await setup()
    const a = agent('a'), signal = new AbortController().signal
    const first = task('a')
    const lease = await service.openTask(first, a.scope.ctx, signal)
    expect((await call('mcp__local__ping', a.key)).isError).not.toBe(true)
    await lease.close()
    const second = await service.openTask({ ...first, taskId: 'message-2', mcp: [] }, a.scope.ctx, signal)
    expect((await call('mcp__local__ping', a.key)).isError).toBe(true)
    await second.close()
    await expect(service.openTask({ ...first, mcp: [] }, a.scope.ctx, signal)).rejects.toThrow('selection-fixed')
    const restored = await service.openTask(first, a.scope.ctx, signal)
    expect((await call('mcp__local__ping', a.key)).isError).not.toBe(true)
    await restored.close()
  })
  it('Streamable HTTP performs real discovery and resolves refreshed header credentials only on Host', async () => {
    const http = await startHttpMcpFixture()
    try {
      const secrets = { CAIHUI_MCP_API_KEY: 'test-only-fixture-key' }
      const definition: McpDefinition = { id: 'http', label: 'HTTP', origin: 'custom', enabled: true, transport: 'streamable-http', endpoint: http.url, credentials: [{ ref: 'CAIHUI_MCP_API_KEY', target: 'header', key: 'Authorization' }] }
      const { ctx, service } = await setup([definition], secrets)
      expect((await service.probe({ id: 'http' }, new AbortController().signal)).toolCount).toBe(1)
      expect(http.authorization).toContain('test-only-fixture-key')
      secrets.CAIHUI_MCP_API_KEY = 'test-only-refreshed-key'
      await service.probe({ id: 'http' }, new AbortController().signal)
      expect(http.authorization).toContain('test-only-refreshed-key')
      const result = await ctx.typertGateway.invoke({ peer: ownerPeer(ctx),  namespace: 'toolboxMcp', method: 'inventory', args: {} })
      expect(JSON.stringify(result)).not.toContain('test-only-')
      expect(await ctx.typertGateway.invoke({ peer: ownerPeer(ctx),  namespace: 'toolboxMcp', method: 'definition', args: { request: { id: 'http' } } })).toEqual(definition)
    } finally { await http.close() }
  })
  it('abort or timeout of negotiation drains the transport and exposes no capability', async () => {
    const server = createServer(() => {})
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    try {
      const definition: McpDefinition = { id: 'hang', label: 'Hang', origin: 'custom', enabled: true, transport: 'streamable-http', endpoint: `http://127.0.0.1:${address.port}/mcp`, credentials: [] }
      const { service } = await setup([definition], {}, 100)
      const controller = new AbortController()
      const pending = service.probe({ id: 'hang' }, controller.signal)
      setTimeout(() => controller.abort(), 25)
      expect((await pending).connection).toBe('disconnected')
      expect((await service.probe({ id: 'hang' }, new AbortController().signal)).readiness.state).toBe('error')
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
  it('injects query credentials at connection time and a concurrent probe cannot hide a live task', async () => {
    const http = await startHttpMcpFixture()
    try {
      const definition = { ...mcp.defaultMcpDefinitions()[0]!, transport: 'streamable-http' as const, endpoint: http.url }
      const { service, agent } = await setup([definition], { JUYUAN_MCP_TOKEN: 'fixture+query/token' })
      const a = agent('a')
      const lease = await service.openTask(task('a', ['juyuan']), a.scope.ctx, new AbortController().signal)
      expect((await service.probe({ id: 'juyuan' }, new AbortController().signal)).connection).toBe('connected')
      expect((await service.inventory()).items[0]?.connection).toBe('connected')
      expect(http.urls.length).toBeGreaterThan(0)
      expect(http.urls.every(url => new URL(url, http.url).searchParams.get('token') === 'fixture+query/token')).toBe(true)
      expect(JSON.stringify(await service.definition({ id: 'juyuan' }))).not.toContain('fixture+')
      await lease.close()
      expect((await service.inventory()).items[0]?.connection).toBe('disconnected')
    } finally { await http.close() }
  })
  it('Agent owner disposal and module unload clean active task and pending probe', async () => {
    const { service, module, agent, call } = await setup()
    const a = agent('a')
    await service.openTask(task('a'), a.scope.ctx, new AbortController().signal)
    await a.scope.dispose()
    expect((await call('mcp__local__ping', a.key)).isError).toBe(true)
    expect((await service.inventory()).items[0]?.connection).toBe('disconnected')
    const b = agent('b')
    await service.openTask(task('b'), b.scope.ctx, new AbortController().signal)
    await module.dispose()
    expect((await call('mcp__local__ping', b.key)).isError).toBe(true)
    await expect(service.probe({ id: 'local' }, new AbortController().signal)).rejects.toThrow('disposed')
  })
  it('crash emits failure and task teardown removes resources, instructions and tools', async () => {
    const { service, ctx, agent, call } = await setup()
    const a = agent('a')
    const lease = await service.openTask(task('a'), a.scope.ctx, new AbortController().signal)
    await call('mcp__local__crash', a.key)
    await vi.waitFor(async () => expect((await service.inventory()).items[0]?.connection).toBe('error'))
    expect(lease.signal.aborted).toBe(true)
    await vi.waitFor(async () => expect((await call('mcp__local__ping', a.key)).isError).toBe(true))
    await lease.close()
    expect((await call('list_mcp_resources', a.key, { server: 'local' })).isError).toBe(true)
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: a.key }))).not.toContain('TOOLBOX_PRIVATE')
  })
  it('rejects inline URL credentials and redacts raw and encoded query/header values', () => {
    expect(() => parseDefinition({ ...mcp.defaultMcpDefinitions()[0], endpoint: 'https://example.invalid/mcp?token=fixture' })).toThrow('invalid-endpoint')
    const config = { transport: 'streamable-http' as const, serverName: 'test', url: 'https://example.invalid/mcp?token=fixture%2Btoken', headers: { 'x-api-key': 'fixture-header' }, toolCallTimeoutMs: 1000, failOnStartupError: true }
    const error = sanitizeMcpError(new Error('fixture+token fixture%2Btoken fixture-header https://example.invalid/mcp?token=fixture%2Btoken'), config)
    expect(error).not.toContain('fixture')
  })
})
