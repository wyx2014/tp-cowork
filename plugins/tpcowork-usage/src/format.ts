/** Number and date presentation, as the reference product's Usage stats formats them. */

/** Compact token count: 万/亿 in Chinese, K/M/B in English, one decimal at most. */
export function compactTokens(locale: string, value: number): string {
  if (!Number.isFinite(value)) return ''
  return new Intl.NumberFormat(locale || undefined, { notation: Math.abs(value) >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(value)
}
/** The summary strip keeps a space before 万/亿, matching the spacing of its duration and day values. */
export function summaryTokens(locale: string, value: number): string {
  const text = compactTokens(locale, value)
  return locale.startsWith('zh') ? text.replace(/(?<=\d)(?=[万亿])/u, ' ') : text
}
export function compactNumber(locale: string, value: number): string {
  if (!Number.isFinite(value)) return '--'
  return new Intl.NumberFormat(locale, { notation: value >= 1000 ? 'compact' : 'standard', maximumFractionDigits: value >= 1000 ? 1 : 0 }).format(value)
}
export function percent(locale: string, value: number): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: value >= 0.1 ? 0 : 1 }).format(value)
}
const utc = (date: string) => new Date(`${date}T00:00:00.000Z`)
/** Short day for chart axes; an unparseable key is shown as it is. */
export function shortDay(locale: string, date: string): string {
  const value = utc(date)
  return Number.isNaN(value.getTime()) ? date : new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(value)
}
export function fullDay(locale: string, date: string): string {
  const value = utc(date)
  return Number.isNaN(value.getTime()) ? date : new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(value)
}
export function month(locale: string, date: string): string {
  const value = utc(date)
  return Number.isNaN(value.getTime()) ? date.slice(5, 7) : new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short' }).format(value)
}
/** Whole days, hours and minutes; under a minute reads as zero minutes. */
export function duration(ms: number, units: { day: string; hour: string; minute: string }): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  const parts: string[] = []
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60
  if (days > 0) parts.push(`${days} ${units.day}`)
  if (hours > 0) parts.push(`${hours} ${units.hour}`)
  if (rest > 0 || parts.length === 0) parts.push(`${rest} ${units.minute}`)
  return parts.join(' ')
}
