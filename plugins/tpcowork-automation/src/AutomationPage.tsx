/** Task management and history entry point; task cards do not expand into run trees. */
import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AutomationUiServices } from './ui-types.ts'
import type { AutomationTaskId, ScheduleTaskDraft, ScheduledTask } from './types.ts'
import { uiFailureKey, type UiText } from './ui-locales.ts'
import { AutomationCatalog, isArchivedOneTimeTask, newDraft } from './ui-state.ts'
import { AutomationRunCenter } from './AutomationRunCenter.tsx'
import { DeleteConfirmation } from './AutomationDeleteConfirmation.tsx'
import { AutomationRunTable } from './AutomationRunTable.tsx'
import { collectRuns, isUnread } from './run-history.ts'
import { AutomationEditor } from './AutomationEditor.tsx'
import { getAutomationTemplates } from './automation-templates.ts'
import { AutomationIcon } from './AutomationIcon.tsx'
import { scheduleDescription, relativeRunTime } from './schedule-format.ts'

export interface AutomationPageProps { services: AutomationUiServices; t: UiText; locale: string }
/** Production pages share the plugin's catalog across main-panel navigation. */
export function AutomationPage({ services, t, locale }: AutomationPageProps) {
  const [catalog] = React.useState(() => services.catalog ?? new AutomationCatalog(services.automation))
  const state = React.useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)
  const projects = React.useSyncExternalStore(services.projects.subscribe, services.projects.getSnapshot)
  const [tab, setTab] = React.useState<'tasks' | 'runs'>('tasks')
  const [editor, setEditor] = React.useState<{ id?: AutomationTaskId; draft: ScheduleTaskDraft }>()
  const [deleting, setDeleting] = React.useState<AutomationTaskId>()
  const [confirmMigration, setConfirmMigration] = React.useState(false)
  React.useEffect(() => {
    if (services.catalog) return
    catalog.start()
    const timer = window.setInterval(() => { void catalog.refresh() }, 2000)
    return () => { window.clearInterval(timer); catalog.dispose() }
  }, [catalog])
  React.useEffect(() => {
    if (state.target) { setTab('runs'); setEditor(undefined); setDeleting(undefined) }
  }, [state.target])
  const allTasks = [...(state.catalog?.tasks ?? [])].sort((a, b) => b.createdAt - a.createdAt)
  const tasks = allTasks.filter(task => !isArchivedOneTimeTask(task))
  const runs = collectRuns(allTasks)
  const unread = runs.filter(({ run }) => isUnread(run)).length
  const templates = getAutomationTemplates(locale)
  const formatTime = (at: number, zone?: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', ...zone ? { timeZone: zone } : {} }).format(at)
  const mutate = (operation: () => ReturnType<AutomationUiServices['automation']['list']>) => { void catalog.mutate(operation) }
  const edit = (task: ScheduledTask) => {
    // Copy only draft fields: server metadata is never posted back as form input.
    const { name, description, prompt, schedule, skillName, workspacePath, projectId, mcpPresets, executionMode, modelSelection, permissionPreset } = task
    setEditor({ id: task.id, draft: structuredClone({ name, description, prompt, schedule, skillName, workspacePath, projectId, mcpPresets, executionMode, modelSelection, permissionPreset }) })
  }
  const createActions = <div className="tp-auto-actions">
    <button type="button" onClick={() => setEditor({ draft: newDraft() })} className="tp-auto-primary"><AutomationIcon name="plus" />{t('new')}</button>
    <button type="button" className="tp-auto-assistant" onClick={() => services.askAssistant(t('askPrompt'))}><AutomationIcon name="wand" />{t('ask')}</button>
  </div>
  const deletion = allTasks.find(task => task.id === deleting)
  const deleteDialog = deletion && <DeleteConfirmation title="delete" hint="deleteHint" pending={state.pending || deletion.runs.some(run => run.status === 'running')} failure={state.error ? state.failure ?? 'unknown' : undefined} t={t} cancel={() => setDeleting(undefined)} confirm={() => {
    if (deletion.runs.some(run => run.status === 'running')) return
    void catalog.mutate(() => services.automation.delete({ id: deletion.id })).then(ok => {
      if (ok) { setDeleting(undefined); if (editor?.id === deletion.id) setEditor(undefined) }
    })
  }} />
  if (editor) {
    const task = allTasks.find(task => task.id === editor.id)
    const saveDraft = async (draft: ScheduleTaskDraft) => {
      const id = editor.id
      return catalog.mutate(() => id
        ? services.automation.update({ id, data: { ...draft, projectId: draft.projectId ?? null,
          modelSelection: draft.modelSelection ?? null, permissionPreset: draft.permissionPreset ?? null } })
        : services.automation.create(draft))
    }
    return <main className="tp-automation" data-automation-surface><AutomationEditor initial={editor.draft} editing={editor.id !== undefined} task={task} services={services} projects={projects} t={t} pending={state.pending} failure={state.error && !deleting ? uiFailureKey(state.failure) : undefined}
    locale={locale} history={editor.id === undefined ? undefined : <AutomationRunTable tasks={task ? [task] : []} catalog={catalog} state={state} services={services} t={t} locale={locale} />}
    runEnabled={state.catalog?.status.enabled} run={task ? async draft => {
      if (!await saveDraft(draft)) return false
      return catalog.mutate(() => services.automation.runNow({ id: task.id }))
    } : undefined}
    toggle={() => { if (task) mutate(() => task.status === 'paused' ? services.automation.resume({ id: task.id }) : services.automation.pause({ id: task.id })) }}
    remove={() => { if (task) setDeleting(task.id) }}
    close={() => setEditor(undefined)} save={async draft => {
      const ok = await saveDraft(draft)
      if (ok) setEditor(undefined)
      return ok
    }} />{deleteDialog}</main>
  }
  return <main className="tp-automation" data-automation-surface><div className="tp-auto-content">
    <header className="tp-auto-page-heading" data-window-drag><div><h1>{t('title')}</h1><p className="tp-auto-muted">{t('subtitle')}</p></div>{createActions}</header>
    <div className="tp-auto-toolbar">
      <nav role="tablist" aria-label={t('title')} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 'tasks' : event.key === 'End' ? 'runs' : tab === 'tasks' ? 'runs' : 'tasks'
        setTab(next)
        event.currentTarget.querySelector<HTMLButtonElement>(`#tp-auto-${next}-tab`)?.focus()
      }}><button type="button" role="tab" id="tp-auto-tasks-tab" aria-controls="tp-auto-tasks-panel" aria-selected={tab === 'tasks'} tabIndex={tab === 'tasks' ? 0 : -1} onClick={() => setTab('tasks')}>{t('tasks')}</button>
        <button type="button" role="tab" id="tp-auto-runs-tab" aria-controls="tp-auto-runs-panel" aria-selected={tab === 'runs'} tabIndex={tab === 'runs' ? 0 : -1} onClick={() => setTab('runs')}>{t('runs')}{unread > 0 && <span className="tp-auto-unread-count" aria-label={`${t('unread')} ${unread}`}>{unread > 99 ? '99+' : unread}</span>}</button></nav>
    </div>
    {state.error && tab === 'tasks' && <div role="alert" className="tp-auto-notice">{t(uiFailureKey(state.failure))} <button onClick={() => { void catalog.refresh() }}>{t('retry')}</button></div>}
    {state.catalog && !state.catalog.status.enabled && <p role="status" className="tp-auto-notice">{t('hostStopped')}</p>}
    {state.catalog?.status.migration && state.catalog.status.migration.phase !== 'complete' && <div role="status" className="tp-auto-notice">
      <p>{t(state.catalog.status.migration.phase === 'waiting' ? 'migrationWaiting' : 'migrationInterrupted')}</p>
      <button disabled={state.pending} onClick={() => setConfirmMigration(true)}>{t('migrateNative')}</button>
    </div>}
    {!!state.catalog?.status.migration?.pausedOverdue.length && <p role="status" className="tp-auto-notice">{t('migrationOverdue')}</p>}
    {state.loading ? <div role="status" className="tp-auto-empty">{t('loading')}</div> : tab === 'tasks' ? <section role="tabpanel" id="tp-auto-tasks-panel" aria-labelledby="tp-auto-tasks-tab">
      {tasks.length === 0 ? <div className="tp-auto-empty tp-auto-onboarding"><span className="tp-auto-empty-icon"><AutomationIcon name="clock" size={24} /></span><h2>{t('empty')}</h2><p>{t('emptyHint')}</p></div> : <section className="tp-auto-my-tasks" aria-labelledby="tp-auto-my-tasks-title">
        <div className="tp-auto-section-heading"><h2 id="tp-auto-my-tasks-title">{t('myAutomations')}</h2></div>
        <div className="tp-auto-cards">{tasks.map(task => {
          const running = task.runs.some(run => run.status === 'running')
          const unreadRuns = task.runs.filter(isUnread).sort((a, b) => b.startedAt - a.startedAt)
          const schedule = scheduleDescription(task.schedule, t, locale)
          const next = task.status === 'active' && task.nextRunAt ? t('nextRunIn').replace('{time}', relativeRunTime(task.nextRunAt, locale)) : ''
          const runCount = t('runCount').replace('{count}', String(task.runs.length))
          const latestRun = unreadRuns[0] ?? task.runs[0]
          return <article className="tp-auto-card tp-auto-task-card" key={task.id} data-task-id={task.id}>
            <div className="tp-auto-task-body">
              <div className="tp-auto-task-title"><h3><button type="button" className="tp-auto-task-open" disabled={state.pending || running} onClick={() => edit(task)}>{task.name}</button></h3></div>
              <p className="tp-auto-task-description">{task.prompt || task.description}</p>
              <div className="tp-auto-task-footer"><span className="tp-auto-schedule-badge" data-status={running ? 'running' : task.status} title={next ? `${schedule} · ${t('next')} ${formatTime(task.nextRunAt!, task.schedule.timezone)}` : schedule}>
                <AutomationIcon name="clock" size={16} /><span>{running ? `${t('running')} · ` : task.status === 'paused' ? `${t('paused')} · ` : ''}{schedule}{next && ` · ${next}`}</span>
              </span>{latestRun ? <button type="button" className="tp-auto-task-run-count" aria-label={unreadRuns.length ? `${t('unread')} ${unreadRuns.length}` : runCount} onClick={() => catalog.openRun({ taskId: task.id, runId: latestRun.id })}>{runCount}{unreadRuns.length > 0 && <span className="tp-auto-card-unread-dot" />}</button> : <span className="tp-auto-task-run-count">{runCount}</span>}</div>
            </div>
            <div className="tp-auto-task-controls"><div className="tp-auto-actions">
              <button type="button" className="tp-auto-icon-button" aria-label={t('edit')} title={t('edit')} disabled={state.pending || running} onClick={() => edit(task)}><AutomationIcon name="edit" /></button>
              <button type="button" className="tp-auto-icon-button" aria-label={t('run')} title={t('run')} disabled={state.pending || running || !state.catalog?.status.enabled} onClick={() => mutate(() => services.automation.runNow({ id: task.id }))}><AutomationIcon name="play" /></button>
              <button type="button" className="tp-auto-icon-button tp-auto-danger" aria-label={t('delete')} title={t('delete')} disabled={state.pending || running} onClick={() => setDeleting(task.id)}><AutomationIcon name="trash" /></button>
            </div>
              {task.status === 'completed' ? <span className="tp-auto-badge">{t('completed')}</span> : <button type="button" className="tp-auto-toggle" data-active={task.status === 'active'} aria-pressed={task.status === 'active'} aria-label={t(task.status === 'paused' ? 'resume' : 'pause')} title={t(task.status === 'paused' ? 'resume' : 'pause')} disabled={state.pending} onClick={() => mutate(() => task.status === 'paused' ? services.automation.resume({ id: task.id }) : services.automation.pause({ id: task.id }))}><span /></button>}
            </div>
          </article>
        })}</div>
      </section>}
      <section className="tp-auto-templates" aria-labelledby="tp-auto-templates-title"><div className="tp-auto-section-heading"><h2 id="tp-auto-templates-title">{t('templates')}</h2></div><div className="tp-auto-template-grid">{templates.map(template => <button type="button" className="tp-auto-template" key={template.id} onClick={() => setEditor({ draft: { ...newDraft(), ...structuredClone(template.draft), schedule: { ...template.draft.schedule, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } } })}>
        <span className="tp-auto-template-title"><AutomationIcon name={template.icon} size={18} /><strong>{template.draft.name}</strong></span><span className="tp-auto-template-description">{template.draft.prompt}</span><span className="tp-auto-template-schedule">{scheduleDescription(template.draft.schedule, t, locale)}</span>
      </button>)}</div></section>
    </section> : <AutomationRunCenter catalog={catalog} state={state} services={services} t={t} locale={locale} />}
    {deleteDialog}
    {confirmMigration && <Modal open className="tp-confirm-dialog" title={t('migrateNative')} description={t('migrationConfirm')} closeLabel={t('cancel')} showCloseButton={false} onClose={() => { if (!state.pending) setConfirmMigration(false) }}
      footer={<><Button variant="outline" data-modal-autofocus disabled={state.pending} onClick={() => setConfirmMigration(false)}>{t('cancel')}</Button>
        <Button variant="primary" disabled={state.pending || !services.migrateNative} onClick={() => {
          void catalog.mutate(() => services.migrateNative!()).then(ok => { if (ok) setConfirmMigration(false) })
        }}>{t('migrateNative')}</Button></>}>
      {state.error ? <p role="alert">{t(uiFailureKey(state.failure ?? 'unknown'))}</p> : undefined}
    </Modal>}
  </div></main>
}
