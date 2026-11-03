import { describe, expect, it } from 'vitest'
import { compactTokens, duration, summaryTokens } from '../src/format.ts'
import { displayWeeks, heatmapColumns, monotonePath, monthLabels, pieSlices } from '../src/ui.tsx'
import { aggregate } from '../src/aggregate.ts'

const t = (key: string, params: Record<string, string | number> = {}) => `${key}:${Object.values(params).join('|')}`

describe('usage presentation', () => {
  it('formats tokens and durations as the reference does', () => {
    expect(compactTokens('en-US', 999)).toBe('999')
    expect(compactTokens('en-US', 17_900_000)).toBe('17.9M')
    expect(compactTokens('zh-CN', 17_900_000)).toBe('1790万')
    expect(summaryTokens('zh-CN', 12_345)).toBe('1.2 万')
    const units = { day: 'd', hour: 'h', minute: 'm' }
    expect(duration(5 * 60_000 + 30_000, units)).toBe('5 m')
    expect(duration(0, units)).toBe('0 m')
    expect(duration(26 * 3_600_000 + 60_000, units)).toBe('1 d 2 h 1 m')
  })

  it('merges models beyond six into an Other models slice', () => {
    const models = Array.from({ length: 8 }, (_, index) => ({ modelId: `m${index}`, totalTokens: 8 - index, share: 0, inputTokens: 0, outputTokens: 0, requestCount: 1 }))
    const { slices, total } = pieSlices(models, 'Other', id => id ?? '?')
    expect(total).toBe(36)
    expect(slices).toHaveLength(6)
    expect(slices.at(-1)).toMatchObject({ label: 'Other', totalTokens: 3 + 2 + 1 })
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1)
  })

  it('shows a full 52-week heatmap from Sunday, with weekly and cumulative columns filled from the bottom', () => {
    const now = Date.parse('2026-10-28T12:00:00Z')
    const session = { records: [{ time: now, model: 'm', input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 100 },
      { time: now - 8 * 86_400_000, model: 'm', input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 50 }], turns: [], tools: [] }
    const weeks = displayWeeks(aggregate([session], 'all', 'UTC', now).heatmap.weeks)
    expect(weeks).toHaveLength(52)
    expect(new Date(`${weeks[0]!.days[0]!.date}T00:00:00Z`).getUTCDay()).toBe(0)
    expect(weeks.at(-1)!.days.some(cell => cell?.date === '2026-10-28')).toBe(true)
    const weekly = heatmapColumns(weeks, 'weekly', t as never, 'en-US')
    // This week has the most tokens and fills its column; last week's half fills four of seven rows at level 2.
    expect(weekly.at(-1)!.cells.map(cell => cell.level)).toEqual([4, 4, 4, 4, 4, 4, 4])
    expect(weekly.at(-2)!.cells.map(cell => cell.level)).toEqual([0, 0, 0, 2, 2, 2, 2])
    const cumulative = heatmapColumns(weeks, 'cumulative', t as never, 'en-US')
    expect(cumulative.at(-1)!.cells.every(cell => cell.level === 4)).toBe(true)
    expect(monthLabels(weekly, 'en-US').filter(label => label.label).length).toBeLessThanOrEqual(12)
  })

  it('draws Recharts monotone curves through every point', () => {
    const path = monotonePath([[0, 10], [10, 0], [20, 10]])
    expect(path.startsWith('M0,10C')).toBe(true)
    expect(path.endsWith(',20,10')).toBe(true)
  })
})
