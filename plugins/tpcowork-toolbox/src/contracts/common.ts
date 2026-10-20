/** Facts come from DSH; selection and execution are separate, task-scoped facts. */
export interface Readiness {
  state: 'unknown' | 'checking' | 'ready' | 'blocked' | 'error'
  checkedAt?: number
  reasons: Array<{ code: string; message: string }>
}
export interface Catalog<T> {
  revision: number
  complete: boolean
  items: T[]
}
export interface RevisionRequest { expectedRevision: number }
/** Reference names only. Resolve values on the Host for each operation. */
export interface CredentialBinding {
  ref: string
  target: 'header' | 'env' | 'url-query'
  key: string
}
export interface Change {
  revision: number
  domain: 'skills' | 'mcp' | 'teams' | 'installer' | 'prompthub' | 'modules'
  id?: string
}
export type ChangeFrame = { type: 'ready' } | { type: 'changed'; change: Change }
export interface ToolboxDescription {
  contractVersion: 1
  modules: { skills: boolean; mcp: boolean; teams: boolean; installer: boolean; prompthub: boolean }
  defaultMcpIds: string[]
  userSkillsDirectory?: string | undefined
}
export interface ToolboxApi { describe(): Promise<ToolboxDescription> }
