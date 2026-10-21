/** Browser-safe editor catalog and navigation interfaces. */
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AutomationServiceApi } from './types.ts'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { PermissionCatalog } from '@deepseek-ai/dsh-permission-presets/types'
import type { AutomationCatalog } from './ui-state.ts'

export interface AutomationBindingsRequest { workspacePath?: string | undefined }
export interface AutomationBindingsValue {
  skills: { name: string; description: string }[]
  connectors: { name: string }[]
  skillsAvailable: boolean
}
export interface AutomationProject { id: WorkspaceId; name: string; path: string }
export interface AutomationExecutionOptions { models?: ModelCatalog; permissions?: PermissionCatalog }
export interface AutomationUiServices {
  automation: AutomationServiceApi
  /** Explicit user-confirmed ownership transfer, available only in the installed composition. */
  migrateNative?(): ReturnType<AutomationServiceApi['list']>
  /** Plugin-owned shared directory; standalone form fixtures may own a local catalog. */
  catalog?: AutomationCatalog
  bindings(request: AutomationBindingsRequest): Promise<AutomationBindingsValue>
  executionOptions?(): Promise<AutomationExecutionOptions>
  projects: { getSnapshot(): readonly AutomationProject[]; subscribe(listener: () => void): () => void }
  askAssistant(prompt: string): void
  /** Open an existing result after reading its history; a title update may fail independently. */
  openSession(id: SessionId, title: string, signal: AbortSignal): Promise<void>
}
