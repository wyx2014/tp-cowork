/** One Host installer is shared by local import, bundled resources and PromptHub. */
export type InstallSource =
  | { kind: 'bundled'; resourceId: string }
  | { kind: 'local'; importId: string }
  | { kind: 'prompthub'; skillId: string; versionId: string; fingerprint: string }
export interface InstallRequest {
  requestId: string
  source: InstallSource
  scope: { kind: 'user' } | { kind: 'project'; sessionId: string }
  conflict: 'reject' | 'replace-owned'
}
export interface InstallResult {
  operationId: string
  state: 'installed' | 'unchanged' | 'failed' | 'cancelled'
  skillId?: string
  fingerprint?: string
  error?: { code: string; message: string }
}
export interface InstallerApi {
  /** Validate paths/hashes and stage the entire resource tree before atomic publication to a DSH skill root. */
  install(request: InstallRequest): Promise<InstallResult>
  cancel(request: { operationId: string }): Promise<void>
}
