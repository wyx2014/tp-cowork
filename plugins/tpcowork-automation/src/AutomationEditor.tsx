/** Detached task draft, presented in the Zcode single-column editor layout. */
import * as React from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AutomationExecutionOptions, AutomationProject, AutomationUiServices } from './ui-types.ts'
import type { ScheduleConfig, ScheduleFrequency, ScheduleTaskDraft, ScheduledTask } from './types.ts'
import type { UiKey, UiText } from './ui-locales.ts'
import { newDraft } from './ui-state.ts'
import { wallTime, wallTimeInstant } from './editor-time.ts'
import { scheduleDescription } from './schedule-format.ts'
import { displaySchedule } from './schedule-display.ts'
import { AutomationIcon } from './AutomationIcon.tsx'
import { AutomationProjectPicker } from './AutomationProjectPicker.tsx'

const frequencies: ScheduleFrequency[] = ['hourly', 'daily', 'weekdays', 'weekly', 'monthly', 'custom', 'once', 'manual']
const weekdays: UiKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
interface Props {
  initial: ScheduleTaskDraft
  services: AutomationUiServices
  projects: readonly AutomationProject[]
  t: UiText
  locale?: string
  pending: boolean
  editing?: boolean
  task?: ScheduledTask | undefined
  runEnabled?: boolean | undefined
  run?: ((draft: ScheduleTaskDraft) => Promise<boolean>) | undefined
  toggle?(): void
  remove?(): void
  history?: React.ReactNode
  failure?: UiKey | undefined
  save(draft: ScheduleTaskDraft): Promise<boolean>
  close(): void
}

/** Native details retain keyboard operation; popovers close on outside clicks and Escape. */
function EditorPopover({ label, className = '', children, onOpen }: { label: React.ReactNode; className?: string; children: React.ReactNode; onOpen?(): void }) {
  const ref = React.useRef<HTMLDetailsElement>(null)
  React.useEffect(() => {
    const close = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.open) { ref.current.open = false; ref.current.querySelector('summary')?.focus() }
    }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [])
  return <details ref={ref} className={`tp-auto-popover ${className}`} onToggle={event => { if (event.currentTarget.open) onOpen?.() }}>
    <summary>{label}</summary><div className="tp-auto-popover-panel">{children}</div>
  </details>
}

/** Save and Run now validate the same draft; task actions preserve local edits. */
export function AutomationEditor({ initial, services, projects, t, locale = 'en', pending, editing, task, runEnabled, run, toggle, remove, history, failure, save, close }: Props) {
  const [draft, setDraft] = React.useState(() => ({ ...structuredClone(initial), schedule: structuredClone(displaySchedule(initial.schedule)), name: initial.name || t('unnamedTask') }))
  const [scheduleEdited, setScheduleEdited] = React.useState(false)
  const [tab, setTab] = React.useState<'settings' | 'history'>('settings')
  const [scheduleAdded, setScheduleAdded] = React.useState(Boolean(editing || initial.name || initial.prompt))
  const initialZone = initial.schedule.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const initialDate = initial.schedule.at ? wallTime(initial.schedule.at, initialZone) : wallTime(newDraft().schedule.at!, initialZone)
  const [date, setDate] = React.useState(initialDate)
  const [options, setOptions] = React.useState<AutomationExecutionOptions>({})
  const [optionsError, setOptionsError] = React.useState(false)
  const [retry, setRetry] = React.useState(0)
  const [invalid, setInvalid] = React.useState<UiKey>()
  const [saveError, setSaveError] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const submittingRef = React.useRef(false)
  const busy = pending || submitting
  const running = task?.runs.some(run => run.status === 'running') ?? false
  React.useEffect(() => {
    let cancelled = false
    setOptionsError(false)
    void services.executionOptions?.().then(value => { if (!cancelled) setOptions(value) }, () => { if (!cancelled) setOptionsError(true) })
    return () => { cancelled = true }
  }, [services, retry])
  const change = (patch: Partial<ScheduleTaskDraft>) => setDraft(current => ({ ...current, ...patch }))
  const timing = (patch: Partial<ScheduleConfig>) => { setScheduleEdited(true); change({ schedule: { ...draft.schedule, ...patch } }) }
  const frequency = draft.schedule.frequency
  const setFrequency = (next: ScheduleFrequency) => {
    if (next === frequency) return
    setScheduleEdited(true)
    const schedule: ScheduleConfig = { frequency: next, timezone: draft.schedule.timezone }
    if (next === 'custom') Object.assign(schedule, initial.schedule.frequency === 'custom' ? initial.schedule : { cronExpression: '0 9 * * *' })
    else if (next === 'once') schedule.at = initial.schedule.at ?? newDraft().schedule.at
    else if (next !== 'manual') schedule.time = draft.schedule.time ?? { hour: 9, minute: 0 }
    if (next === 'weekly') schedule.dayOfWeek = 1
    if (next === 'monthly') schedule.dayOfMonth = 1
    change({ schedule })
  }
  const label = (key: UiKey, control: React.ReactElement<React.AriaAttributes>) => <label className="tp-auto-field"><span>{t(key)}</span>{React.cloneElement(control, { 'aria-label': t(key) })}</label>
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const runNow = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('data-action') === 'run'
    if (pending || submittingRef.current || running || (runNow && (!run || !runEnabled))) return
    const data = structuredClone(draft)
    // Opening or changing instructions must not rewrite the original Cron expression.
    if (!scheduleEdited) data.schedule = structuredClone(initial.schedule)
    try { new Intl.DateTimeFormat('en', { timeZone: draft.schedule.timezone ?? initialZone }) }
    catch { setInvalid('invalidTimezone'); return }
    try {
      if (!scheduleAdded) { setInvalid('invalidRule'); return }
      if (frequency === 'once') {
        const timezone = draft.schedule.timezone ?? initialZone
        data.schedule.at = initial.schedule.at && date === initialDate && timezone === initialZone ? initial.schedule.at : wallTimeInstant(date, timezone)
      }
      if (!data.name.trim() || !data.prompt.trim()) throw new Error('required')
      setInvalid(undefined)
    } catch { setInvalid('invalid'); return }
    setSaveError(false)
    submittingRef.current = true; setSubmitting(true)
    try { if (!await (runNow ? run!(data) : save(data))) setSaveError(true) }
    catch { setSaveError(true) }
    finally { submittingRef.current = false; setSubmitting(false) }
  }
  const selected = draft.modelSelection ?? options.models?.default
  const modelGroup = options.models?.groups.find(group => group.id === selected?.provider)
  const model = modelGroup?.models.find(model => model.id === selected?.model)
  const modelLabel = selected ? `${modelGroup?.name ?? selected.provider}/${model?.name ?? selected.model}` : t('defaultModel')
  const modelValue = draft.modelSelection ? JSON.stringify([draft.modelSelection.provider, draft.modelSelection.model]) : ''
  const effort = selected?.reasoningEffort ?? model?.reasoning?.defaultEffort
  const efforts = model?.reasoning?.efforts ?? []
  const permissionName = (value?: string) => {
    const labels: Record<string, UiKey> = { 'read-only': 'readOnly', 'workspace-write': 'workspaceWrite', 'danger-full-access': 'fullAccess', auto: 'autoReview' }
    return value ? labels[value] ? t(labels[value]!) : options.permissions?.options.find(item => item.value === value)?.name ?? value : t('defaultPermission')
  }
  const permission = draft.permissionPreset ?? options.permissions?.defaultPreset
  let scheduleText: string
  try {
    const schedule = frequency === 'once' ? { ...draft.schedule, at: wallTimeInstant(date, draft.schedule.timezone ?? initialZone) } : draft.schedule
    scheduleText = scheduleDescription(schedule, t, locale)
  } catch { scheduleText = t(frequency) }
  const taskActions: MenuEntry[] = [
    ...(task && task.status !== 'completed' ? [
      { id: 'toggle', label: t(task.status === 'paused' ? 'resume' : 'pause'), icon: <AutomationIcon name={task.status === 'paused' ? 'play' : 'pause'} />, disabled: busy },
      { type: 'separator' as const, id: 'separator' },
    ] : []),
    { id: 'delete', label: t('editorDelete'), icon: <AutomationIcon name="trash" />, danger: true, disabled: busy || running },
  ]
  return <form className="tp-auto-editor" onSubmit={event => { void submit(event) }} onInvalidCapture={event => {
    // Reveal invalid schedule fields before the browser moves focus to them.
    const details = (event.target as HTMLElement).closest('details')
    if (details) details.open = true
  }}>
    <div className="tp-auto-breadcrumb" data-window-drag><button type="button" onClick={close} disabled={busy} title={t('back')}>{t('title')}</button><AutomationIcon name="arrow" size={14} /><span>{editing ? task?.name ?? initial.name : t('new')}</span></div>
    <div className="tp-auto-editor-content">
      <header className="tp-auto-editor-heading"><h1>{t(editing ? 'editTitle' : 'createTitle')}</h1><p>{t('editorSubtitle')}</p></header>
      <div className="tp-auto-editor-toolbar">
        <div className="tp-auto-editor-tabs" role="tablist" aria-label={t(editing ? 'editTitle' : 'createTitle')} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 'settings' : event.key === 'End' ? 'history' : tab === 'settings' ? 'history' : 'settings'
          setTab(next); event.currentTarget.querySelector<HTMLButtonElement>(`#tp-auto-editor-${next}`)?.focus()
        }}>{(['settings', 'history'] as const).map(value => <button type="button" role="tab" key={value} id={`tp-auto-editor-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} aria-controls="tp-auto-editor-panel" onClick={() => setTab(value)}>{t(value === 'settings' ? 'editorSettings' : 'editorHistory')}</button>)}</div>
        <div className="tp-auto-editor-actions">
          {tab === 'settings' && <>
            <button type="submit" className={editing ? 'tp-auto-editor-save' : 'tp-auto-primary'} disabled={busy || running || !scheduleAdded || !draft.name.trim() || !draft.prompt.trim()}>{t(busy ? 'saving' : editing ? 'save' : 'createTask')}</button>
            {task && run && <button type="submit" data-action="run" disabled={busy || running || !runEnabled || !scheduleAdded || !draft.name.trim() || !draft.prompt.trim()} title={running ? t('taskRunning') : undefined}><AutomationIcon name="play" size={18} />{t('run')}</button>}
          </>}
          {task && <Menu open={menuOpen} portal align="end" items={taskActions} onClose={() => setMenuOpen(false)} onSelect={id => {
            setMenuOpen(false)
            if (id === 'toggle') toggle?.()
            else if (id === 'delete') remove?.()
          }} anchor={<button type="button" className="tp-auto-icon-button" aria-label={t('taskActions')} title={t('taskActions')} aria-haspopup="menu" aria-expanded={menuOpen} disabled={busy} onClick={() => setMenuOpen(value => !value)}><AutomationIcon name="more" size={18} /></button>} />}
        </div>
      </div>
      <div role="tabpanel" id="tp-auto-editor-panel" aria-labelledby={`tp-auto-editor-${tab}`}>
      {tab === 'history' ? history ?? <div className="tp-auto-empty"><AutomationIcon name="clock" size={28} /><p>{t('emptyRuns')}</p><span>{t('newHistoryHint')}</span></div> : <>
      <fieldset disabled={busy} className="tp-auto-editor-fields">
        {task && <div className="tp-auto-field"><span>{t('status')}</span><span className="tp-auto-editor-status" data-status={task.status}><i />{t(task.status === 'active' ? 'editorActive' : task.status)}</span></div>}
        {label('name', <input required placeholder={t('unnamedTask')} value={draft.name} onChange={event => change({ name: event.target.value })} />)}
        <div className="tp-auto-field tp-auto-schedule-field"><span>{t('timingSetup')}</span>
          {!scheduleAdded ? <EditorPopover className="tp-auto-schedule-picker tp-auto-schedule-add" label={<><AutomationIcon name="plus" size={18} /><span>{t('addSchedule')}</span></>}>
            <div className="tp-auto-frequency-menu" role="menu" aria-label={t('frequency')} onKeyDown={event => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
              const current = items.indexOf(document.activeElement as HTMLButtonElement)
              items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
            }}>{frequencies.map(value => <button type="button" role="menuitem" key={value} onClick={() => {
              setFrequency(value); setScheduleAdded(true)
              requestAnimationFrame(() => document.querySelector<HTMLSelectElement>('.tp-auto-schedule-row select')?.focus())
            }}>{t(value)}</button>)}</div>
          </EditorPopover> : <div className="tp-auto-schedule-row tp-auto-schedule-inline">
            <label className="tp-auto-schedule-pill"><span>{t(frequency)}</span><AutomationIcon name="down" size={12} /><select aria-label={t('frequency')} value={frequency} onChange={event => setFrequency(event.target.value as ScheduleFrequency)}>{frequencies.map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label>
            {frequency === 'monthly' && <label className="tp-auto-schedule-pill"><span>{t('monthDay').replace('{day}', String(draft.schedule.dayOfMonth ?? 1))}</span><AutomationIcon name="down" size={12} /><select aria-label={t('dayOfMonth')} value={draft.schedule.dayOfMonth ?? 1} onChange={event => timing({ dayOfMonth: Number(event.target.value) })}>{Array.from({ length: 31 }, (_, index) => <option key={index} value={index + 1}>{t('monthDay').replace('{day}', String(index + 1))}</option>)}</select></label>}
            {frequency === 'weekly' && <label className="tp-auto-schedule-pill"><span>{t(weekdays[draft.schedule.dayOfWeek ?? 1]!)}</span><AutomationIcon name="down" size={12} /><select aria-label={t('dayOfWeek')} value={draft.schedule.dayOfWeek ?? 1} onChange={event => timing({ dayOfWeek: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6, 0].map(index => <option key={index} value={index}>{t(weekdays[index]!)}</option>)}</select></label>}
            {frequency === 'once' && <input aria-label={t('date')} className="tp-auto-schedule-date" type="datetime-local" required value={date} onChange={event => setDate(event.target.value)} />}
            {!['once', 'manual', 'custom', 'hourly'].includes(frequency) && <><span>{t('scheduleAt')}</span><input aria-label={t('time')} className="tp-auto-schedule-time" type="time" required value={`${String(draft.schedule.time?.hour ?? 9).padStart(2, '0')}:${String(draft.schedule.time?.minute ?? 0).padStart(2, '0')}`} onChange={event => { const [hour, minute] = event.target.value.split(':').map(Number); timing({ time: { hour: hour!, minute: minute! } }) }} /></>}
            {frequency === 'hourly' && <><span>{t('minutePrefix')}</span><input aria-label={t('minute')} className="tp-auto-schedule-minute" type="number" required min={0} max={59} value={draft.schedule.time?.minute ?? 0} onChange={event => timing({ time: { hour: 0, minute: Number(event.target.value) } })} /><span>{t('minuteSuffix')}</span></>}
            {frequency === 'custom' && <EditorPopover className="tp-auto-custom-schedule" label={<><span>{t('editSchedule')}</span><AutomationIcon name="down" size={12} /></>}>
              <p className="tp-auto-muted">{t('customHint')}</p><div className="tp-auto-grid">
                {label('cronExpression', <input value={draft.schedule.cronExpression ?? ''} onChange={event => timing({ cronExpression: event.target.value || undefined, everyMs: undefined })} />)}
                {label('everyMs', <input type="number" min={1} value={draft.schedule.everyMs ?? ''} onChange={event => timing({ everyMs: event.target.value ? Number(event.target.value) : undefined, cronExpression: undefined })} />)}
              </div>
              <div className="tp-auto-popover-actions"><button type="button" className="tp-auto-primary" onClick={event => { event.currentTarget.closest('details')!.open = false }}>{t('done')}</button></div>
            </EditorPopover>}
            <span className="tp-auto-schedule-preview" title={scheduleText}>{scheduleText}</span>
            <button type="button" className="tp-auto-icon-button tp-auto-remove-schedule" title={t('removeSchedule')} aria-label={t('removeSchedule')} onClick={() => setScheduleAdded(false)}><AutomationIcon name="trash" /></button>
          </div>}
        </div>
        <div className="tp-auto-field"><label htmlFor="tp-auto-instructions">{t('prompt')}</label>
          <div className="tp-auto-project-row"><AutomationProjectPicker projects={projects} selectedId={draft.projectId} disabled={pending} t={t} onPick={project => change({ projectId: project?.id, workspacePath: project?.path ?? draft.workspacePath })} /></div>
          <div className="tp-auto-instructions-composer">
            <textarea id="tp-auto-instructions" required rows={6} placeholder={t('instructionExample')} value={draft.prompt} onChange={event => change({ prompt: event.target.value })} />
            <div className="tp-auto-instructions-toolbar"><div className="tp-auto-instructions-left">
              {draft.executionMode !== 'reminder' && <label className="tp-auto-toolbar-select" title={t('permissions')}><AutomationIcon name="hand" /><span>{permissionName(permission)}</span><AutomationIcon name="down" size={12} /><select aria-label={t('permissions')} value={draft.permissionPreset ?? ''} disabled={!options.permissions} onChange={event => change({ permissionPreset: event.target.value || undefined })}>
                <option value="">{t('followDefault')} · {permissionName(options.permissions?.defaultPreset)}</option>
                {draft.permissionPreset && !options.permissions?.options.some(item => item.value === draft.permissionPreset) && <option value={draft.permissionPreset}>{t('unavailable')} · {draft.permissionPreset}</option>}
                {options.permissions?.options.map(item => <option key={item.value} value={item.value}>{permissionName(item.value)}</option>)}
              </select></label>}
            </div>
            {draft.executionMode !== 'reminder' && <div className="tp-auto-instructions-right">
              <label className="tp-auto-toolbar-select tp-auto-model-select" title={draft.modelSelection ? t('model') : t('followDefault')}><span>{modelLabel}</span><AutomationIcon name="down" size={12} /><select aria-label={t('model')} value={modelValue} disabled={!options.models} onChange={event => {
                if (!event.target.value) { change({ modelSelection: undefined }); return }
                const [provider, model] = JSON.parse(event.target.value) as [string, string]
                change({ modelSelection: { provider, model } })
              }}><option value="">{t('followDefault')} · {options.models?.default.model ?? t('defaultModel')}</option>
                {draft.modelSelection && !model && <option value={modelValue}>{t('unavailable')} · {modelLabel}</option>}
                {options.models?.groups.map(group => <optgroup key={group.id} label={group.name}>{group.models.map(model => <option key={model.id} value={JSON.stringify([group.id, model.id])}>{model.name}</option>)}</optgroup>)}
              </select></label>
              <label className="tp-auto-toolbar-select" title={t('reasoning')}><AutomationIcon name="brain" /><span>{efforts.find(item => item.id === effort)?.name ?? effort ?? t('followDefault')}</span><AutomationIcon name="down" size={12} /><select aria-label={t('reasoning')} value={effort ?? ''} disabled={!selected || !efforts.length} onChange={event => { if (selected) change({ modelSelection: { provider: selected.provider, model: selected.model, reasoningEffort: event.target.value || undefined } }) }}>
                <option value="">{t('followDefault')}</option>{effort && !efforts.some(item => item.id === effort) && <option value={effort}>{effort}</option>}
                {efforts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select></label>
            </div>}
            </div>
          </div>
        </div>
        {optionsError && <p role="status">{t('executionOptionsError')} <button type="button" onClick={() => setRetry(value => value + 1)}>{t('retry')}</button></p>}
      </fieldset>
      {(invalid || saveError || failure) && <p role="alert">{t(invalid ?? failure ?? 'error')}</p>}
      </>}
      </div>
    </div>
  </form>
}
