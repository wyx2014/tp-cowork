import type { Catalog, Readiness, RevisionRequest } from './common.ts'
import type { InstallRequest, InstallResult } from './installer.ts'

/** Inventory includes disabled installs; a winning registry entry alone cannot provide it. */
export interface SkillItem {
  id: string
  name: string
  description: string
  origin: 'bundled' | 'user' | 'project' | 'tpcoworkhub'
  provider: string
  version: string
  fingerprint: string
  installed: boolean
  enabled: boolean
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  readiness: Readiness
  /** Safe relative resource names, never credential contents. */
  resources: string[]
  /** Host-local entry location, for locating the actual personal or bundled resources. */
  path?: string
  /** Only unmodified trees owned by the installer can be updated or removed through it. */
  managed?: boolean
}
export interface SkillScope { sessionId?: string }
export interface SkillsApi {
  inventory(request: SkillScope): Promise<Catalog<SkillItem>>
  install(request: InstallRequest): Promise<InstallResult>
  remove(request: SkillScope & RevisionRequest & { id: string }): Promise<void>
  setEnabled(request: SkillScope & RevisionRequest & { id: string; enabled: boolean }): Promise<Catalog<SkillItem>>
  checkReadiness(request: SkillScope & { id: string }): Promise<SkillItem>
}
