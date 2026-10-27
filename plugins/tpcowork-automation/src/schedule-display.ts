/** Project simple chat-created Cron rules into the editor's calendar controls. */
import type { ScheduleConfig } from './types.ts'

function numberIn(value: string, min: number, max: number): number | undefined {
  if (!/^\d{1,2}$/.test(value)) return undefined
  const number = Number(value)
  return number >= min && number <= max ? number : undefined
}

/** Only exact five-field equivalents are projected; saved Cron rules stay untouched. */
export function displaySchedule(schedule: ScheduleConfig): ScheduleConfig {
  if (schedule.frequency !== 'custom' || !schedule.cronExpression || schedule.everyMs !== undefined) return schedule
  const fields = schedule.cronExpression.trim().split(/\s+/)
  if (fields.length !== 5) return schedule
  const [minuteField, hourField, day, month, weekday] = fields as [string, string, string, string, string]
  const minute = numberIn(minuteField, 0, 59)
  if (minute === undefined || month !== '*') return schedule
  const base = { timezone: schedule.timezone }
  if (hourField === '*' && day === '*' && weekday === '*') {
    return { ...base, frequency: 'hourly', time: { hour: 0, minute } }
  }
  const hour = numberIn(hourField, 0, 23)
  if (hour === undefined) return schedule
  const time = { hour, minute }
  if (day === '*') {
    if (weekday === '*') return { ...base, frequency: 'daily', time }
    if (weekday === '1-5' || weekday.toUpperCase() === 'MON-FRI') return { ...base, frequency: 'weekdays', time }
    const names = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
    const dayOfWeek = numberIn(weekday, 0, 7) ?? names.indexOf(weekday.toUpperCase())
    if (dayOfWeek >= 0) return { ...base, frequency: 'weekly', time, dayOfWeek: dayOfWeek % 7 }
  } else if (weekday === '*') {
    const dayOfMonth = numberIn(day, 1, 31)
    if (dayOfMonth !== undefined) return { ...base, frequency: 'monthly', time, dayOfMonth }
  }
  return schedule
}
