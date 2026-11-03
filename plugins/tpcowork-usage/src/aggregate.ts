/**
 * Pure fold from durable session events to the Usage Stats snapshot. The rules follow the reference product's
 * App Usage builder: local days use the time zone's offset at `now`, ranges start a whole 7 or 30 days back, streaks
 * count back from today, and a session's length is the sum of its completed turns.
 */
import type { UsageHeatmapCell, UsageHeatmapWeek, UsageRange, UsageSnapshot } from './types.ts'

/** The slice of a session event this fold reads; structurally satisfied by `SessionEvent`. */
export interface UsageEvent {
  type: string
  /** Position in the session's raw log; events at or below a log's `seq` were already counted. */
  seq?: number
  time: number
  data: unknown
}
/** One assistant reply with usage: the compact row the store keeps instead of the whole event log. */
export interface UsageRecord { time: number; model: string | null; input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
/** One turn; `durationMs` is zero unless it completed. */
export interface TurnRecord { time: number; durationMs: number }
/** Turns still running are counted as turns without a finished length. */
export interface UsageSession { records: readonly UsageRecord[]; turns: readonly TurnRecord[]; tools: readonly number[]; open?: ReadonlyArray<readonly [turn: number, start: number]> }
/** A session's rows plus what the fold needs to continue with later events: the current model and running turns. */
export interface UsageLog { records: UsageRecord[]; turns: TurnRecord[]; tools: number[]; open: Array<[turn: number, start: number]>; model: string | null; seq: number }

interface Usage { inputTokens?: number; outputTokens?: number; totalTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
const DAY_MS = 86_400_000
const RANGE_DAYS: Record<Exclude<UsageRange, 'all'>, number> = { '7d': 7, '30d': 30 }
const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0

/** The time zone's offset from UTC at an instant; zero when the zone cannot be resolved. */
export function timeZoneOffsetMs(timeZone: string, at: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at))
    const part = (type: string) => Number(parts.find(item => item.type === type)?.value)
    return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) - Math.trunc(at / 1000) * 1000
  } catch {
    return 0
  }
}
/** A day index is a local midnight read as UTC, so its UTC calendar date is the local date. */
const dateOf = (dayIndex: number): string => new Date(dayIndex * DAY_MS).toISOString().slice(0, 10)

export const emptyLog = (): UsageLog => ({ records: [], turns: [], tools: [], open: [], model: null, seq: -1 })

/**
 * Fold one event into a session's rows; the only place that reads raw event payloads. Events the log has already
 * counted (by `seq`) are skipped, so a full read and the live feed can overlap safely.
 */
export function applyEvent(log: UsageLog, event: UsageEvent): void {
  if (typeof event.seq === 'number') {
    if (event.seq <= log.seq) return
    log.seq = event.seq
  }
  const data = event.data as { header?: { config?: { model?: unknown } }; usage?: Usage; turn?: unknown; reason?: { kind?: unknown };
    message?: { source?: { model?: unknown } } }
  if (event.type === 'request/header') {
    const next = data.header?.config?.model
    if (typeof next === 'string' && next !== '') log.model = next
  } else if (event.type === 'turn/start' && typeof data.turn === 'number') {
    log.open.push([data.turn, event.time])
  } else if (event.type === 'turn/end' && typeof data.turn === 'number') {
    const index = log.open.findIndex(([turn]) => turn === data.turn)
    if (index < 0) return
    const [[, start]] = log.open.splice(index, 1) as [[number, number]]
    log.turns.push({ time: start, durationMs: data.reason?.kind === 'completed' ? Math.max(0, event.time - start) : 0 })
  } else if (event.type === 'tool/call') {
    log.tools.push(event.time)
  } else if (event.type === 'assistant/message' && data.usage) {
    const usage = data.usage
    const input = finite(usage.inputTokens), output = finite(usage.outputTokens)
    const cacheRead = finite(usage.cacheReadTokens), cacheWrite = finite(usage.cacheWriteTokens)
    const total = finite(usage.totalTokens) || input + output
    if (total === 0) return
    // The reply names the model that produced it; the request header covers older logs without that source.
    const replied = data.message?.source?.model
    log.records.push({ time: event.time, model: typeof replied === 'string' && replied !== '' ? replied : log.model, input, output, cacheRead, cacheWrite, total })
  }
}

/** Fold a whole log. `skip` leading events (a fork's inherited prefix) only advance the seq, since they are the parent's usage. */
export function recordsOf(events: readonly UsageEvent[], skip = 0): UsageLog {
  const log = emptyLog()
  events.forEach((event, index) => {
    if (index >= skip) applyEvent(log, event)
    else if (typeof event.seq === 'number') log.seq = Math.max(log.seq, event.seq)
  })
  return log
}

function levelFor(tokens: number, max: number): UsageHeatmapCell['level'] {
  if (tokens <= 0 || max <= 0) return 0
  const ratio = tokens / max
  return ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1
}

/** Fold usage rows for one range; `now` is injected so the result is deterministic. */
export function aggregate(sessions: readonly UsageSession[], range: UsageRange, timeZone: string, now: number): UsageSnapshot {
  const offset = timeZoneOffsetMs(timeZone, now)
  const since = range === 'all' ? 0 : now - RANGE_DAYS[range] * DAY_MS
  const inRange = (time: number) => time >= since && time <= now
  const dayOf = (time: number) => Math.floor((time + offset) / DAY_MS)

  const days = new Map<number, { totalTokens: number; turnCount: number; toolCallCount: number }>()
  const day = (index: number) => {
    let value = days.get(index)
    if (!value) { value = { totalTokens: 0, turnCount: 0, toolCallCount: 0 }; days.set(index, value) }
    return value
  }
  const dayModels = new Map<number, Map<string | null, number>>()
  const models = new Map<string | null, { totalTokens: number; inputTokens: number; outputTokens: number; requestCount: number }>()
  const totals = { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
  let totalTurns = 0, totalSessions = 0, toolCallCount = 0, longestSessionMs = 0
  for (const session of sessions) {
    for (const record of session.records) {
      if (!inRange(record.time)) continue
      const index = dayOf(record.time)
      day(index).totalTokens += record.total
      const perModel = dayModels.get(index) ?? new Map<string | null, number>()
      perModel.set(record.model, (perModel.get(record.model) ?? 0) + record.total)
      dayModels.set(index, perModel)
      const row = models.get(record.model) ?? { totalTokens: 0, inputTokens: 0, outputTokens: 0, requestCount: 0 }
      row.totalTokens += record.total; row.inputTokens += record.input; row.outputTokens += record.output; row.requestCount += 1
      models.set(record.model, row)
      totals.totalTokens += record.total; totals.inputTokens += record.input; totals.outputTokens += record.output
      totals.cacheReadTokens += record.cacheRead; totals.cacheCreationTokens += record.cacheWrite
    }
    let sessionTurns = 0, sessionMs = 0
    for (const turn of [...session.turns, ...(session.open ?? []).map(([, time]) => ({ time, durationMs: 0 }))]) {
      if (!inRange(turn.time)) continue
      day(dayOf(turn.time)).turnCount += 1
      sessionTurns += 1
      sessionMs += turn.durationMs
    }
    if (sessionTurns > 0) { totalSessions += 1; totalTurns += sessionTurns; longestSessionMs = Math.max(longestSessionMs, sessionMs) }
    for (const time of session.tools) {
      if (!inRange(time)) continue
      day(dayOf(time)).toolCallCount += 1
      toolCallCount += 1
    }
  }

  const endDay = dayOf(now)
  const known = [...days.keys()]
  const startDay = range !== 'all' ? Math.floor((since + offset) / DAY_MS) : known.length ? Math.min(...known) : endDay
  // Streaks walk back from today: the current one ends at the first empty day, including an empty today.
  let activeDays = 0, currentStreakDays = 0, longestStreakDays = 0, running = 0, broken = false
  for (let index = endDay; index >= startDay; index--) {
    if ((days.get(index)?.totalTokens ?? 0) > 0) {
      activeDays++; running++
      longestStreakDays = Math.max(longestStreakDays, running)
      if (!broken) currentStreakDays++
    } else {
      broken = true
      running = 0
    }
  }
  const maxTokens = Math.max(0, ...[...days.values()].map(value => value.totalTokens))

  const weeks: UsageHeatmapWeek[] = []
  let week: Array<UsageHeatmapCell | null> = []
  for (let index = startDay; index <= endDay; index++) {
    const value = days.get(index)
    week.push({ date: dateOf(index), level: levelFor(value?.totalTokens ?? 0, maxTokens), totalTokens: value?.totalTokens ?? 0,
      turnCount: value?.turnCount ?? 0, toolCallCount: value?.toolCallCount ?? 0 })
    if (week.length === 7) { weeks.push({ weekIndex: weeks.length, days: week }); week = [] }
  }
  if (week.length) {
    while (week.length < 7) week.push(null)
    weeks.push({ weekIndex: weeks.length, days: week })
  }

  const dailyModelUsage: UsageSnapshot['dailyModelUsage'] = []
  for (let index = startDay; index <= endDay; index++) {
    const perModel = dayModels.get(index)
    dailyModelUsage.push({ date: dateOf(index), models: perModel ? [...perModel].map(([modelId, totalTokens]) => ({ modelId, totalTokens })) : [] })
  }
  const modelTotal = [...models.values()].reduce((sum, row) => sum + row.totalTokens, 0)
  const modelList = [...models].sort((a, b) => b[1].totalTokens - a[1].totalTokens)
    .map(([modelId, row]) => ({ modelId, ...row, share: modelTotal > 0 ? row.totalTokens / modelTotal : 0 }))
  const top = modelList[0]

  return {
    range, generatedAt: now, timeZone,
    summary: {
      ...totals, totalSessions, totalTurns, toolCallCount, activeDays, currentStreakDays, longestStreakDays, longestSessionMs,
      peakDayTokens: maxTokens,
      favoriteModel: top ? { modelId: top.modelId, totalTokens: top.totalTokens, share: top.share } : null,
    },
    heatmap: { startDate: dateOf(startDay), endDate: dateOf(endDay), maxTokens, weeks },
    dailyModelUsage, models: modelList,
  }
}
