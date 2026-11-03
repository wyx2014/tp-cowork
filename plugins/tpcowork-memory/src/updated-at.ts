/** The viewer's update stamp, after ZCode's `memoryUpdatedAt.ts`: relative within 30 minutes, then day words, weekday, date. */
type Translate = (key: 'justNow' | 'minutesAgo' | 'today' | 'yesterday' | 'weekday' | 'weekdayNames' | 'date' | 'dateMonthDay' | 'dateYearMonthDay', params?: Record<string, unknown>) => string

const MINUTE_MS = 60_000
const RELATIVE_MINUTES_LIMIT = 30

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * @param t - the memory namespace translator.
 * @param now - current time in milliseconds.
 * @param updatedAt - file modification time in milliseconds.
 * @returns the localized stamp.
 */
export function formatUpdatedAt(t: Translate, now: number, updatedAt: number): string {
  const elapsed = now - updatedAt
  if (!Number.isFinite(updatedAt) || elapsed < MINUTE_MS) return t('justNow')
  const minutes = Math.floor(elapsed / MINUTE_MS)
  if (minutes < RELATIVE_MINUTES_LIMIT) return t('minutesAgo', { count: minutes })
  const updated = new Date(updatedAt)
  const time = `${String(updated.getHours()).padStart(2, '0')}:${String(updated.getMinutes()).padStart(2, '0')}`
  const today = startOfDay(now)
  const day = startOfDay(updatedAt)
  if (day === today) return t('today', { time })
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (day === yesterday.getTime()) return t('yesterday', { time })
  const weekStart = new Date(today)
  weekStart.setDate(weekStart.getDate() - ((new Date(today).getDay() + 6) % 7))
  if (day >= weekStart.getTime()) return t('weekday', { time, weekday: t('weekdayNames').split(',')[updated.getDay()] ?? '' })
  const parts = { year: String(updated.getFullYear()), month: String(updated.getMonth() + 1), day: String(updated.getDate()) }
  const date = t(updated.getFullYear() === new Date(now).getFullYear() ? 'dateMonthDay' : 'dateYearMonthDay', parts)
  return t('date', { date, time })
}
