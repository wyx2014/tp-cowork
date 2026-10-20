import type { Catalog, Readiness, RevisionRequest } from './common.ts'
import type { TaskContext } from './task.ts'
export interface TeamRef { id: string; version: string; workflowId: string }
export interface TeamItem extends TeamRef {
  name: string
  enabled: boolean
  members: Array<{ id: string; name: string; phase?: string; goal?: string }>
  requiredSkillIds: string[]
  optionalMcpIds: string[]
  readiness: Readiness
}
/** Owned by the composer until first submission. Never mutates a running task. */
export interface SelectionDraft extends RevisionRequest {
  team: TeamRef | null
  skillIds: string[]
  mcpIds: string[]
}
export interface TeamsApi { inventory(): Promise<Catalog<TeamItem>> }
export interface TeamRunEvent {
  taskId: string
  runId: string
  sequence: number
  at: number
  type: 'started' | 'phase_started' | 'phase_finished' | 'member_started' | 'member_progress' | 'member_finished' | 'artifact' | 'settled'
  phaseId?: string
  memberId?: string
  status?: 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'interrupted'
  /** References existing DSH session events/deliverables instead of copying content. */
  sessionEventId?: string
  artifactId?: string
}
/** Implemented by experts, never by toolbox or workbench. */
export interface ExpertsApi {
  start(request: { context: TaskContext; prompt: string }): Promise<{ runId: string }>
  cancel(request: { runId: string }): Promise<void>
  watch(request: { runId: string; afterSequence?: number }, signal: AbortSignal): AsyncIterable<TeamRunEvent>
}
/** Workbench projects real events and confirmed present results; it owns no executor. */
export interface WorkbenchConsumer { accept(event: TeamRunEvent): void }
