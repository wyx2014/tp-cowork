/** Croniter 6.2.4 compatibility for the source CronService's default options.
 * Calendar expansion and DST resolution adapted from croniter (MIT; licenses/croniter.txt).
 * No Python, process, network or Host dependency: validation also runs in the browser.
 */
const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6], [0, 59], [1970, 2099]] as const
const macros: Record<string, string> = {
  '@midnight': '0 0 * * *', '@hourly': '0 * * * *', '@daily': '0 0 * * *',
  '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *', '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *',
}
const months = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ')
const weekdays = 'sun mon tue wed thu fri sat'.split(' ')
type Field = { values: number[]; wildcard: boolean }
interface Rule {
  fields: Field[]
  lastDay: boolean
  nearest?: number
  nth: Map<number, Set<number | 'last'>>
}
const bad = (): never => { throw new Error('invalid_rule') }

/** Source has no hash_id (H is invalid). R is expanded afresh at each next-run computation. */
function parse(expression: string, randomWord: () => number = () => 0): Rule {
  const lower = expression.toLowerCase()
  const parts = (macros[lower] ?? lower).split(/\s+/).filter(Boolean)
  if (![5, 6, 7].includes(parts.length)) return bad()
  const rule: Rule = { fields: [], lastDay: false, nth: new Map() }
  const value = (text: string, index: number): number => {
    let n = /^\d+$/.test(text) ? Number(text)
      : index === 3 ? months.indexOf(text) + 1 : index === 4 ? weekdays.indexOf(text) : NaN
    // LOWMAP depends on expression length in croniter (including its six-field DOM alias).
    if (index === 2 && parts.length === 6 && n === 0) n = 1
    if (index === 4 && parts.length === 5 && n === 7) n = 0
    const [min, max] = ranges[index]!
    if (!Number.isInteger(n) || n < min || n > max) return bad()
    return n
  }
  parts.forEach((original, index) => {
    const [min, max] = ranges[index]!
    let text = original === '?' && (index === 2 || index === 4) ? '*' : original
    const random = /^r(?:\((\d+)-(\d+)\))?(?:\/(\d+))?$/.exec(text)
    if (random) {
      const begin = random[1] === undefined ? min : Number(random[1])
      const end = random[2] === undefined ? max : Number(random[2])
      const divisor = random[3] === undefined ? undefined : Number(random[3])
      if (begin >= end || divisor === 0) return bad()
      const width = divisor ?? end - begin + 1
      const selected = ((randomWord() >>> index) % width) + begin
      text = divisor === undefined ? String(selected) : `${selected}-${end}/${divisor}`
    }
    const values = new Set<number>()
    let wildcard = false
    for (let item of text.split(',')) {
      let nth: number | 'last' | undefined
      if (index === 4) {
        const match = /^(\w+|[a-z]{3}-[a-z]{3})#([1-5])$/.exec(item)
        const last = /^l(\d+)$/.exec(item)
        if (match) { item = match[1]!; nth = Number(match[2]) }
        else if (last) { item = last[1]!; nth = 'last' }
      }
      if (index === 2 && item === 'l') { rule.lastDay = true; continue }
      if (index === 2 && /^(\d+w|w\d+)$/.test(item)) {
        if (text.includes(',')) return bad()
        rule.nearest = value(item.replace('w', ''), index)
        values.add(rule.nearest)
        continue
      }
      if (item === '*') {
        wildcard = true
        for (let n = min; n <= max; n++) values.add(n)
        continue
      }
      const stepParts = item.split('/')
      if (stepParts.length > 2) return bad()
      const step = stepParts[1] === undefined ? 1 : Number(stepParts[1])
      if (!/^\d+$/.test(String(stepParts[1] ?? '1')) || !Number.isSafeInteger(step) || step <= 0) return bad()
      let band = stepParts[0]!
      if (band === '*') band = `${min}-${max}`
      else if (!band.includes('-') && stepParts.length === 2) band += `-${max}`
      const ends = band.split('-')
      if (ends.length > 2 || !ends[0]) return bad()
      const low = value(ends[0], index)
      const high = ends.length === 1 ? low : index === 2 && ends[1] === 'l' ? 31 : value(ends[1]!, index)
      const add = (n: number) => {
        values.add(n)
        if (nth !== undefined) {
          if (!rule.nth.has(n)) rule.nth.set(n, new Set())
          rule.nth.get(n)!.add(nth)
        }
      }
      if (ends.length === 1) add(low)
      else if (low === high) { for (let n = min; n <= max; n += step) add(n) }
      else if (low < high) { for (let n = low; n <= high; n += step) add(n) }
      else {
        let last = low
        for (let n = low; n <= max; n += step) { add(n); last = n }
        const skipped = max - last
        const start = last - min + step > max - min + 1 && skipped < step ? step - skipped : 0
        for (let n = min + start; n <= high; n += step) add(n)
      }
    }
    if (!values.size && !rule.lastDay) return bad()
    // Croniter keeps explicitly full DOM/DOW fields restricted when the other field lacks '*'.
    if (values.size === max - min + 1 && !(index === 2 && !parts[4]!.includes('*'))
      && !(index === 4 && !parts[2]!.includes('*'))) wildcard = true
    rule.fields.push({ values: [...values].sort((a, b) => a - b), wildcard })
  })
  if (rule.nth.size && rule.fields[4]!.values.some(n => !rule.nth.has(n)) && rule.fields[4]!.values.length !== 7) return bad()
  return rule
}

export function validCron(expression: string): boolean {
  try { parse(expression); return true } catch { return false }
}

const dayMs = 86_400_000
const all = (field: Field, value: number): boolean => field.wildcard || field.values.includes(value)
function nearestDay(year: number, month: number, requested: number): number {
  const end = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(requested, end)
  const dow = new Date(Date.UTC(year, month, day)).getUTCDay()
  return dow === 6 ? day === 1 ? 3 : day - 1 : dow === 0 ? day === end ? day - 2 : day + 1 : day
}

/** Search in wall-clock space, jumping larger calendar fields before smaller ones (50-year source limit). */
function nextWall(rule: Rule, base: number, branch: 'dom' | 'dow' | 'both'): number | undefined {
  const f = rule.fields
  const date = new Date(Math.floor(base / (f.length > 5 ? 1000 : 60_000)) * (f.length > 5 ? 1000 : 60_000) + (f.length > 5 ? 1000 : 60_000))
  const firstYear = date.getUTCFullYear()
  while (date.getUTCFullYear() - firstYear <= 50) {
    const year = date.getUTCFullYear(), month = date.getUTCMonth(), day = date.getUTCDate()
    if (f[6] && !all(f[6], year)) {
      const target = f[6].values.find(n => n > year)
      if (target === undefined) return undefined
      date.setUTCFullYear(target, 0, 1); date.setUTCHours(0, 0, 0, 0); continue
    }
    if (!all(f[3]!, month + 1)) { date.setUTCMonth(month + 1, 1); date.setUTCHours(0, 0, 0, 0); continue }
    const end = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const dom = rule.nearest !== undefined ? day === nearestDay(year, month, rule.nearest)
      : all(f[2]!, day) || rule.lastDay && day === end
    const dow = date.getUTCDay()
    const nth = rule.nth.get(dow)
    const week = rule.nth.size ? nth && (nth.has(Math.ceil(day / 7)) || nth.has('last') && day + 7 > end) : all(f[4]!, dow)
    // The source retains nth constraints in the DOM side of its day_or calculation.
    if ((branch !== 'dow' && !dom) || ((branch !== 'dom' || rule.nth.size) && !week)) {
      date.setUTCDate(day + 1); date.setUTCHours(0, 0, 0, 0); continue
    }
    const hour = date.getUTCHours(), minute = date.getUTCMinutes(), second = date.getUTCSeconds()
    if (!all(f[1]!, hour)) { date.setUTCHours(hour + 1, 0, 0, 0); continue }
    if (!all(f[0]!, minute)) { date.setUTCMinutes(minute + 1, 0, 0); continue }
    if (f[5] && !all(f[5], second)) {
      const target = f[5].values.find(n => n > second)
      date.setUTCSeconds(target ?? 60, 0); continue
    }
    return date.getTime()
  }
  return undefined
}

// Bounded formatter cache prevents arbitrary form input from retaining Intl objects indefinitely.
const formatters = new Map<string, Intl.DateTimeFormat>()
function wallAt(epoch: number, timezone: string): number {
  let formatter = formatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    if (formatters.size >= 32) formatters.delete(formatters.keys().next().value!)
    formatters.set(timezone, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(epoch).map(part => [part.type, part.value]))
  return Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!)
}
function offsetAt(epoch: number, timezone: string): number { return wallAt(epoch, timezone) - Math.floor(epoch / 1000) * 1000 }
function localize(wall: number, previous: number, timezone: string): { epoch: number; exists: boolean } {
  const offsets = new Set([-2, -1, 0, 1, 2].map(day => offsetAt(wall + day * dayMs, timezone)))
  for (let minutes = 0; minutes <= 24 * 60; minutes++) {
    const local = wall + minutes * 60_000
    const candidates = [...offsets].map(offset => local - offset).filter(epoch => wallAt(epoch, timezone) === local).sort((a, b) => a - b)
    if (candidates.length) return { epoch: candidates.find(epoch => epoch > previous) ?? candidates[0]!, exists: minutes === 0 }
  }
  return bad()
}
function nextZoned(rule: Rule, now: number, timezone: string, branch: 'dom' | 'dow' | 'both'): number | undefined {
  const base = wallAt(now, timezone) + now % 1000
  let wall = nextWall(rule, base, branch)
  if (wall === undefined) return undefined
  let resolved = localize(wall, now, timezone)
  while (!resolved.exists && (resolved.epoch <= now || rule.fields[1]!.wildcard)) {
    wall = nextWall(rule, wall, branch)
    if (wall === undefined) return undefined
    resolved = localize(wall, now, timezone)
  }
  const delta = offsetAt(resolved.epoch, timezone) - offsetAt(now, timezone)
  if (delta) {
    const alternative = nextWall(rule, base + delta, branch)
    if (alternative !== undefined) {
      const other = localize(alternative, now, timezone).epoch
      if (other > now && other < resolved.epoch) return other
    }
  }
  return resolved.epoch
}

/** Undefined is a valid exhausted/year-limited rule, just as _compute_next_run returns None. */
export function nextCronRun(expression: string, now: number, timezone: string,
  randomWord: () => number = () => Math.floor(Math.random() * 0x100000000)): number | undefined {
  const rule = parse(expression, randomWord)
  if (!rule.fields[2]!.wildcard && !rule.fields[4]!.wildcard) {
    // Source computes each side independently; an impossible branch exhausts the whole rule.
    const dom = nextZoned(rule, now, timezone, 'dom'), dow = nextZoned(rule, now, timezone, 'dow')
    return dom === undefined || dow === undefined ? undefined : Math.min(dom, dow)
  }
  return nextZoned(rule, now, timezone, 'both')
}
