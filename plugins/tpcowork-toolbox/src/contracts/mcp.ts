import type { Catalog, CredentialBinding, Readiness, RevisionRequest } from './common.ts'

/** Editable public definition; literal credential values have no field in this contract. */
export type McpDefinition = {
  id: string
  label: string
  origin: 'bundled' | 'custom'
  enabled: boolean
  credentials: CredentialBinding[]
  connectTimeout?: number | undefined
  toolTimeout?: number | undefined
} & ({ transport: 'stdio'; command: string; args: string[]; cwd?: string }
  | { transport: 'streamable-http'; endpoint: string })

export interface McpItem {
  id: string
  label: string
  origin: 'bundled' | 'custom'
  configRevision: number
  installed: boolean
  enabled: boolean
  readiness: Readiness
  connection: 'unknown' | 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
  generation: number
  toolCount: number
  observedAt?: number
  /** Status badge only; neither endpoint queries nor resolved headers are returned. */
  credentials: Array<{ ref: string; configured: boolean; writable: boolean }>
}
export interface McpApi {
  /** Mutations use this catalog revision; item.configRevision only pins task configuration. */
  inventory(): Promise<Catalog<McpItem>>
  /** Public configuration only; credential bindings contain reference names, never resolved values. */
  definition(request: { id: string }): Promise<McpDefinition>
  create(request: RevisionRequest & McpEditorEntry): Promise<McpItem>
  update(request: RevisionRequest & McpEditorEntry): Promise<McpItem>
  importDefinitions(request: RevisionRequest & { entries: Array<McpEditorEntry & { replace: boolean }> }): Promise<Catalog<McpItem>>
  probeDraft(request: McpEditorEntry, signal: AbortSignal): Promise<{ ok: boolean; toolCount: number }>
  remove(request: RevisionRequest & { id: string }): Promise<void>
  setEnabled(request: RevisionRequest & { id: string; enabled: boolean }): Promise<McpItem>
  /** Real supervised connection/tool discovery, abortable and generation fenced. */
  probe(request: { id: string }, signal: AbortSignal): Promise<McpItem>
}

/** Write-only values. Public definitions and inventory never return these. */
export interface McpEditorEntry {
  definition: McpDefinition
  secretValues?: Record<string, string>
}
