import { describe, expect, it } from 'vitest'
import { aggregate, applyEvent, recordsOf, timeZoneOffsetMs } from '../src/aggregate.ts'

const NOW = Date.parse('2026-10-27T12:00:00Z')
const at = (day: string, hour = 10, minute = 0) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`)
const header = (model: string, time: number) => ({ type: 'request/header', time, data: { header: { config: { model } } } })
const reply = (time: number, turn: number, usage: object, model?: string) =>
  ({ type: 'assistant/message', time, data: { turn, usage, ...(model ? { message: { source: { model } } } : {}) } })
const turn = (number: number, start: number, end: number, kind = 'completed') => [
  { type: 'turn/start', time: start, data: { turn: number } },
  { type: 'turn/end', time: end, data: { turn: number, reason: { kind } } },
]
const tool = (time: number) => ({ type: 'tool/call', time, data: { name: 'web_search' } })

describe('usage aggregation', () => {
  const sessions = [
    recordsOf([header('m-a', 1), ...turn(1, at('2026-10-27'), at('2026-10-27', 10, 5)), reply(at('2026-10-27'), 1, { inputTokens: 10, outputTokens: 20 }),
      tool(at('2026-10-27')), ...turn(2, at('2026-10-26'), at('2026-10-26', 10, 3)), reply(at('2026-10-26'), 2, { inputTokens: 1, outputTokens: 1, totalTokens: 100 }, 'm-b')]),
    recordsOf([header('m-b', 1), ...turn(1, at('2026-10-10'), at('2026-10-10', 11), 'aborted'), reply(at('2026-10-10'), 1, { inputTokens: 40, outputTokens: 60 })]),
  ]

  it('takes the model from the reply, falling back to the request header', () => {
    expect(sessions[0]!.records.map(record => record.model)).toEqual(['m-a', 'm-b'])
    expect(sessions[0]!.turns).toEqual([{ time: at('2026-10-27'), durationMs: 300_000 }, { time: at('2026-10-26'), durationMs: 180_000 }])
    expect(sessions[1]!.turns[0]!.durationMs).toBe(0)
  })

  it('summarises all time like the reference: peak day, longest session from completed turns, streaks from today', () => {
    const { summary, models } = aggregate(sessions, 'all', 'UTC', NOW)
    expect(summary).toMatchObject({ totalTokens: 230, peakDayTokens: 100, longestSessionMs: 480_000, totalSessions: 2, totalTurns: 3,
      toolCallCount: 1, activeDays: 3, currentStreakDays: 2, longestStreakDays: 2 })
    expect(models.map(model => [model.modelId, model.totalTokens, model.requestCount])).toEqual([['m-b', 200, 2], ['m-a', 30, 1]])
    expect(summary.favoriteModel).toMatchObject({ modelId: 'm-b', share: 200 / 230 })
  })

  it('continues a stored log with live events, skipping any already counted', () => {
    const log = recordsOf([{ ...header('m-a', 1), seq: 0 }, { ...turn(1, at('2026-10-27'), 0)[0]!, seq: 1 }])
    expect(log).toMatchObject({ seq: 1, model: 'm-a', open: [[1, at('2026-10-27')]], turns: [] })
    // A running turn still counts as a turn.
    expect(aggregate([log], 'all', 'UTC', NOW).summary.totalTurns).toBe(1)
    const usage = { ...reply(at('2026-10-27', 10, 1), 1, { totalTokens: 9 }), seq: 2 }
    applyEvent(log, usage)
    applyEvent(log, usage)
    applyEvent(log, { ...turn(1, at('2026-10-27'), at('2026-10-27', 10, 2))[1]!, seq: 3 })
    expect(log.records).toEqual([{ time: at('2026-10-27', 10, 1), model: 'm-a', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 9 }])
    expect(log).toMatchObject({ seq: 3, open: [], turns: [{ time: at('2026-10-27'), durationMs: 120_000 }] })
  })

  it('skips a fork\'s inherited prefix but remembers its seq', () => {
    const log = recordsOf([{ ...reply(at('2026-10-27'), 1, { totalTokens: 50 }), seq: 0 }, { ...reply(at('2026-10-27'), 2, { totalTokens: 5 }), seq: 1 }], 1)
    expect(log.records.map(record => record.total)).toEqual([5])
    expect(log.seq).toBe(1)
  })

  it('ends the current streak on an empty today', () => {
    expect(aggregate(sessions, 'all', 'UTC', Date.parse('2026-10-28T12:00:00Z')).summary).toMatchObject({ currentStreakDays: 0, longestStreakDays: 2 })
  })

  it('starts a range a whole 7 days back and lists every day with its models', () => {
    const snapshot = aggregate(sessions, '7d', 'UTC', NOW)
    expect(snapshot.dailyModelUsage.map(day => day.date)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'])
    expect(snapshot.dailyModelUsage.at(-1)!.models).toEqual([{ modelId: 'm-a', totalTokens: 30 }])
    expect(snapshot.summary.totalTokens).toBe(130)
    expect(snapshot.heatmap.weeks).toHaveLength(2)
    expect(snapshot.heatmap.weeks[1]!.days.filter(Boolean)).toHaveLength(1)
    expect(snapshot.heatmap.weeks[0]!.days[6]).toMatchObject({ date: '2026-10-26', level: 4, turnCount: 1 })
  })

  it('buckets days in the caller time zone', () => {
    expect(timeZoneOffsetMs('Asia/Shanghai', NOW)).toBe(8 * 3_600_000)
    const late = [recordsOf([reply(Date.parse('2026-10-26T20:00:00Z'), 1, { totalTokens: 5 }, 'm')])]
    expect(aggregate(late, '7d', 'Asia/Shanghai', NOW).dailyModelUsage.at(-1)).toEqual({ date: '2026-10-27', models: [{ modelId: 'm', totalTokens: 5 }] })
  })

  it('returns an empty but well-formed snapshot', () => {
    const snapshot = aggregate([], '30d', 'UTC', NOW)
    expect(snapshot.summary.favoriteModel).toBeNull()
    expect(snapshot.dailyModelUsage).toHaveLength(31)
    expect(snapshot.summary.peakDayTokens).toBe(0)
  })
})
