import { nextCronRun } from './cron.ts'
import { z } from 'zod'
import { AutomationError, parseInput } from './errors.ts'
import { scheduleSchema } from './schemas.ts'
import type { ScheduleConfig } from './types.ts'
const timingInput = z.object({ schedule: scheduleSchema })

/** Single calculator used for validation, CRUD, restart, resume and settlement. */
export function nextRunAt(input: ScheduleConfig, now: number): number | undefined {
  const { schedule } = parseInput(timingInput, { schedule: input })
  const { frequency } = schedule
  if (frequency === 'manual') return undefined
  if (frequency === 'once') { const at = Date.parse(schedule.at!); return at > now ? at : undefined }
  if (frequency === 'custom' && schedule.everyMs !== undefined) {
    const next = now + schedule.everyMs
    if (!Number.isSafeInteger(next) || next > 8.64e15) throw new AutomationError('invalid_rule', '自动化间隔超出时间范围。')
    return next
  }
  const hour = schedule.time?.hour ?? 9, minute = schedule.time?.minute ?? 0
  const expression = frequency === 'custom' ? schedule.cronExpression!
    : frequency === 'hourly' ? `${minute} * * * *`
    : frequency === 'weekly' ? `${minute} ${hour} * * ${schedule.dayOfWeek ?? 1}`
    : frequency === 'monthly' ? `${minute} ${hour} ${schedule.dayOfMonth ?? 1} * *`
    : frequency === 'weekdays' ? `${minute} ${hour} * * 1-5` : `${minute} ${hour} * * *`
  try { return nextCronRun(expression, now, schedule.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone) }
  catch (cause) { throw new AutomationError('invalid_rule', '自动化 Cron 规则无法计算。', { cause }) }
}
