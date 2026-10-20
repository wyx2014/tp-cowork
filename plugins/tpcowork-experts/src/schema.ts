/** Durable records are validated again when replayed from a Session. */
import { z } from 'zod'
import type { TeamRunEvent } from '../../tpcowork-toolbox/src/contracts/teams.ts'

const id = z.string().min(1)
export const contextSchema = z.object({
  schemaVersion: z.literal(1), taskId: id, sessionId: id, submittedAt: z.number(), catalogRevision: z.number(),
  team: z.object({ id, version: id, workflowId: id }).strict().nullable(),
  skills: z.array(z.object({ id, version: id, fingerprint: id }).strict()).readonly(),
  mcp: z.array(z.object({ id, configRevision: z.number().int().positive() }).strict()).readonly(),
}).strict()
export const admissionSchema = z.object({ version: z.literal(1), requestId: id, context: contextSchema }).strict()
export const eventSchema = z.object({
  taskId: id, runId: id, sequence: z.number().int().positive(), at: z.number(),
  type: z.enum(['started', 'phase_started', 'phase_finished', 'member_started', 'member_progress', 'member_finished', 'artifact', 'settled']),
  phaseId: id.optional(), memberId: id.optional(),
  status: z.enum(['running', 'succeeded', 'partial', 'failed', 'cancelled', 'interrupted']).optional(),
  sessionEventId: id.optional(), artifactId: id.optional(),
}).strict().transform((value): TeamRunEvent => ({
  taskId: value.taskId, runId: value.runId, sequence: value.sequence, at: value.at, type: value.type,
  ...(value.phaseId === undefined ? {} : { phaseId: value.phaseId }), ...(value.memberId === undefined ? {} : { memberId: value.memberId }),
  ...(value.status === undefined ? {} : { status: value.status }), ...(value.sessionEventId === undefined ? {} : { sessionEventId: value.sessionEventId }),
  ...(value.artifactId === undefined ? {} : { artifactId: value.artifactId }),
}))
export const runSchema = z.object({
  version: z.literal(1), runId: id, context: contextSchema, startSeq: z.number().int().nonnegative(),
  workflowId: id.optional(), directory: id, researchDone: z.boolean(),
  settlement: z.object({ execution: z.enum(['running', 'succeeded', 'partial', 'failed', 'cancelled', 'interrupted']),
    delivery: z.enum(['pending', 'delivered', 'failed']), plan: z.enum(['open', 'reconciled']) }).strict(),
  code: id.optional(), events: z.array(eventSchema),
  artifacts: z.array(z.object({ id, path: id, kind: z.enum(['member', 'markdown', 'html']), sessionEventId: id.optional() }).strict()),
}).strict()
export type RunState = z.infer<typeof runSchema>
export type ExpertEvent = z.infer<typeof eventSchema>
export const snapshotSchema = z.object({ run: runSchema.nullable(), status: z.enum(['running', 'awaiting_delivery', 'awaiting_plan', 'completed', 'partial', 'failed', 'cancelled', 'interrupted']).nullable() }).strict()
export const contextRecord = 'plugin:tpcowork-experts/context'
export const selectionRecord = 'plugin:tpcowork-toolbox/selection'
export const runRecord = 'plugin:tpcowork-experts/run'

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:tpcowork-experts/context': { version: 1; requestId: string; context: z.infer<typeof contextSchema> }
    'plugin:tpcowork-toolbox/selection': { version: 1; requestId: string; context: z.infer<typeof contextSchema> }
    'plugin:tpcowork-experts/run': RunState
  }
}
