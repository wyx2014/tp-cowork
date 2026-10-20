/** Convert form wall time to an instant without computing the task's next run. */
export function wallTime(at: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at))
  const field = (type: string) => parts.find(part => part.type === type)!.value
  return `${field('year')}-${field('month')}-${field('day')}T${field('hour')}:${field('minute')}`
}
/** Reject DST gaps and choose the earlier instant in a fold, matching source date inputs. */
export function wallTimeInstant(input: string, timezone: string): string {
  const target = Date.parse(`${input}:00Z`)
  if (!Number.isFinite(target)) throw new Error('invalid date')
  const candidates = [-86400000, 0, 86400000].map(delta => {
    const sample = target + delta
    const offset = Date.parse(`${wallTime(new Date(sample).toISOString(), timezone)}:00Z`) - sample
    return target - offset
  }).filter(instant => wallTime(new Date(instant).toISOString(), timezone) === input)
  if (candidates.length) return new Date(Math.min(...candidates)).toISOString()
  throw new Error('nonexistent local date')
}
