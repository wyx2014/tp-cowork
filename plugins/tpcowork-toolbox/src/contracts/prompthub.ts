import type { InstallRequest, InstallResult } from './installer.ts'
export interface PromptHubSkill {
  id: string; name: string; description: string; versionId: string; version: string
  displayName?: string; tags?: string[]; visibility?: string; approvalStatus?: string
}
export interface PromptHubFile { path: string; size: number; sha256: string; contentType: string }
export interface PromptHubUser { id: string; username: string; name?: string }
export interface PromptHubApi {
  account(): Promise<{ configured: boolean; writable: boolean; state?: 'unconfigured' | 'signed_out' | 'signed_in' | 'expired'; user?: PromptHubUser }>
  /** System-browser authorization page and callback timeout; contains no credentials. */
  browserAuth(): Promise<{ loginUrl: string; timeoutMs: number }>
  /** Validate the website token with PromptHub before saving the shared Host session. */
  acceptBrowserSession(request: { token: string }, signal?: AbortSignal): Promise<{ configured: boolean }>
  /** Host resolves the DSH credential reference. Encoding follows the deployed login protocol. */
  login(request: { username: string; passwordRef: string }, signal?: AbortSignal): Promise<{ configured: boolean }>
  logout(): Promise<void>
  list(request: { query?: string; cursor?: string }, signal?: AbortSignal): Promise<{ items: PromptHubSkill[]; cursor?: string }>
  detail(request: { id: string; preview?: boolean }, signal?: AbortSignal): Promise<{ skill: PromptHubSkill; fingerprint: string; files: PromptHubFile[]; content?: string }>
  /** Authentication and file download stay on Host; delegates to toolboxInstaller.install. */
  install(request: InstallRequest & { source: { kind: 'prompthub'; skillId: string; versionId: string; fingerprint: string } }, signal?: AbortSignal): Promise<InstallResult>
  /** T5 must require an explicit user action; source resources come from the DSH skill inventory. */
  publish(request: { requestId: string; sourceSkillId: string; slug: string; displayName: string; version: string }, signal?: AbortSignal): Promise<{ skillId: string; versionId: string; fingerprint: string; fileCount: number }>
}
