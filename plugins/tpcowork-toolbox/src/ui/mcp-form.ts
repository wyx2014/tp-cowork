/** Parse only public configuration; credential values have no form field. */
import type { CredentialBinding, McpDefinition } from '../contracts/index.ts'
import { definitionSchema, parseDefinition } from '../host/mcp/schema.ts'
import type { UiKey } from './locales.ts'
export class McpFormError extends Error {
  constructor(readonly key: UiKey) { super('toolbox/invalid-form') }
}
const fieldErrors: Record<string, UiKey> = { id: 'invalidMcpId', label: 'invalidMcpName', command: 'invalidMcpCommand', args: 'invalidMcpArgs', cwd: 'invalidMcpCwd', endpoint: 'invalidMcpEndpoint', credentials: 'invalidMcpCredentials' }
export interface McpForm {
  id: string; label: string; transport: 'stdio' | 'streamable-http'; command: string; args: string | string[]; cwd: string; endpoint: string; credentials: CredentialBinding[]
}
export function mcpForm(definition?: McpDefinition): McpForm {
  return { id: definition?.id ?? '', label: definition?.label ?? '', transport: definition?.transport ?? 'streamable-http',
    command: definition?.transport === 'stdio' ? definition.command : '', args: definition?.transport === 'stdio' ? definition.args.join('\n') : '', cwd: definition?.transport === 'stdio' ? definition.cwd ?? '' : '',
    endpoint: definition?.transport === 'streamable-http' ? definition.endpoint : '', credentials: definition?.credentials.map(binding => ({ ...binding })) ?? [] }
}
export function parseMcp(form: McpForm, previous?: McpDefinition): McpDefinition {
  const common = { id: form.id, label: form.label.trim(), origin: previous?.origin ?? 'custom' as const, enabled: previous?.enabled ?? true, credentials: form.credentials.map(binding => ({ ...binding, ref: binding.ref.trim(), key: binding.key.trim() })) }
  const candidate = form.transport === 'stdio'
    ? { ...common, transport: 'stdio' as const, command: form.command.trim(), args: Array.isArray(form.args) ? [...form.args] : form.args ? form.args.split('\n') : [], ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}) }
    : { ...common, transport: 'streamable-http' as const, endpoint: form.endpoint.trim() }
  const parsed = definitionSchema.safeParse(candidate)
  if (!parsed.success) throw new McpFormError(fieldErrors[String(parsed.error.issues[0]?.path[0])] ?? 'invalidForm')
  // Stored definitions may be incomplete. The save entry requires a runnable
  // command/address; readiness and runtime admission remain authoritative in DSH.
  if (candidate.transport === 'stdio' && !candidate.command) throw new McpFormError('invalidMcpCommand')
  if (candidate.transport === 'streamable-http' && !candidate.endpoint) throw new McpFormError('invalidMcpEndpoint')
  try { return parseDefinition(parsed.data) }
  catch (error) {
    const code = error instanceof Error ? error.message.split(':')[0] : ''
    const key: UiKey = code === 'toolbox/mcp-invalid-binding' ? 'invalidMcpCredentials'
      : code === 'toolbox/mcp-invalid-endpoint' ? 'invalidMcpEndpoint'
        : code === 'toolbox/mcp-inline-credential' ? 'invalidMcpArgs' : 'invalidForm'
    // Never expose parser messages, invalid inputs or resolved credentials.
    throw new McpFormError(key)
  }
}
