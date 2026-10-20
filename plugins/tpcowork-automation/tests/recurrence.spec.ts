import { describe, expect, it } from 'vitest'
import oracle from './fixtures/croniter.json'
import { nextCronRun, validCron } from '../src/cron.ts'
import { nextRunAt } from '../src/recurrence.ts'
import { scheduleSchema } from '../src/schemas.ts'

describe(`source CronService / croniter ${oracle.version} parity`, () => {
  it.each(oracle.cases)('$expression @ $reference [$timezone]', (entry) => {
    const { expression, reference, timezone, nextRunAt: expected } = entry
    const randomWord = 'randomWord' in entry ? () => entry.randomWord as number : undefined
    expect(nextCronRun(expression, Date.parse(reference), timezone, randomWord) ?? null).toBe(expected)
  })
  it.each(oracle.validity)('validity $expression = $valid', ({ expression, valid }) => {
    expect(validCron(expression)).toBe(valid)
    expect(scheduleSchema.safeParse({ frequency: 'custom', cronExpression: expression }).success).toBe(valid)
  })
  it('preserves the original expression, including case, spacing and macro', () => {
    for (const expression of ['0 9 * * MON-FRI', '@monthly', '* * * * * 15,25', '0 0 1 1 * 0 2028/2']) {
      expect(scheduleSchema.parse({ frequency: 'custom', cronExpression: expression }).cronExpression).toBe(expression)
    }
  })
  it('handles all eight frequencies and explicit once offsets', () => {
    const now = Date.parse('2026-01-30T09:10:00Z')
    const examples = [
      [{ frequency: 'once', at: '2026-02-01T09:00:00+08:00' }, '2026-02-01T01:00:00Z'],
      [{ frequency: 'hourly', time: { hour: 0, minute: 30 } }, '2026-01-30T09:30:00Z'],
      [{ frequency: 'daily' }, '2026-01-31T09:00:00Z'],
      [{ frequency: 'weekly' }, '2026-02-02T09:00:00Z'],
      [{ frequency: 'monthly', dayOfMonth: 31 }, '2026-01-31T09:00:00Z'],
      [{ frequency: 'weekdays' }, '2026-02-02T09:00:00Z'],
      [{ frequency: 'custom', everyMs: 1234 }, new Date(now + 1234).toISOString()],
      [{ frequency: 'manual' }, undefined],
    ] as const
    for (const [schedule, expected] of examples) expect(nextRunAt({ ...schedule, timezone: 'UTC' }, now)).toBe(expected ? Date.parse(expected) : undefined)
    expect(nextRunAt({ frequency: 'monthly', dayOfMonth: 31, timezone: 'UTC' }, Date.parse('2026-02-01T00:00:00Z'))).toBe(Date.parse('2026-03-31T09:00:00Z'))
  })
  it('rejects invalid rules and numeric timezone offsets with explicit business codes', () => {
    expect(() => nextRunAt({ frequency: 'custom', cronExpression: 'invalid' }, 0)).toThrow(expect.objectContaining({ code: 'automation/invalid_rule' }))
    expect(() => nextRunAt({ frequency: 'daily', timezone: '+08:00' }, 0)).toThrow(expect.objectContaining({ code: 'automation/invalid_timezone' }))
  })
})
