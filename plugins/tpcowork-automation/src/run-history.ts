/** Pure run presentation shared by the history list and result navigation. */
import type { ScheduledTask, ScheduledTaskRun } from './types.ts'

export interface RunEntry { task: ScheduledTask; run: ScheduledTaskRun }
export type RunFilter = 'all' | 'running' | 'completed' | 'error' | 'unread'
export const runFilters: readonly RunFilter[] = ['all', 'running', 'completed', 'error', 'unread']
/** Include archived task history; task visibility never controls run visibility. */
export function collectRuns(tasks: readonly ScheduledTask[]): RunEntry[] {
  return tasks.flatMap(task => task.runs.map(run => ({ task, run })))
    .sort((a, b) => b.run.startedAt - a.run.startedAt || a.task.id.localeCompare(b.task.id) || a.run.id.localeCompare(b.run.id))
}
export function isUnread(run: ScheduledTaskRun): boolean { return run.status !== 'running' && run.viewedAt === undefined }
/** Never infer results from allocated Session ids or legacy aliases. */
export function canOpenResult(run: ScheduledTaskRun): boolean {
  return run.resultType === 'conversation' && run.conversationAvailable && Boolean(run.conversationId) && !run.unavailableReason
}
/** Stable run title independent of model-generated Session titles. */
export function runTitle({ task, run }: RunEntry, locale: string): string {
  return `${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(run.startedAt)} - ${task.name}`
}
export function matchesFilter(run: ScheduledTaskRun, filter: RunFilter): boolean {
  return filter === 'all' || (filter === 'unread' ? isUnread(run) : run.status === filter)
}
/** Search and counts use the same population before applying the selected status. */
export function searchRuns(entries: readonly RunEntry[], query: string, locale: string): RunEntry[] {
  const needle = query.trim().toLocaleLowerCase(locale)
  return entries.filter(entry => !needle || [runTitle(entry, locale), entry.task.description, entry.task.prompt, entry.run.error, entry.run.skippedReason]
    .some(value => value?.toLocaleLowerCase(locale).includes(needle)))
}
/** Group by the viewer's local calendar date, including DST boundaries. */
export function runDateKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function groupRuns(entries: readonly RunEntry[]): [string, RunEntry[]][] {
  const groups = new Map<string, RunEntry[]>()
  for (const entry of entries) {
    const key = runDateKey(entry.run.startedAt)
    const group = groups.get(key) ?? []
    group.push(entry); groups.set(key, group)
  }
  return [...groups]
}
/** Elapsed wall time, refreshed by the page's existing Host-state poll. */
export function runDuration(run: ScheduledTaskRun, now = Date.now()): string {
  const seconds = Math.floor(Math.max(0, (run.completedAt ?? now) - run.startedAt) / 1000)
  return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
