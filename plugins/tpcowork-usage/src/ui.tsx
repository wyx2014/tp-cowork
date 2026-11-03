/**
 * Usage stats settings page, following the reference product's App usage panel one to one: the lifetime summary
 * strip, the 52-week token activity heatmap (daily, weekly, cumulative), the time range tabs, the daily per-model
 * trend chart and the model donut. Charts are plain SVG in place of the reference's Recharts, with the same geometry.
 */
import * as React from 'react'
const { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React
import { createPortal } from 'react-dom'
import { compactNumber, compactTokens, duration, fullDay, month, percent, shortDay, summaryTokens } from './format.ts'
import type { UsageKey } from './locales.ts'
import type { UsageHeatmapCell, UsageHeatmapWeek, UsageRange, UsageSnapshot } from './types.ts'

type Translate = (key: UsageKey, params?: Record<string, string | number>) => string
export interface UsagePageProps {
  t: Translate
  locale: string
  load: (range: UsageRange) => Promise<UsageSnapshot>
}

const HEATMAP_WEEKS = 52
const DAYS_PER_WEEK = 7
const DAY_MS = 86_400_000
const VISIBLE_MONTH_LABELS = 12
const MAX_MODELS = 6
const COLORS = Array.from({ length: MAX_MODELS }, (_, index) => `var(--tpu-chart-${index + 1})`)
const color = (index: number) => COLORS[index % COLORS.length]!
type ActivityMode = 'daily' | 'weekly' | 'cumulative'
const ACTIVITY_MODES: Array<[ActivityMode, UsageKey]> = [['daily', 'heatmapDaily'], ['weekly', 'heatmapWeekly'], ['cumulative', 'heatmapCumulative']]
const RANGES: Array<[Exclude<UsageRange, 'all'>, UsageKey]> = [['7d', 'range7d'], ['30d', 'range30d']]
const modelLabel = (t: Translate, modelId: string | null) => modelId?.trim() || t('unknownModel')

/** One hover hint for the page, drawn above its target like the reference's control hint tooltip. */
interface Hint { text: React.ReactNode; x: number; y: number; place: 'above' | 'cursor' }
function HintLayer({ hint }: { hint: Hint | null }) {
  const ref = useRef<HTMLDivElement>(null)
  // Keep the hint inside the window: one above an edge cell slides inward, one at the cursor flips to its other side.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || !hint) return
    element.style.marginLeft = element.style.marginTop = '0px'
    const rect = element.getBoundingClientRect()
    const gutter = 8
    const x = hint.place === 'above'
      ? Math.min(0, innerWidth - gutter - rect.right) + Math.max(0, gutter - rect.left)
      : rect.right > innerWidth - gutter ? -(rect.width + 20) : 0
    const y = hint.place === 'cursor' && rect.bottom > innerHeight - gutter ? -(rect.height + 20) : 0
    element.style.marginLeft = `${x}px`
    element.style.marginTop = `${y}px`
  }, [hint])
  if (!hint) return null
  const style: React.CSSProperties = hint.place === 'above'
    ? { left: hint.x, top: hint.y, transform: 'translate(-50%, calc(-100% - 2px))' }
    : { left: hint.x + 10, top: hint.y + 10 }
  return createPortal(<div ref={ref} className={hint.place === 'above' ? 'tpu-hint' : 'tpu-chart-tip'} role="tooltip" style={style}>{hint.text}</div>, document.body)
}
const above = (element: Element, text: string): Hint => {
  const rect = element.getBoundingClientRect()
  return { text, x: rect.left + rect.width / 2, y: rect.top, place: 'above' }
}

/**
 * The last snapshot per loader and range. As in the reference, reopening the page shows it at once while a fresh one
 * loads quietly; the page only shows its loading state when nothing has been loaded yet.
 */
const snapshots = new WeakMap<UsagePageProps['load'], Map<UsageRange, UsageSnapshot>>()
function useSnapshot(load: UsagePageProps['load'], range: UsageRange) {
  const cache = snapshots.get(load) ?? new Map<UsageRange, UsageSnapshot>()
  snapshots.set(load, cache)
  const [state, setState] = useState<{ snapshot: UsageSnapshot | null; loading: boolean; error: boolean }>(() => ({ snapshot: cache.get(range) ?? null, loading: true, error: false }))
  const request = useRef(0)
  const refresh = useCallback(async () => {
    const id = ++request.current
    setState(previous => ({ snapshot: cache.get(range) ?? (previous.snapshot?.range === range ? previous.snapshot : null), loading: true, error: false }))
    try {
      const snapshot = await load(range)
      cache.set(range, snapshot)
      if (request.current === id) setState({ snapshot, loading: false, error: false })
    } catch (error) {
      console.warn('[usage] load failed', error)
      if (request.current === id) setState(previous => ({ ...previous, loading: false, error: true }))
    }
  }, [load, range])
  useEffect(() => { void refresh() }, [refresh])
  return { ...state, refresh }
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

function Tabs<T extends string>({ value, options, onChange, t, label }: { value: T; options: Array<[T, UsageKey]>; onChange: (value: T) => void; t: Translate; label: string }) {
  return <div className="tpu-tabs" role="tablist" aria-label={label}>
    {options.map(([id, key]) => <button key={id} type="button" role="tab" aria-selected={value === id} data-active={value === id ? '' : undefined}
      className="tpu-tab" onClick={() => onChange(id)}>{t(key)}</button>)}
  </div>
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="tpu-empty"><div className="tpu-empty-title">{title}</div><div className="tpu-empty-text">{description}</div></div>
}

function SummaryStrip({ snapshot, t, locale }: { snapshot: UsageSnapshot | null; t: Translate; locale: string }) {
  const days = (value: number) => `${compactNumber(locale, value)} ${t('durationDay')}`
  const units = { day: t('durationDay'), hour: t('durationHour'), minute: t('durationMinute') }
  const items: Array<[UsageKey, string]> = [
    ['lifetimeTotalTokens', snapshot ? summaryTokens(locale, snapshot.summary.totalTokens) : '--'],
    ['lifetimePeakTokens', snapshot ? summaryTokens(locale, snapshot.summary.peakDayTokens) : '--'],
    ['longestSession', snapshot ? duration(snapshot.summary.longestSessionMs, units) : '--'],
    ['currentStreak', snapshot ? days(snapshot.summary.currentStreakDays) : '--'],
    ['longestStreak', snapshot ? days(snapshot.summary.longestStreakDays) : '--'],
  ]
  return <section className="tpu-summary">
    {items.map(([key, value], index) => <Fragment key={key}>
      {index > 0 ? <div aria-hidden="true" className="tpu-summary-divider" /> : null}
      <div className="tpu-summary-item"><div className="tpu-summary-value">{value}</div><div className="tpu-summary-label">{t(key)}</div></div>
    </Fragment>)}
  </section>
}

interface HeatmapColumn { key: string; monthDate: string; hint: string | null; cells: Array<{ key: string; level: number; hasUsage: boolean; hint: string | null }> }
const dayIndex = (date: string) => { const time = Date.parse(`${date}T00:00:00.000Z`); return Number.isNaN(time) ? null : Math.floor(time / DAY_MS) }
const dateKey = (index: number) => new Date(index * DAY_MS).toISOString().slice(0, 10)
const emptyCell = (date: string): UsageHeatmapCell => ({ date, level: 0, totalTokens: 0, turnCount: 0, toolCallCount: 0 })

/** Fill to 52 whole weeks ending with the current one, so every range shows a full year starting on Sundays. */
export function displayWeeks(weeks: readonly UsageHeatmapWeek[]): UsageHeatmapWeek[] {
  const cells = weeks.flatMap(week => week.days).filter((cell): cell is UsageHeatmapCell => cell !== null)
  const dated = cells.map(cell => ({ cell, index: dayIndex(cell.date) })).filter((entry): entry is { cell: UsageHeatmapCell; index: number } => entry.index !== null)
  if (!dated.length) return [...weeks]
  const byDate = new Map(dated.map(({ cell }) => [cell.date, cell]))
  const end = Math.max(...dated.map(({ index }) => index))
  const start = end - new Date(end * DAY_MS).getUTCDay() - (HEATMAP_WEEKS - 1) * DAYS_PER_WEEK
  return Array.from({ length: HEATMAP_WEEKS }, (_, weekIndex) => ({ weekIndex, days: Array.from({ length: DAYS_PER_WEEK }, (_, offset) => {
    const date = dateKey(start + weekIndex * DAYS_PER_WEEK + offset)
    return byDate.get(date) ?? emptyCell(date)
  }) }))
}
/** A column holding a month's first day belongs to that month, so labels sit over the 1st. */
const columnMonth = (week: UsageHeatmapWeek) => week.days.find(cell => cell?.date.endsWith('-01'))?.date ?? week.days[0]?.date ?? week.days.find(Boolean)?.date ?? ''
const levelOf = (value: number, max: number) => value <= 0 || max <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(value / max * 4)))
const rowsOf = (value: number, max: number) => value <= 0 || max <= 0 ? 0 : Math.min(DAYS_PER_WEEK, Math.max(1, Math.ceil(value / max * DAYS_PER_WEEK)))

export function heatmapColumns(weeks: readonly UsageHeatmapWeek[], mode: ActivityMode, t: Translate, locale: string): HeatmapColumn[] {
  const fill = (key: UsageKey, date: string, tokens: number, turns: number) =>
    t(key, { date: fullDay(locale, date), tokens: compactTokens(locale, tokens), turns: compactNumber(locale, turns) })
  if (mode === 'daily') {
    return weeks.map(week => ({ key: `daily-${week.weekIndex}`, monthDate: columnMonth(week), hint: null, cells: week.days.map((cell, offset) => {
      const shown = cell ?? emptyCell(week.days[0]?.date ?? `empty-${week.weekIndex}-${offset}`)
      return { key: `daily-${shown.date}`, level: shown.level, hasUsage: shown.totalTokens > 0, hint: fill('heatmapCell', shown.date, shown.totalTokens, shown.turnCount) }
    }) }))
  }
  const weekly = weeks.map(week => week.days.reduce((sum, cell) => sum + (cell?.totalTokens ?? 0), 0))
  const weeklyTurns = weeks.map(week => week.days.reduce((sum, cell) => sum + (cell?.turnCount ?? 0), 0))
  const running = (values: number[]) => values.reduce<number[]>((out, value) => { out.push((out.at(-1) ?? 0) + value); return out }, [])
  const values = mode === 'weekly' ? weekly : running(weekly)
  const turns = mode === 'weekly' ? weeklyTurns : running(weeklyTurns)
  const max = Math.max(0, ...values)
  return weeks.map((week, index) => {
    const value = values[index] ?? 0
    const level = levelOf(value, max), filled = rowsOf(value, max)
    const end = week.days[DAYS_PER_WEEK - 1]?.date ?? week.days.findLast(cell => cell !== null)?.date ?? ''
    return {
      key: `${mode}-${week.weekIndex}`, monthDate: columnMonth(week) || end,
      hint: fill(mode === 'weekly' ? 'heatmapWeeklyCell' : 'heatmapCumulativeCell', end, value, turns[index] ?? 0),
      cells: week.days.map((cell, offset) => {
        const on = offset >= DAYS_PER_WEEK - filled
        return { key: `${mode}-${cell?.date ?? `${week.weekIndex}-${offset}`}`, level: on ? level : 0, hasUsage: on && value > 0, hint: null }
      }),
    }
  })
}
/** 52 weeks can span 13 months; the oldest labels keep their span but lose their text, so at most 12 show. */
export function monthLabels(columns: readonly HeatmapColumn[], locale: string): Array<{ key: string; label: string; span: number }> {
  const labels: Array<{ key: string; label: string; span: number }> = []
  for (const column of columns) {
    const key = column.monthDate.slice(0, 7)
    const last = labels.at(-1)
    if (last?.key === key) last.span += 1
    else labels.push({ key, label: month(locale, column.monthDate), span: 1 })
  }
  for (let index = 0; index < labels.length - VISIBLE_MONTH_LABELS; index++) labels[index]!.label = ''
  return labels
}

function Heatmap({ weeks, t, locale, setHint }: { weeks: readonly UsageHeatmapWeek[]; t: Translate; locale: string; setHint: (hint: Hint | null) => void }) {
  const [mode, setMode] = useState<ActivityMode>('daily')
  const columns = useMemo(() => heatmapColumns(displayWeeks(weeks), mode, t, locale), [weeks, mode, t, locale])
  const labels = useMemo(() => monthLabels(columns, locale), [columns, locale])
  return <div className="tpu-card tpu-heatmap">
    <div className="tpu-heatmap-head">
      <h3 className="tpu-card-title">{t('heatmapTitle')}</h3>
      <Tabs value={mode} options={ACTIVITY_MODES} onChange={setMode} t={t} label={t('heatmapTitle')} />
    </div>
    <div className="tpu-heatmap-grid" data-mode={mode} onMouseLeave={() => setHint(null)}>
      {columns.map(column => <div key={column.key} className="tpu-heatmap-column"
        onMouseEnter={column.hint ? event => setHint(above(event.currentTarget, column.hint!)) : undefined}>
        {column.cells.map(cell => <div key={cell.key} className="tpu-heatmap-cell" data-usage={cell.hasUsage ? '' : undefined}
          style={{ backgroundColor: `var(--tpu-heatmap-${cell.level})` }}
          onMouseEnter={cell.hint ? event => setHint(above(event.currentTarget, cell.hint!)) : undefined} />)}
      </div>)}
    </div>
    <div className="tpu-heatmap-months">
      {labels.map(label => <div key={label.key} data-usage-heatmap-month-label="" style={{ gridColumn: `span ${label.span}` }}>{label.label}</div>)}
    </div>
  </div>
}

/** d3's monotone-x curve, which Recharts draws for `type="monotone"`. */
export function monotonePath(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length === 0) return ''
  const [first] = points
  if (points.length === 1) return `M${first![0]},${first![1]}`
  if (points.length === 2) return `M${first![0]},${first![1]}L${points[1]![0]},${points[1]![1]}`
  const sign = (value: number) => value < 0 ? -1 : 1
  const tangents = points.map(() => 0)
  for (let index = 1; index < points.length - 1; index++) {
    const [x0, y0] = points[index - 1]!, [x1, y1] = points[index]!, [x2, y2] = points[index + 1]!
    const h0 = x1 - x0, h1 = x2 - x1, s0 = (y1 - y0) / h0, s1 = (y2 - y1) / h1, p = (s0 * h1 + s1 * h0) / (h0 + h1)
    tangents[index] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
  }
  const edge = (from: number, to: number, neighbour: number) => {
    const [x0, y0] = points[from]!, [x1, y1] = points[to]!
    const h = x1 - x0
    return h ? (3 * (y1 - y0) / h - neighbour) / 2 : neighbour
  }
  tangents[0] = edge(0, 1, tangents[1]!)
  tangents[points.length - 1] = edge(points.length - 2, points.length - 1, tangents[points.length - 2]!)
  let path = `M${first![0]},${first![1]}`
  for (let index = 0; index < points.length - 1; index++) {
    const [x0, y0] = points[index]!, [x1, y1] = points[index + 1]!
    const dx = (x1 - x0) / 3
    path += `C${x0 + dx},${y0 + dx * tangents[index]!},${x1 - dx},${y1 - dx * tangents[index + 1]!},${x1},${y1}`
  }
  return path
}

/** Up to 14 days label every day; longer ranges label the ends and every 5th (or 7th past 45 days). */
const axisLabelShown = (index: number, total: number) => total <= 14 || index === 0 || index === total - 1 || index % (total > 45 ? 7 : 5) === 0
const CHART_HEIGHT = 240
const MARGIN = { top: 8, right: 24, bottom: 5, left: 24 }
const X_AXIS_HEIGHT = 30

function TrendChart({ snapshot, t, locale, setHint }: { snapshot: UsageSnapshot; t: Translate; locale: string; setHint: (hint: Hint | null) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const top = snapshot.models.slice(0, MAX_MODELS)
  const series = top.map((model, index) => ({ id: model.modelId, label: modelLabel(t, model.modelId), color: color(index) }))
  const rows = useMemo(() => snapshot.dailyModelUsage.map(day => {
    const values = series.map(item => day.models.filter(model => model.modelId === item.id).reduce((sum, model) => sum + model.totalTokens, 0))
    return { date: day.date, label: shortDay(locale, day.date), total: day.models.reduce((sum, model) => sum + model.totalTokens, 0), values }
  }), [snapshot, locale])
  // Separate lines, not a stack: the scale follows the highest single point so small series stay readable.
  const max = Math.max(0, ...rows.flatMap(row => row.values))
  const plotBottom = CHART_HEIGHT - MARGIN.bottom - X_AXIS_HEIGHT
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const x = (index: number) => MARGIN.left + (rows.length < 2 ? plotWidth / 2 : index * plotWidth / (rows.length - 1))
  const y = (value: number) => MARGIN.top + (1 - (max > 0 ? value / max : 0)) * (plotBottom - MARGIN.top)
  const unit = t('tokenUnit')
  const move = (event: React.MouseEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const step = rows.length < 2 ? plotWidth : plotWidth / (rows.length - 1)
    const index = Math.max(0, Math.min(rows.length - 1, Math.round((event.clientX - bounds.left) / (step || 1))))
    setActive(index)
    const row = rows[index]!
    const items = series.map((item, position) => ({ ...item, value: row.values[position] ?? 0 })).filter(item => item.value > 0)
    setHint(items.length === 0 ? null : { place: 'cursor', x: event.clientX, y: event.clientY, text: <>
      <div className="tpu-chart-tip-label">{`${row.label} - ${compactTokens(locale, row.total)} ${unit}`}</div>
      {items.map(item => <div key={item.label} className="tpu-chart-tip-row">
        <span className="tpu-dot" style={{ backgroundColor: item.color }} />
        <span className="tpu-chart-tip-name">{item.label}</span>
        <span className="tpu-chart-tip-value"><span className="tpu-mono">{compactTokens(locale, item.value)}</span> <span className="tpu-subtle">{unit}</span></span>
      </div>)}
    </> })
  }
  return <section className="tpu-card tpu-chart-card">
    <h3 className="tpu-card-title">{t('dailyChartTitle')}</h3>
    {max <= 0 ? <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} /> : <div className="tpu-chart-body">
      <div className="tpu-legend" role="list">
        {series.map(item => <div key={item.label} className="tpu-legend-item" role="listitem">
          <span className="tpu-swatch" style={{ backgroundColor: item.color }} /><span className="tpu-legend-label">{item.label}</span>
        </div>)}
      </div>
      <div ref={ref} className="tpu-chart">
        {width > 0 ? <svg width={width} height={CHART_HEIGHT} role="img" aria-label={t('dailyChartTitle')}>
          {[0, 0.25, 0.5, 0.75, 1].map(f => <line key={f} className="tpu-grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(max * f)} y2={y(max * f)} strokeDasharray="3 3" />)}
          {rows.map((row, index) => axisLabelShown(index, rows.length)
            ? <text key={row.date} className="tpu-axis" x={x(index)} y={plotBottom + 8} dy="0.71em" textAnchor="middle">{row.label}</text> : null)}
          {series.map((item, position) => <path key={item.label} d={monotonePath(rows.map((row, index) => [x(index), y(row.values[position] ?? 0)] as const))}
            fill="none" stroke={item.color} strokeWidth={2} />)}
          {active !== null ? series.map((item, position) => <circle key={item.label} cx={x(active)} cy={y(rows[active]?.values[position] ?? 0)} r={4}
            fill={item.color} stroke="var(--tpu-background)" strokeWidth={2} />) : null}
          <rect x={MARGIN.left} y={MARGIN.top} width={plotWidth} height={plotBottom - MARGIN.top} fill="transparent"
            onMouseMove={move} onMouseLeave={() => { setActive(null); setHint(null) }} />
        </svg> : null}
      </div>
    </div>}
  </section>
}

/** At most six slices: past six models, the tail merges into one "Other models" slice. */
export function pieSlices(models: UsageSnapshot['models'], other: string, label: (modelId: string | null) => string) {
  const positive = models.filter(model => model.totalTokens > 0)
  const total = positive.reduce((sum, model) => sum + model.totalTokens, 0)
  const merge = positive.length > MAX_MODELS
  const limit = merge ? MAX_MODELS - 1 : MAX_MODELS
  const slices = positive.slice(0, limit).map((model, index) => ({ key: `model${index}`, label: label(model.modelId), color: color(index),
    totalTokens: model.totalTokens, share: total > 0 ? model.totalTokens / total : 0 }))
  const rest = merge ? positive.slice(limit).reduce((sum, model) => sum + model.totalTokens, 0) : 0
  if (rest > 0) slices.push({ key: `model${limit}`, label: other, color: color(limit), totalTokens: rest, share: total > 0 ? rest / total : 0 })
  return { slices, total }
}

/** Recharts' sector: angles run counter-clockwise from 3 o'clock. */
function sector(cx: number, cy: number, inner: number, outer: number, start: number, end: number): string {
  const point = (radius: number, angle: number) => [cx + radius * Math.cos(-angle * Math.PI / 180), cy + radius * Math.sin(-angle * Math.PI / 180)] as const
  const sweep = end - start
  if (sweep >= 359.999) {
    const [a, b] = [point(outer, start), point(outer, start + 180)]
    const [c, d] = [point(inner, start), point(inner, start + 180)]
    return `M${a[0]},${a[1]}A${outer},${outer},0,1,0,${b[0]},${b[1]}A${outer},${outer},0,1,0,${a[0]},${a[1]}`
      + `M${c[0]},${c[1]}A${inner},${inner},0,1,1,${d[0]},${d[1]}A${inner},${inner},0,1,1,${c[0]},${c[1]}Z`
  }
  const large = sweep > 180 ? 1 : 0
  const [o1, o2, i1, i2] = [point(outer, start), point(outer, end), point(inner, end), point(inner, start)]
  return `M${o1[0]},${o1[1]}A${outer},${outer},0,${large},0,${o2[0]},${o2[1]}L${i1[0]},${i1[1]}A${inner},${inner},0,${large},1,${i2[0]},${i2[1]}Z`
}

function ModelPie({ snapshot, t, locale, setHint }: { snapshot: UsageSnapshot; t: Translate; locale: string; setHint: (hint: Hint | null) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [height, setHeight] = useState(224)
  useLayoutEffect(() => { if (ref.current) setHeight(ref.current.clientHeight) }, [width])
  const { slices, total } = useMemo(() => pieSlices(snapshot.models, t('otherModels'), id => modelLabel(t, id)), [snapshot, t])
  const unit = t('tokenUnit')
  const radius = Math.max(0, Math.min(width - 8, height - 8) / 2)
  const padding = slices.length > 1 ? 2 : 0
  const sweepTotal = 360 - padding * slices.length
  let angle = 0
  const arcs = slices.map(slice => {
    const start = angle, sweep = slice.share * sweepTotal
    angle += sweep + padding
    return { slice, d: sector(width / 2, height / 2, radius * 0.56, radius * 0.86, start, start + sweep) }
  })
  return <section className="tpu-card tpu-chart-card">
    <h3 className="tpu-card-title">{t('modelChartTitle')}</h3>
    {total <= 0 ? <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} /> : <div className="tpu-pie-body">
      <div className="tpu-pie">
        <div ref={ref} className="tpu-pie-canvas">
          {width > 0 ? <svg width={width} height={height} role="img" aria-label={t('modelChartTitle')} onMouseLeave={() => setHint(null)}>
            {arcs.map(({ slice, d }) => <path key={slice.key} d={d} fill={slice.color} stroke="var(--tpu-surface-solid)" strokeWidth={2} fillRule="evenodd"
              onMouseMove={event => setHint({ place: 'cursor', x: event.clientX, y: event.clientY, text: <div className="tpu-chart-tip-row">
                <span className="tpu-dot" style={{ backgroundColor: slice.color }} />
                <div className="tpu-pie-tip"><div className="tpu-chart-tip-name">{slice.label}</div>
                  <div className="tpu-pie-tip-values"><span><span className="tpu-mono">{compactTokens(locale, slice.totalTokens)}</span> <span className="tpu-subtle">{unit}</span></span>
                    <span className="tpu-mono tpu-subtle">{percent(locale, slice.share)}</span></div></div>
              </div> })} />)}
          </svg> : null}
        </div>
        <div className="tpu-pie-center"><div className="tpu-pie-total">{compactTokens(locale, total)}</div><div className="tpu-pie-unit">{unit}</div></div>
      </div>
      <div className="tpu-pie-legend" role="list">
        {slices.map(slice => <div key={slice.key} className="tpu-pie-row" role="listitem">
          <span className="tpu-swatch" style={{ backgroundColor: slice.color }} />
          <span className="tpu-pie-name">{slice.label}</span>
          <span className="tpu-pie-share">{percent(locale, slice.share)}</span>
          <span className="tpu-pie-tokens">{compactTokens(locale, slice.totalTokens)} {unit}</span>
        </div>)}
      </div>
    </div>}
  </section>
}

const RefreshIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
</svg>

export function UsagePage({ t, locale, load }: UsagePageProps) {
  const [range, setRange] = useState<Exclude<UsageRange, 'all'>>('7d')
  const [hint, setHint] = useState<Hint | null>(null)
  const lifetime = useSnapshot(load, 'all')
  const current = useSnapshot(load, range)
  useEffect(() => () => setHint(null), [])
  const rangeRow = <div className="tpu-range-row">
    <div className="tpu-range-title">{t('rangeTitle')}</div>
    <Tabs value={range} options={RANGES} onChange={setRange} t={t} label={t('rangeTitle')} />
  </div>
  const error = current.error ? <div role="alert" className="tpu-error">{t('error')}</div> : null
  let body: React.ReactNode
  if (current.loading && !current.snapshot) {
    body = <><SummaryStrip snapshot={lifetime.snapshot} t={t} locale={locale} />{rangeRow}
      <EmptyState title={t('loadingTitle')} description={t('loadingDescription')} /></>
  } else if (!current.snapshot) {
    body = <><SummaryStrip snapshot={lifetime.snapshot} t={t} locale={locale} />{rangeRow}{error}
      <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} /></>
  } else {
    body = <>
      <SummaryStrip snapshot={lifetime.snapshot} t={t} locale={locale} />
      {lifetime.snapshot?.heatmap.weeks.length ? <Heatmap weeks={lifetime.snapshot.heatmap.weeks} t={t} locale={locale} setHint={setHint} /> : null}
      {rangeRow}{error}
      <TrendChart key={`${current.snapshot.range}-${current.snapshot.generatedAt}`} snapshot={current.snapshot} t={t} locale={locale} setHint={setHint} />
      <ModelPie key={`pie-${current.snapshot.range}-${current.snapshot.generatedAt}`} snapshot={current.snapshot} t={t} locale={locale} setHint={setHint} />
      <div className="tpu-actions">
        <button type="button" className="tpu-refresh" onClick={() => { void Promise.all([current.refresh(), lifetime.refresh()]) }}><RefreshIcon />{t('refresh')}</button>
      </div>
    </>
  }
  return <div className="tpu-page" data-tpcowork-usage="" data-tpcowork-own-title="">
    <style>{USAGE_CSS}</style>
    <div className="tpu-header">
      <h2 className="tpu-title">{t('title')}</h2>
      <button type="button" className="tpu-pill" aria-pressed="true">{t('appUsage')}</button>
    </div>
    <div className="tpu-content">{body}</div>
    <HintLayer hint={hint} />
  </div>
}

/**
 * The reference's Tailwind classes in DSH tokens. The page draws its own heading row, so TP Cowork UI's section title
 * steps aside for `data-tpcowork-own-title`. `surface` is 3% ink, `border` 10%, `subtle` the secondary label;
 * chart and heatmap colours come from the plugin's light/dark theme layer (--tpu-chart-*, --tpu-heatmap-*).
 */
const USAGE_CSS = `
.tpu-page { --tpu-surface: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, transparent); --tpu-border: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);
  --tpu-border-hover: color-mix(in srgb, var(--dsw-alias-label-primary) 15%, transparent); --tpu-background: var(--dsw-alias-bg-base);
  --tpu-surface-solid: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, var(--dsw-alias-bg-base));
  --tpu-heatmap-0: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, transparent);
  display: flex; flex-direction: column; gap: 32px; min-width: 0; color: var(--dsw-alias-label-primary); font-size: 14px; }
.tpu-header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-width: 0; }
.tpu-title { margin: 0; font-size: 30px; line-height: 36px; font-weight: 600; letter-spacing: -0.025em; color: var(--dsw-alias-label-primary); }
.tpu-pill { padding: 4px 12px; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent);
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 20px; font-weight: 500; cursor: default; }
.tpu-content { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.tpu-summary { display: flex; flex-direction: column; overflow: hidden; border-radius: 12px; background: var(--tpu-surface); }
.tpu-summary-divider { display: none; width: 1px; height: 28px; flex: none; background: var(--tpu-border); }
.tpu-summary-item { flex: 1; min-width: 0; padding: 12px 16px; text-align: center; }
.tpu-summary-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; line-height: 24px; font-weight: 500; }
.tpu-summary-label { margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 20px; }
@media (min-width: 640px) { .tpu-summary { flex-direction: row; align-items: center; } .tpu-summary-divider { display: block; } }
.tpu-card { border-radius: 12px; background: var(--tpu-surface); }
.tpu-card-title { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; font-weight: 500; }
.tpu-heatmap { padding: 12px; }
.tpu-heatmap-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.tpu-heatmap-grid, .tpu-heatmap-months { display: grid; grid-template-columns: repeat(52, minmax(0, 1fr)); column-gap: 2px; width: 100%; }
.tpu-heatmap-column { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tpu-heatmap-cell { box-sizing: border-box; aspect-ratio: 1; width: 100%; min-width: 0; border: 1px solid transparent; border-radius: 4px; transition: transform 150ms; }
.tpu-heatmap-cell[data-usage] { border-color: var(--tpu-border); }
.tpu-heatmap-cell:hover { transform: scale(1.1); border-color: var(--tpu-border-hover); }
.tpu-heatmap-grid:not([data-mode="daily"]) .tpu-heatmap-column:hover .tpu-heatmap-cell { border-color: var(--tpu-border-hover); }
.tpu-heatmap-months { margin-top: 12px; }
.tpu-heatmap-months > div { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 16px; }
.tpu-tabs { display: flex; flex: none; box-sizing: border-box; height: 28px; padding: 2px; border-radius: 999px; background: var(--tpu-surface); }
.tpu-tab { flex: none; height: 24px; padding: 0 10px; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 16px; font-weight: 500; cursor: pointer; outline: none; }
.tpu-tab:focus-visible { box-shadow: 0 0 0 2px var(--tpu-border-hover); }
.tpu-tab[data-active] { background: var(--tpu-background); color: var(--dsw-alias-label-primary); }
.tpu-range-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.tpu-range-title { font-size: 14px; line-height: 20px; font-weight: 500; }
.tpu-chart-card { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.tpu-chart-body { padding: 12px; }
.tpu-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 12px; }
.tpu-legend-item { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; line-height: 16px; }
.tpu-legend-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); }
.tpu-swatch { width: 10px; height: 10px; flex: none; border-radius: 4px; }
.tpu-dot { width: 8px; height: 8px; flex: none; align-self: center; border-radius: 999px; }
.tpu-chart { width: 100%; height: 240px; }
.tpu-chart svg, .tpu-pie-canvas svg { display: block; overflow: visible; }
.tpu-grid { stroke: color-mix(in srgb, var(--tpu-border) 50%, transparent); }
.tpu-axis { fill: var(--dsw-alias-label-secondary); font-size: 12px; }
.tpu-hint { position: fixed; z-index: 2147483000; box-sizing: border-box; width: max-content; max-width: min(28rem, calc(100vw - 1rem)); padding: 4px 10px; border: 1px solid var(--tpu-border, rgba(13,13,13,.1));
  border-radius: 8px; background: var(--tpu-tooltip); color: var(--tpu-tooltip-foreground); font-size: 12px; line-height: 16px; font-weight: 500;
  white-space: pre-line; overflow-wrap: break-word; pointer-events: none; }
.tpu-chart-tip { position: fixed; z-index: 2147483000; display: grid; width: max-content; gap: 6px; min-width: 128px; padding: 6px 10px; border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent);
  border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: 0 20px 25px -5px rgb(0 0 0 / .1), 0 8px 10px -6px rgb(0 0 0 / .1);
  font-size: 12px; line-height: 1.625; pointer-events: none; }
.tpu-chart-tip-label { font-weight: 500; }
.tpu-chart-tip-row { display: flex; align-items: stretch; gap: 8px; }
.tpu-chart-tip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); flex: 1; }
.tpu-chart-tip-value { display: flex; align-items: baseline; gap: 4px; }
.tpu-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 500; font-variant-numeric: tabular-nums; }
.tpu-subtle { color: var(--dsw-alias-label-secondary); }
.tpu-pie-tip { display: grid; gap: 4px; min-width: 0; flex: 1; }
.tpu-pie-tip-values { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tpu-pie-body { display: grid; gap: 16px; padding: 12px; }
@media (min-width: 768px) { .tpu-pie-body { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.tpu-pie { position: relative; align-self: center; width: 100%; max-width: 256px; height: 224px; margin: 0 auto; }
.tpu-pie-canvas { position: relative; z-index: 20; width: 100%; height: 100%; }
@media (min-width: 768px) { .tpu-pie { max-width: 288px; height: 256px; } }
.tpu-pie-center { position: absolute; inset: 0; z-index: 10; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 32px;
  text-align: center; pointer-events: none; font-size: 12px; line-height: 16px; }
.tpu-pie-total { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.tpu-pie-unit { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); }
.tpu-pie-legend { align-self: center; min-width: 0; }
.tpu-pie-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 4px 8px; padding: 8px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--tpu-border) 70%, transparent); font-size: 12px; line-height: 16px; }
.tpu-pie-row:last-child { border-bottom: 0; }
.tpu-pie-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.tpu-pie-share { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
.tpu-pie-tokens { grid-column-start: 2; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); }
.tpu-empty { padding: 40px 16px; border: 1px dashed var(--tpu-border); border-radius: 12px; text-align: center; }
.tpu-empty-title { font-size: 14px; line-height: 20px; font-weight: 500; }
.tpu-empty-text { margin-top: 8px; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 20px; }
.tpu-error { color: var(--dsw-alias-state-error-primary); font-size: 14px; line-height: 20px; }
.tpu-actions { display: flex; justify-content: flex-end; }
.tpu-refresh { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border: 1px solid var(--tpu-border); border-radius: 6px;
  background: var(--tpu-background); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; outline: none; }
.tpu-refresh:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--tpu-background)); }
.tpu-refresh:focus-visible { box-shadow: 0 0 0 2px var(--tpu-border-hover); }
`
