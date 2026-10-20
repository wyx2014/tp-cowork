import type { CredentialBinding, McpDefinition, McpEditorEntry, McpItem } from '../contracts/index.ts'
import { McpFormError, parseMcp } from './mcp-form.ts'

export interface McpPair { id: string; key: string; value: string; ref?: string }
export interface ServerForm {
  label: string; id: string; transport: 'stdio' | 'streamable-http'; command: string; args: string[]; cwd: string; endpoint: string
  auth: 'none' | 'bearer' | 'headers'; token: string; headers: McpPair[]; env: McpPair[]; query: McpPair[]
  connectTimeout: string; toolTimeout: string
}
export const newPair = (key = '', value = '', ref?: string): McpPair => ({ id: crypto.randomUUID(), key, value, ...(ref ? { ref } : {}) })
export function serverForm(definition?: McpDefinition): ServerForm {
  const pairs = (target: CredentialBinding['target']) => definition?.credentials.filter(row => row.target === target).map(row => newPair(row.key, '', row.ref)) ?? []
  return {
    label: definition?.label ?? '', id: definition?.id ?? '', transport: definition?.transport ?? 'streamable-http',
    command: definition?.transport === 'stdio' ? definition.command : 'npx', args: definition?.transport === 'stdio' ? [...definition.args] : [],
    cwd: definition?.transport === 'stdio' ? definition.cwd ?? '' : '', endpoint: definition?.transport === 'streamable-http' ? definition.endpoint : '',
    auth: pairs('header').length ? 'headers' : 'none', token: '', headers: pairs('header'), env: pairs('env'), query: pairs('url-query'),
    connectTimeout: String(definition?.connectTimeout ?? 15), toolTimeout: String(definition?.toolTimeout ?? 30),
  }
}
export function generatedMcpId(label: string, items: Pick<McpItem, 'id'>[]): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'mcp'
  let id = base
  while (items.some(item => item.id === id)) id = `${base}-${crypto.randomUUID().slice(0, 6)}`
  return id
}
export function serverValues(form: ServerForm, fallbackId: string, previous?: McpDefinition): McpEditorEntry {
  const credentials: CredentialBinding[] = []
  const secretValues: Record<string, string> = {}
  const add = (rows: McpPair[], target: CredentialBinding['target']) => {
    for (const row of rows) {
      if (!row.key.trim() && !row.value && !row.ref) continue
      if (!row.key.trim() || (!row.value && !row.ref)) throw new McpFormError('invalidMcpPairs')
      const ref = row.value ? `TPCOWORK_MCP_${crypto.randomUUID().replaceAll('-', '')}` : row.ref!
      credentials.push({ ref, key: row.key.trim(), target })
      if (row.value) secretValues[ref] = row.value
    }
  }
  if (form.transport === 'stdio') add(form.env, 'env')
  else {
    if (form.auth === 'headers') add(form.headers, 'header')
    if (form.auth === 'bearer') {
      if (!form.token.trim()) throw new McpFormError('invalidMcpToken')
      add([newPair('Authorization', `Bearer ${form.token.trim().replace(/^Bearer\s+/i, '')}`)], 'header')
    }
    add(form.query, 'url-query')
  }
  const definition = parseMcp({ id: form.id.trim() || fallbackId, label: form.label, transport: form.transport, command: form.command,
    args: form.args, cwd: form.cwd, endpoint: form.endpoint, credentials }, previous)
  if (!/^\d+$/.test(form.connectTimeout) || +form.connectTimeout < 1 || +form.connectTimeout > 300) throw new McpFormError('invalidMcpConnectTimeout')
  if (!/^\d+$/.test(form.toolTimeout) || +form.toolTimeout < 1 || +form.toolTimeout > 600) throw new McpFormError('invalidMcpToolTimeout')
  return { definition: { ...definition, connectTimeout: +form.connectTimeout, toolTimeout: +form.toolTimeout }, ...(Object.keys(secretValues).length ? { secretValues } : {}) }
}

export interface ImportRow { originalId: string; form: ServerForm; error?: string; conflict: boolean }
export function previewMcpImport(text: string, items: Pick<McpItem, 'id'>[]): ImportRow[] {
  if (new TextEncoder().encode(text).length > 1024 * 1024) throw new McpFormError('mcpImportTooLarge')
  let input: unknown
  try { input = JSON.parse(text) } catch { throw new McpFormError('invalidMcpImport') }
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  if (!object(input) || !object(input.mcpServers) || !Object.keys(input.mcpServers).length || Object.keys(input.mcpServers).length > 100) throw new McpFormError('invalidMcpImport')
  return Object.entries(input.mcpServers).map(([originalId, value]) => {
    const form = serverForm()
    form.id = originalId; form.label = originalId
    const row: ImportRow = { originalId, form, conflict: items.some(item => item.id === originalId) }
    try {
      if (!object(value)) throw new McpFormError('invalidMcpImport')
      if (value.type === 'sse' || value.transport === 'sse') throw new McpFormError('mcpUnsupportedTransport')
      form.label = String(value.display_name ?? value.displayName ?? originalId)
      form.transport = value.command ? 'stdio' : 'streamable-http'
      form.command = String(value.command ?? '')
      if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some(arg => typeof arg !== 'string'))) throw new McpFormError('invalidMcpArgs')
      form.args = value.args as string[] ?? []
      form.endpoint = String(value.url ?? value.endpoint ?? '')
      form.cwd = String(value.cwd ?? '')
      const pairs = (value: unknown) => {
        if (value === undefined) return []
        if (!object(value) || Object.values(value).some(item => typeof item !== 'string')) throw new McpFormError('invalidMcpPairs')
        return Object.entries(value).map(([key, value]) => newPair(key, value as string))
      }
      form.headers = pairs(value.headers); form.env = pairs(value.env)
      form.auth = form.headers.length ? 'headers' : 'none'
      form.connectTimeout = String(value.connect_timeout ?? value.connectTimeout ?? 15)
      form.toolTimeout = String(value.tool_timeout ?? value.toolTimeout ?? 30)
      serverValues(form, originalId)
    } catch (error) { row.error = error instanceof McpFormError ? error.key : 'invalidMcpImport' }
    return row
  })
}
