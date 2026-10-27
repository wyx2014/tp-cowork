import { describe, expect, it } from 'vitest'
import { displaySchedule } from '../src/schedule-display.ts'
import { nextRunAt } from '../src/recurrence.ts'
import type { ScheduleConfig } from '../src/types.ts'

describe('simple Cron display projection', () => {
  it.each<[string, Partial<ScheduleConfig>]>([
    ['0 9 * * *', { frequency: 'daily', time: { hour: 9, minute: 0 } }],
    ['  05 09 * * *  ', { frequency: 'daily', time: { hour: 9, minute: 5 } }],
    ['15 * * * *', { frequency: 'hourly', time: { hour: 0, minute: 15 } }],
    ['30 8 * * 1-5', { frequency: 'weekdays', time: { hour: 8, minute: 30 } }],
    ['30 8 * * MON-FRI', { frequency: 'weekdays', time: { hour: 8, minute: 30 } }],
    ['0 17 * * 5', { frequency: 'weekly', time: { hour: 17, minute: 0 }, dayOfWeek: 5 }],
    ['0 17 * * FRI', { frequency: 'weekly', time: { hour: 17, minute: 0 }, dayOfWeek: 5 }],
    ['0 9 * * 0', { frequency: 'weekly', time: { hour: 9, minute: 0 }, dayOfWeek: 0 }],
    ['0 9 * * 7', { frequency: 'weekly', time: { hour: 9, minute: 0 }, dayOfWeek: 0 }],
    ['59 23 31 * *', { frequency: 'monthly', time: { hour: 23, minute: 59 }, dayOfMonth: 31 }],
    ['30 2 * * *', { frequency: 'daily', time: { hour: 2, minute: 30 } }],
  ])('projects %s without changing its next executions or the original rule', (cronExpression, expected) => {
    for (const timezone of ['Asia/Shanghai', 'America/New_York', 'Europe/Berlin']) {
      const rule: ScheduleConfig = { frequency: 'custom', cronExpression, timezone }
      const original = structuredClone(rule)
      const display = displaySchedule(rule)
      expect(display).toEqual({ ...expected, timezone })
      for (const at of ['2026-01-31T12:00:00Z', '2026-03-08T06:55:00Z', '2026-10-25T00:55:00Z', '2026-11-01T05:55:00Z']) {
        expect(nextRunAt(display, Date.parse(at))).toBe(nextRunAt(rule, Date.parse(at)))
      }
      expect(rule).toEqual(original)
    }
  })

  it.each([
    '@daily', '*/15 9-17 * * MON-FRI', '0 9 * * 1,3,5', '0 9 1 * MON',
    '0 9 * JAN *', '0 9 * * * 30', '0 9 * * * 0 2031', '0 9 L * *',
    '0 9 * * 5#2', '60 9 * * *', '0 24 * * *', '0 9 * * 8',
    '0 9 0 * *', '0 9 32 * *', 'invalid',
  ])('keeps %s in the custom editor', cronExpression => {
    const rule: ScheduleConfig = { frequency: 'custom', cronExpression, timezone: 'UTC' }
    expect(displaySchedule(rule)).toBe(rule)
  })

  it('keeps intervals and existing calendar schedules intact', () => {
    for (const rule of [
      { frequency: 'custom', everyMs: 86_400_000, timezone: 'UTC' },
      { frequency: 'custom', everyMs: 1000, cronExpression: '0 9 * * *' },
      { frequency: 'daily', time: { hour: 10, minute: 15 }, timezone: 'UTC' },
    ] satisfies ScheduleConfig[]) expect(displaySchedule(rule)).toBe(rule)
  })
})
