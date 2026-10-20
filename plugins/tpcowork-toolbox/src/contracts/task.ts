import type { TeamRef } from './teams.ts'
export interface TaskContext {
  readonly schemaVersion: 1
  readonly taskId: string
  readonly sessionId: string
  readonly submittedAt: number
  readonly catalogRevision: number
  readonly team: Readonly<TeamRef> | null
  readonly skills: ReadonlyArray<Readonly<{ id: string; version: string; fingerprint: string }>>
  readonly mcp: ReadonlyArray<Readonly<{ id: string; configRevision: number }>>
}
export interface TaskSettlement {
  execution: 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'interrupted'
  delivery: 'none' | 'pending' | 'delivered' | 'failed'
  plan: 'open' | 'reconciled'
}
export type TaskStatus = 'running' | 'awaiting_delivery' | 'awaiting_plan' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted'
