/** Wire contract shared by the Host aggregator and the settings page; the reference product's App Usage snapshot. */
import { z } from 'zod'

export const USAGE_RANGES = ['all', '7d', '30d'] as const
export type UsageRange = (typeof USAGE_RANGES)[number]

export const usageRequestSchema = z.object({
  range: z.enum(USAGE_RANGES),
  timeZone: z.string().min(1).max(64).optional(),
}).strict()
export type UsageRequest = z.infer<typeof usageRequestSchema>

const count = z.number().nonnegative()
const model = z.object({ modelId: z.string().nullable(), totalTokens: count, share: z.number() })
const cell = z.object({
  date: z.string(),
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  totalTokens: count, turnCount: count, toolCallCount: count,
})

export const usageSnapshotSchema = z.object({
  range: z.enum(USAGE_RANGES),
  generatedAt: z.number(),
  timeZone: z.string(),
  summary: z.object({
    totalTokens: count, inputTokens: count, outputTokens: count, cacheReadTokens: count, cacheCreationTokens: count,
    totalSessions: count, totalTurns: count, toolCallCount: count, activeDays: count,
    currentStreakDays: count, longestStreakDays: count, longestSessionMs: count, peakDayTokens: count,
    favoriteModel: model.nullable(),
  }),
  /** Active days of the range in weeks of seven, the first starting on the range's first day. */
  heatmap: z.object({
    startDate: z.string().nullable(), endDate: z.string().nullable(), maxTokens: count,
    weeks: z.array(z.object({ weekIndex: z.number(), days: z.array(cell.nullable()) })),
  }),
  /** Every day of the range, with each model's tokens that day. */
  dailyModelUsage: z.array(z.object({ date: z.string(), models: z.array(z.object({ modelId: z.string().nullable(), totalTokens: count })) })),
  models: z.array(model.extend({ inputTokens: count, outputTokens: count, requestCount: count })),
}).strict()
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>
export type UsageHeatmapCell = z.infer<typeof cell>
export type UsageHeatmapWeek = UsageSnapshot['heatmap']['weeks'][number]

export interface UsageServiceApi { get(request: UsageRequest): Promise<UsageSnapshot> }
