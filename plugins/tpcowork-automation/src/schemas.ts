/** Runtime validation at durable and Gateway inputs, kept safe for browser builds. */
import { z } from 'zod'
import { validCron } from './cron.ts'
import type { AutomationTaskId, AutomationRunId, ScheduledTask, ScheduleTasksPayload } from './types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

const identity = z.string().min(1).refine(value => value.trim() === value)
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const taskIdSchema = identity.transform(value => value as AutomationTaskId)
export const runIdSchema = identity.transform(value => value as AutomationRunId)
const sessionIdSchema = identity.transform(value => value as SessionId)
const projectIdSchema = identity.transform(value => value as WorkspaceId)
const timezoneSchema = z.string().min(1).superRefine((value, ctx) => {
  try {
    // Newer Intl accepts numeric offsets, but source ZoneInfo requires a named timezone.
    if (/^[+-]/.test(value)) throw new Error('offset is not an IANA timezone')
    new Intl.DateTimeFormat('en', { timeZone: value })
  }
  catch { ctx.addIssue({ code: 'custom', message: 'invalid_timezone' }) }
})
export const errorCodeSchema = z.enum(['invalid_input', 'invalid_timezone', 'invalid_rule', 'invalid_persistence',
  'storage_failure', 'task_not_found', 'run_not_found', 'task_running', 'run_running', 'runtime_unavailable',
  'service_stopping', 'run_interrupted', 'session_cleanup_failed', 'execution_failed'])

export const scheduleSchema = z.object({
  frequency: z.enum(['once', 'hourly', 'daily', 'weekly', 'monthly', 'weekdays', 'custom', 'manual']),
  at: z.iso.datetime({ offset: true }).optional(),
  time: z.object({ hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }).strict().optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  timezone: timezoneSchema.optional(),
  cronExpression: z.string().refine(validCron, 'invalid_rule').optional(),
  everyMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().superRefine((schedule, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message, path: ['frequency'] })
  if (schedule.frequency === 'once' && schedule.at === undefined) fail('invalid_rule: once requires at')
  if (schedule.frequency !== 'once' && schedule.at !== undefined) fail('invalid_rule: at requires once')
  if (schedule.frequency === 'custom') {
    if (Number(schedule.everyMs !== undefined) + Number(schedule.cronExpression !== undefined) !== 1) fail('invalid_rule: custom requires one selector')
  } else if (schedule.everyMs !== undefined || schedule.cronExpression !== undefined) fail('invalid_rule: custom selector requires custom')
  if (schedule.dayOfWeek !== undefined && schedule.frequency !== 'weekly') fail('invalid_rule: dayOfWeek requires weekly')
  if (schedule.dayOfMonth !== undefined && schedule.frequency !== 'monthly') fail('invalid_rule: dayOfMonth requires monthly')
})

const connectorSchema = z.object({
  name: identity, display_name: z.string().optional(), category: z.string().optional(), transport: z.string().optional(),
  status: z.string().optional(), configured: z.boolean().optional(), logo_url: z.string().nullable().optional(),
  brand_color: z.string().nullable().optional(),
}).strict()
export const draftSchema = z.object({
  name: z.string().trim().min(1), description: z.string().optional(), prompt: z.string().trim().min(1),
  schedule: scheduleSchema, skillName: z.string().optional(), workspacePath: z.string().optional(),
  mcpPresets: z.array(connectorSchema).max(8).refine(items => new Set(items.map(item => item.name)).size === items.length).optional(),
  projectId: projectIdSchema.optional(), executionMode: z.enum(['agent', 'reminder']).optional(),
  modelSelection: z.object({ provider: identity, model: identity, reasoningEffort: identity.optional() }).strict().optional(),
  permissionPreset: identity.optional(),
}).strict()
export const createSchema = draftSchema.extend({ originSessionId: sessionIdSchema.optional(), timezone: timezoneSchema.optional() })
export const taskRequestSchema = z.object({ id: taskIdSchema }).strict()
export const updateSchema = taskRequestSchema.extend({ data: draftSchema.extend({
  projectId: projectIdSchema.nullable().optional(), timezone: timezoneSchema.optional(),
  modelSelection: draftSchema.shape.modelSelection.unwrap().nullable().optional(),
  permissionPreset: identity.nullable().optional(),
}) })
export const runRequestSchema = z.object({ taskId: taskIdSchema, runId: runIdSchema }).strict()
export const beginRunSchema = z.object({
  taskId: taskIdSchema, trigger: z.enum(['scheduled', 'manual']), scheduledAt: timestamp.optional(),
}).strict()
export const bindRunSchema = runRequestSchema.extend({
  sessionId: sessionIdSchema, turnId: z.number().int().nonnegative().optional(), ownsSession: z.boolean(),
  conversationAvailable: z.boolean().optional(),
})
export const finishRunSchema = runRequestSchema.extend({
  status: z.enum(['completed', 'error', 'skipped']), resultType: z.enum(['conversation', 'none']),
  conversationAvailable: z.boolean(), unavailableReason: z.enum(['legacy', 'missing']).optional(),
  error: z.string().optional(), errorCode: errorCodeSchema.optional(), skippedReason: z.string().min(1).optional(),
  nextRunAt: timestamp.optional(),
  completedAt: timestamp.optional(),
}).superRefine((run, ctx) => {
  if (run.status === 'skipped' && !run.skippedReason) ctx.addIssue({ code: 'custom', message: 'skipped requires skippedReason' })
})

export const runSchema = z.object({
  id: runIdSchema, runId: runIdSchema, scheduledTaskId: taskIdSchema,
  conversationId: sessionIdSchema.optional(), sessionKey: sessionIdSchema.optional(), sessionId: sessionIdSchema.optional(),
  turnId: z.number().int().nonnegative().optional(), resultType: z.enum(['conversation', 'none']), conversationAvailable: z.boolean(),
  unavailableReason: z.enum(['legacy', 'missing']).optional(), startedAt: timestamp, completedAt: timestamp.optional(),
  status: z.enum(['running', 'completed', 'error']), error: z.string().optional(), errorCode: errorCodeSchema.optional(),
  viewedAt: timestamp.optional(), trigger: z.enum(['scheduled', 'manual']), scheduledAt: timestamp.optional(),
  skippedReason: z.string().min(1).optional(), ownsSession: z.boolean(),
  executionMode: z.enum(['agent', 'reminder']),
}).strict().superRefine((run, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (run.id !== run.runId) fail('run identities must agree')
  if (run.status === 'running' && (run.completedAt !== undefined || run.viewedAt !== undefined)) fail('running has no completion or viewed timestamp')
  if (run.status !== 'running' && (run.completedAt === undefined || run.completedAt < run.startedAt)) fail('terminal run requires a completion timestamp')
  if (run.resultType === 'none' && run.conversationAvailable) fail('none cannot expose a conversation')
  if (run.conversationAvailable && (!run.sessionId || run.conversationId !== run.sessionId || run.sessionKey !== run.sessionId || run.unavailableReason)) fail('available conversation requires matching Session aliases')
  if (run.sessionKey !== undefined && run.sessionKey !== run.sessionId) fail('sessionKey must match sessionId')
  if (run.conversationId !== undefined && run.conversationId !== run.sessionId) fail('conversationId must match sessionId')
  if ((run.ownsSession || run.turnId !== undefined) && !run.sessionId) fail('Session ownership and Turn require a Session')
  if (run.skippedReason && run.status !== 'completed') fail('skipped is displayed as completed')
  if (run.executionMode === 'reminder' && run.conversationAvailable) fail('reminder cannot expose a conversation')
  if (run.viewedAt !== undefined && (run.completedAt === undefined || run.viewedAt < run.completedAt)) fail('viewedAt must follow completion')
})

/** The same strict schema protects reads and writes, including referential integrity within a row. */
export const taskSchema: z.ZodType<ScheduledTask> = draftSchema.extend({
  id: taskIdSchema, status: z.enum(['active', 'paused', 'completed']), executionMode: z.enum(['agent', 'reminder']),
  originSessionId: sessionIdSchema.optional(), createdAt: timestamp, updatedAt: timestamp, lastRunAt: timestamp.optional(),
  nextRunAt: timestamp.optional(), runs: z.array(runSchema).max(20), totalRuns: z.number().int().nonnegative(),
}).superRefine((task, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (task.updatedAt < task.createdAt) fail('updatedAt precedes creation')
  if (task.runs.some(run => run.scheduledTaskId !== task.id)) fail('run belongs to another task')
  if (new Set(task.runs.map(run => run.id)).size !== task.runs.length) fail('duplicate run identity')
  if (task.runs.filter(run => run.status === 'running').length > 1) fail('task cannot have concurrent runs')
  if (task.totalRuns !== task.runs.length) fail('totalRuns must match retained history, as in source API')
  if (task.status !== 'active' && task.nextRunAt !== undefined) fail('inactive task cannot be armed')
  if (task.schedule.frequency === 'manual' && task.nextRunAt !== undefined) fail('manual task cannot be armed')
})
export const payloadSchema: z.ZodType<ScheduleTasksPayload> = z.object({
  tasks: z.array(taskSchema),
  status: z.object({ enabled: z.boolean(), jobs: z.number().int().nonnegative(), next_wake_at_ms: timestamp.nullable(),
    migration: z.object({ phase: z.enum(['waiting', 'interrupted', 'complete']), pending: z.number().int().nonnegative(), pausedOverdue: z.array(z.string()) }).strict().optional(),
  }).strict(),
}).strict()
