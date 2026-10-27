/** Display stored timing rules without calculating or changing the Host's schedule. */
import type { ScheduleConfig } from './types.ts'
import type { UiKey, UiText } from './ui-locales.ts'
import { displaySchedule } from './schedule-display.ts'

const weekdays: UiKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** @param schedule - Saved rule or editor draft. @param t - Localized copy. @param locale - Viewer locale. @returns Human-readable rule; dates use the saved timezone without exposing it in the label. */
export function scheduleDescription(schedule: ScheduleConfig, t: UiText, locale: string): string {
  schedule = displaySchedule(schedule)
  const frequency = t(schedule.frequency)
  if (schedule.frequency === 'manual') return frequency
  if (schedule.frequency === 'once' && schedule.at) {
    const at = new Date(schedule.at)
    if (!Number.isNaN(at.getTime())) {
      // The editor can contain an incomplete timezone before the Host validates it.
      try { return `${frequency} · ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: schedule.timezone }).format(at)}` }
      catch { return `${frequency} · ${schedule.at}` }
    }
    return frequency
  }
  if (schedule.frequency === 'custom') {
    if (schedule.cronExpression) return `${t('customCron').replace('{expression}', schedule.cronExpression)}`
    const everyMs = schedule.everyMs
    if (everyMs) {
      const unit = [
        { ms: 86_400_000, name: 'day' }, { ms: 3_600_000, name: 'hour' },
        { ms: 60_000, name: 'minute' }, { ms: 1000, name: 'second' }, { ms: 1, name: 'millisecond' },
      ].find(unit => everyMs % unit.ms === 0)!
      const duration = new Intl.NumberFormat(locale, { style: 'unit', unit: unit.name, unitDisplay: 'long' }).format(everyMs / unit.ms)
      return t('customEvery').replace('{duration}', duration)
    }
    return frequency
  }
  const time = schedule.time ?? { hour: 9, minute: 0 }
  const minute = String(time.minute).padStart(2, '0')
  if (schedule.frequency === 'hourly') return `${frequency} :${minute}`
  const clock = `${String(time.hour).padStart(2, '0')}:${minute}`
  if (schedule.frequency === 'weekly') return `${frequency} · ${t(weekdays[schedule.dayOfWeek ?? 1]!)} ${clock}`
  if (schedule.frequency === 'monthly') return `${frequency} · ${t('monthDay').replace('{day}', String(schedule.dayOfMonth ?? 1))} ${clock}`
  return `${frequency} ${clock}`
}

/** Relative next run text for the task cards; scheduling remains owned by the Host. */
export function relativeRunTime(at: number, locale: string, now = Date.now()): string {
  const seconds = Math.max(0, (at - now) / 1000)
  const [size, unit] = seconds >= 86400 ? [86400, 'day'] as const : seconds >= 3600 ? [3600, 'hour'] as const : [60, 'minute'] as const
  return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(Math.max(1, Math.ceil(seconds / size)), unit)
}
