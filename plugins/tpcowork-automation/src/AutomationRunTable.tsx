/** Shared compact history table for a task editor and the full run list. */
import * as React from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AutomationUiServices } from './ui-types.ts'
import type { ScheduledTask } from './types.ts'
import type { AutomationCatalog, CatalogSnapshot } from './ui-state.ts'
import { uiFailureKey, type UiText } from './ui-locales.ts'
import { canOpenResult, collectRuns, isUnread, runTitle, type RunEntry } from './run-history.ts'
import { AutomationIcon } from './AutomationIcon.tsx'
import { DeleteConfirmation } from './AutomationDeleteConfirmation.tsx'

interface Props { tasks: readonly ScheduledTask[]; showTask?: boolean; catalog: AutomationCatalog; state: CatalogSnapshot; services: AutomationUiServices; t: UiText; locale: string }

function duration(entry: RunEntry): string {
  const seconds = Math.floor(Math.max(0, (entry.run.completedAt ?? Date.now()) - entry.run.startedAt) / 1000)
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60 % 60)
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${seconds % 60}s`].filter(Boolean).join(' ')
}

export function AutomationRunTable({ tasks, showTask = false, catalog, state, services, t, locale }: Props) {
  const [menu, setMenu] = React.useState<string>()
  const [deleting, setDeleting] = React.useState<string>()
  const [opening, setOpening] = React.useState(false)
  const [openFailed, setOpenFailed] = React.useState(false)
  const [followed, setFollowed] = React.useState<string>()
  const attemptedRead = React.useRef<string>()
  const table = React.useRef<HTMLTableElement>(null)
  const openingRef = React.useRef(false)
  const lifetime = React.useRef<AbortController>()
  React.useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    return () => { controller.abort(); lifetime.current = undefined }
  }, [])
  const entries = collectRuns(tasks)
  const deletion = entries.find(({ run }) => run.id === deleting)
  React.useEffect(() => { if (deleting && !deletion) setDeleting(undefined) }, [deleting, deletion])
  const followedEntry = entries.find(({ run }) => run.id === followed)
  React.useEffect(() => {
    if (!followedEntry || followedEntry.run.resultType !== 'conversation' || !isUnread(followedEntry.run) || state.pending || attemptedRead.current === followed) return
    attemptedRead.current = followed
    void catalog.mutate(() => services.automation.markRunViewed({ taskId: followedEntry.task.id, runId: followedEntry.run.id }))
  }, [followedEntry?.run.status, followedEntry?.run.viewedAt, followed, state.pending])
  React.useEffect(() => {
    if (!showTask || !state.target) return
    const row = [...(table.current?.querySelectorAll<HTMLTableRowElement>('tbody tr') ?? [])].find(row => row.dataset.runId === state.target?.runId && row.dataset.taskId === state.target?.taskId)
    row?.scrollIntoView?.({ block: 'nearest' })
    row?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [showTask, state.target])
  const open = async (entry: RunEntry) => {
    if (openingRef.current || state.pending || !canOpenResult(entry.run)) return
    const controller = lifetime.current
    if (!controller) return
    openingRef.current = true; setOpening(true); setOpenFailed(false)
    try {
      if (isUnread(entry.run) && !await catalog.mutate(() => services.automation.markRunViewed({ taskId: entry.task.id, runId: entry.run.id }))) return
      controller.signal.throwIfAborted()
      await services.openSession(entry.run.conversationId!, runTitle(entry, locale), controller.signal)
      if (!controller.signal.aborted) { attemptedRead.current = undefined; setFollowed(entry.run.id) }
    } catch {
      if (!controller.signal.aborted) setOpenFailed(true)
    } finally {
      openingRef.current = false
      if (!controller.signal.aborted) setOpening(false)
    }
  }
  const confirm = (entry: RunEntry) => { void catalog.mutate(() => services.automation.markRunViewed({ taskId: entry.task.id, runId: entry.run.id })) }
  const unavailable = (entry: RunEntry) => t(entry.run.resultType === 'none' ? 'noConversation' : entry.run.unavailableReason === 'legacy' ? 'legacyResult' : entry.run.status === 'running' ? 'waitingResult' : 'missingResult')
  const timestamp = (at: number) => {
    const parts = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
  }
  return <div className="tp-auto-editor-history">
    {state.error && !deletion && <p role="alert">{t(uiFailureKey(state.failure) === 'error' ? 'runFailure' : uiFailureKey(state.failure))} <button type="button" onClick={() => { void catalog.refresh() }}>{t('retry')}</button></p>}
    {openFailed && <p role="alert">{t('openFailed')}</p>}
    {entries.length === 0 ? <div className="tp-auto-empty">{t('emptyRuns')}</div> : <div className="tp-auto-history-table-wrap"><table ref={table} className="tp-auto-history-table" data-show-task={showTask} aria-label={t(showTask ? 'runs' : 'editorHistory')}>
      <thead><tr>{showTask && <th scope="col">{t('name')}</th>}<th scope="col">{t('triggeredAt')}</th><th scope="col">{t('triggerSource')}</th><th scope="col">{t('status')}</th><th scope="col">{t('historyDuration')}</th><th scope="col"><span className="tp-auto-sr-only">{t('runActions')}</span></th></tr></thead>
      <tbody>{entries.map(entry => {
        const { run } = entry
        const status = run.status === 'running' ? 'running' : run.skippedReason ? 'skipped' : run.status === 'error' ? 'error' : 'success'
        const items: MenuEntry[] = [
          ...(!showTask ? [{ id: 'open', label: t('jumpToSession'), icon: <AutomationIcon name="external" />, disabled: !canOpenResult(run) || opening || state.pending }] : []),
          ...(showTask && run.resultType !== 'none' && !canOpenResult(run) ? [{ id: 'viewed', label: t('viewed'), disabled: !isUnread(run) || opening || state.pending }] : []),
          ...(!showTask || run.resultType !== 'none' && !canOpenResult(run) ? [{ type: 'separator' as const, id: 'separator' }] : []),
          { id: 'delete', label: t('deleteRecord'), icon: <AutomationIcon name="trash" />, danger: true, disabled: state.pending || opening || run.status === 'running' },
        ]
        return <tr key={run.id} data-task-id={entry.task.id} data-run-id={run.id} data-target={showTask && state.target?.runId === run.id && state.target.taskId === entry.task.id}>
          {showTask && <td className="tp-auto-history-task"><span title={entry.task.name}>{entry.task.name}</span>{isUnread(run) && <i className="tp-auto-history-unread" aria-label={t('unread')} />}</td>}
          <td><time dateTime={new Date(run.scheduledAt ?? run.startedAt).toISOString()}>{timestamp(run.scheduledAt ?? run.startedAt)}</time></td>
          <td>{t(run.trigger === 'scheduled' ? 'scheduledTrigger' : 'manual')}</td>
          <td><span className="tp-auto-history-status" data-status={status} title={run.skippedReason ?? run.error}><i />{t(status === 'running' ? 'running' : status === 'skipped' ? 'runSkipped' : status === 'error' ? 'runError' : 'runSuccess')}</span></td>
          <td>{duration(entry)}</td>
          <td><div className="tp-auto-history-actions">{showTask && (run.resultType === 'none' && run.status !== 'running'
            ? <button type="button" className="tp-auto-history-confirm" disabled={state.pending || opening || !isUnread(run)} onClick={() => confirm(entry)}>{t(isUnread(run) ? 'confirmReminder' : 'confirmed')}</button>
            : <button type="button" className="tp-auto-history-jump" disabled={!canOpenResult(run) || state.pending || opening} title={canOpenResult(run) ? t('jumpToSession') : unavailable(entry)} aria-label={t('jumpToSession')} onClick={() => { void open(entry) }}><AutomationIcon name="external" />{t('jumpToSession')}</button>)}<Menu open={menu === run.id} portal align="end" items={items} onClose={() => setMenu(undefined)} onSelect={id => {
            setMenu(undefined)
            if (id === 'open') void open(entry)
            else if (id === 'confirm' || id === 'viewed') confirm(entry)
            else if (id === 'delete' && run.status !== 'running') setDeleting(run.id)
          }} anchor={<button type="button" className="tp-auto-icon-button tp-auto-history-more" title={t('runActions')} aria-label={t('runActions')} aria-haspopup="menu" aria-expanded={menu === run.id} onClick={() => setMenu(menu === run.id ? undefined : run.id)}><AutomationIcon name="more" /></button>} /></div></td>
        </tr>
      })}</tbody>
    </table></div>}
    {deletion && <DeleteConfirmation title="deleteRecord" pending={state.pending || opening || deletion.run.status === 'running'} failure={state.error ? state.failure ?? 'unknown' : undefined} t={t} cancel={() => setDeleting(undefined)} confirm={() => {
      if (deletion.run.status === 'running' || openingRef.current) return
      void catalog.mutate(() => services.automation.deleteRun({ taskId: deletion.task.id, runId: deletion.run.id })).then(ok => { if (ok) setDeleting(undefined) })
    }} />}
  </div>
}
