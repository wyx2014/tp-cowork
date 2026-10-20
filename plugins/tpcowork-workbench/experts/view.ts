/** Browser-safe projection vocabulary, shared by the Host fold and Client panel. */
import type { z } from 'zod'
import type { snapshotSchema, RunState } from '../../tpcowork-experts/src/schema.ts'
export type ExpertsView = z.infer<typeof snapshotSchema>
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { tpcoworkExperts: ExpertsView | null }
  interface SessionProjectionStateMap { tpcoworkExperts: RunState | null }
}
