import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type { McpConnectionStatus, Config as NativeConfig } from '@deepseek-ai/dsh-mcp-client'
import type { McpDefinition } from '../../contracts/mcp.ts'

/** Resolve only inside Host memory, once per operation; never persist the native config. */
async function nativeConfig(ctx: Context, definition: McpDefinition, secretValues: Record<string, string>): Promise<NativeConfig> {
  const env: Record<string, string> = {}; const headers: Record<string, string> = {}
  const url = definition.transport === 'streamable-http' ? new URL(definition.endpoint) : undefined
  for (const binding of definition.credentials) {
    let value: string | undefined
    try { value = secretValues[binding.ref] ?? (await ctx.get('credentials')?.resolve(credentialRef(binding.ref)))?.value }
    catch { throw new Error('toolbox/mcp-credentials-unavailable: 请检查 TP Cowork 凭证服务。') }
    if (!value) throw new Error('toolbox/mcp-needs-configuration: 请配置所需的 TP Cowork 凭证引用。')
    if (binding.target === 'env') env[binding.key] = value
    else if (binding.target === 'header') headers[binding.key] = value
    else url!.searchParams.set(binding.key, value)
  }
  const base = { serverName: definition.id, toolCallTimeoutMs: (definition.toolTimeout ?? 60) * 1000, failOnStartupError: true, reconnect: { enabled: false } }
  return definition.transport === 'stdio'
    ? { ...base, transport: 'stdio', command: definition.command, args: [...definition.args], cwd: definition.cwd ?? '', env }
    : { ...base, transport: 'streamable-http', url: url!.toString(), headers }
}

/** A disposable native DSH connection in an explicit registration scope. */
export async function connect(ctx: Context, definition: McpDefinition, signal: AbortSignal, timeoutMs: number,
  status: (snapshot: McpConnectionStatus) => void, secretValues: Record<string, string> = {}): Promise<{ close(): Promise<void> }> {
  signal.throwIfAborted()
  const config = await nativeConfig(ctx, definition, secretValues)
  signal.throwIfAborted()
  const scope = createScope(ctx, scopeOf(ctx) ?? {})
  let latest: McpConnectionStatus = { serverName: definition.id, state: 'connecting', generation: 0, toolCount: 0, observedAt: Date.now() }
  let stopping: Promise<void> | undefined
  const close = () => stopping ??= scope.dispose()
  const cancel = () => { void close().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  // Timeout bounds negotiation/discovery, not the lifetime of a ready task connection.
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; cancel() }, definition.connectTimeout === undefined ? timeoutMs : definition.connectTimeout * 1000)
  scope.ctx.on('mcp/connection-status', snapshot => { if (snapshot.serverName === definition.id) { latest = snapshot; status(snapshot) } })
  scope.ctx.effect(() => () => {
    signal.removeEventListener('abort', cancel)
    status({ ...latest, state: 'disconnected', toolCount: 0, observedAt: Date.now() })
  })
  try {
    await scope.ctx.plugin(McpClient, config)
    if (signal.aborted || stopping || timedOut) throw new Error('cancelled')
    return { close }
  } catch {
    await close()
    throw new Error(signal.aborted ? 'toolbox/mcp-cancelled: 连接已取消。' : 'toolbox/mcp-connect-failed: 请检查服务器、网络、传输和 TP Cowork 凭证，然后重新探测。')
  } finally { clearTimeout(timeout) }
}
