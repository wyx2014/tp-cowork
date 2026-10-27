/** Stored rules stay distinguishable in task cards without running the scheduler. */
import { describe, expect, it } from 'vitest'
import { scheduleDescription } from '../src/schedule-format.ts'
import { en, zh } from '../src/ui-locales.ts'
import type { ScheduleConfig } from '../src/types.ts'

describe('task schedule descriptions', () => {
  it.each<[ScheduleConfig, string]>([
    [{ frequency: 'manual' }, 'Manual'],
    [{ frequency: 'hourly', time: { hour: 17, minute: 5 }, timezone: 'UTC' }, 'Hourly :05'],
    [{ frequency: 'daily' }, 'Daily 09:00'],
    [{ frequency: 'weekdays', time: { hour: 8, minute: 30 }, timezone: 'Asia/Shanghai' }, 'Weekdays 08:30'],
    [{ frequency: 'weekly', dayOfWeek: 5, time: { hour: 17, minute: 0 } }, 'Weekly · Friday 17:00'],
    [{ frequency: 'monthly', dayOfMonth: 31, time: { hour: 23, minute: 59 } }, 'Monthly · day 31 23:59'],
    [{ frequency: 'custom', cronExpression: '0 9 * * *', timezone: 'Asia/Shanghai' }, 'Daily 09:00'],
    [{ frequency: 'custom', cronExpression: '0 9 * * MON-FRI', timezone: 'Europe/Berlin' }, 'Weekdays 09:00'],
    [{ frequency: 'custom', cronExpression: '0 9-17 * * MON-FRI', timezone: 'Europe/Berlin' }, 'Cron · 0 9-17 * * MON-FRI'],
    [{ frequency: 'custom', everyMs: 60_000 }, 'Every 1 minute'],
    [{ frequency: 'custom', everyMs: 120_000 }, 'Every 2 minutes'],
    [{ frequency: 'custom', everyMs: 123_456 }, 'Every 123,456 milliseconds'],
  ])('displays %j without modifying its parameters', (rule, description) => {
    const original = structuredClone(rule)
    expect(scheduleDescription(rule, key => en[key], 'en-US')).toBe(description)
    expect(rule).toEqual(original)
  })

  it('renders a once date in its saved timezone and localizes weekday names', () => {
    const rule: ScheduleConfig = { frequency: 'once', at: '2031-01-01T00:30:00Z', timezone: 'Asia/Shanghai' }
    const label = scheduleDescription(rule, key => en[key], 'en-US')
    expect(label).toContain('8:30 AM')
    expect(label).not.toContain('Asia/Shanghai')
    expect(scheduleDescription({ frequency: 'weekly', dayOfWeek: 0 }, key => zh[key], 'zh-CN')).toBe('每周 · 星期日 09:00')
    expect(scheduleDescription({ frequency: 'custom', everyMs: 120_000 }, key => zh[key], 'zh-CN')).toBe('每 2分钟')
  })
})
