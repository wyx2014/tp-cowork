import type { InstallRequest, InstallResult } from './installer.ts'
export interface TpcoworkHubSkill {
  id: string; name: string; description: string; versionId: string; version: string
  displayName?: string; tags?: string[]; visibility?: string; approvalStatus?: string
}
export interface TpcoworkHubFile { path: string; size: number; sha256: string; contentType: string }
export interface TpcoworkHubUser { id: string; username: string; name?: string }
export interface TpcoworkHubApi {
  account(): Promise<{ configured: boolean; writable: boolean; state?: 'unconfigured' | 'signed_out' | 'signed_in' | 'expired'; user?: TpcoworkHubUser }>
  /** System-browser authorization page and callback timeout; contains no credentials. */
  browserAuth(): Promise<{ loginUrl: string; timeoutMs: number }>
  /** Validate the website token with TpcoworkHub before saving the shared Host session. */
  acceptBrowserSession(request: { token: string }, signal?: AbortSignal): Promise<{ configured: boolean }>
  /** Host resolves the DSH credential reference. Encoding follows the deployed login protocol. */
  login(request: { username: string; passwordRef: string }, signal?: AbortSignal): Promise<{ configured: boolean }>
  logout(): Promise<void>
  list(request: { query?: string; cursor?: string }, signal?: AbortSignal): Promise<{ items: TpcoworkHubSkill[]; cursor?: string }>
  detail(request: { id: string; preview?: boolean }, signal?: AbortSignal): Promise<{ skill: TpcoworkHubSkill; fingerprint: string; files: TpcoworkHubFile[]; content?: string }>
  /** Authentication and file download stay on Host; delegates to toolboxInstaller.install. */
  install(request: InstallRequest & { source: { kind: 'tpcoworkhub'; skillId: string; versionId: string; fingerprint: string } }, signal?: AbortSignal): Promise<InstallResult>
  /** T5 must require an explicit user action; source resources come from the DSH skill inventory. */
  publish(request: { requestId: string; sourceSkillId: string; slug: string; displayName: string; version: string }, signal?: AbortSignal): Promise<{ skillId: string; versionId: string; fingerprint: string; fileCount: number }>
}
