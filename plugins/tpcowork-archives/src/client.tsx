/**
 * Client half: Settings "Archive management", after ZCode's `ArchiveManagementSection`. Archived Sessions come from
 * the Workspace archive set and the Session list, grouped by Workspace; unarchiving goes through the Workspace service
 * and deletion through this package's Host `archiveManager` Remote.
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { Button, Menu, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { archiveGroups, type ArchiveGroup, type ArchiveSort, type ArchiveSources, type ArchiveTask } from './archives.ts'
import { archivedSessionsValue, archivesRemote, removeResultValue, type ArchivedSession, type RemoveResult } from './remote.ts'
import { en, zh, type ArchivesKey } from './locales.ts'
import { installRemovedWorkspaces } from './removed-workspaces.ts'

const { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } = React
const namespace = 'settings.archives'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'settings.archives': ArchivesKey } }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertClientRemote {
    archiveManager: {
      list(): Promise<RemoteResult<ArchivedSession[]>>
      remove(sessionIds: string[]): Promise<RemoteResult<RemoveResult>>
      rescan(): Promise<RemoteResult<number>>
      hidden(): Promise<RemoteResult<string[]>>
    }
  }
}
// Keep the remote augmentation reachable for this externally built Client face.
export type ArchiveManagerRemote = TypertClientRemote['archiveManager']

export const name = 'tpcowork-archives-client'
/** The Host entry id from this package's `cordis.patch.yml`. */
const entry = 'tpcowork-archives'
/** ZCode's retention choices. */
export const AUTO_ARCHIVE_DAYS = [3, 7, 14, 30] as const

interface ArchiveSettings { autoArchive?: boolean; autoArchiveDays?: number }
export const inject = ['remote']

type Translate = (key: ArchivesKey, params?: Record<string, unknown>) => string

/** A subscribable snapshot, the shape of the Workspace and Session lists. */
interface Source<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }

/** What the page reads and runs; the live services in the app, fakes in tests. */
export interface ArchivesApi {
  workspaces: Source<{ items: ArchiveSources['workspaces']; archivedSessionIds: readonly string[] }>
  sessions: Source<{ byId: ArchiveSources['sessions'] }>
  list(): Promise<ArchivedSession[]>
  remove(sessionIds: string[]): Promise<RemoveResult>
  unarchive(sessionId: string): Promise<void>
  /** Run the Host auto-archive scan now. */
  rescan(): Promise<void>
}

export interface ArchivesPageProps { t: Translate; api: ArchivesApi; form: ConfigForm<ArchiveSettings> }

const svg = (children: React.ReactNode, size = 16, className?: string) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
  stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{children}</svg>
const FolderIcon = () => svg(<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />, 16, 'tpa-subtle')
const ChevronRight = () => svg(<path d="m9 18 6-6-6-6" />, 14, 'tpa-subtle tpa-chevron')
const ChevronDown = () => svg(<path d="m6 9 6 6 6-6" />, 16, 'tpa-subtle')
const SearchIcon = () => svg(<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>, 16, 'tpa-search-icon')
const ClearIcon = () => svg(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>, 14)
const TrashIcon = ({ className }: { className?: string }) => svg(<><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></>, 16, className)
const MoreIcon = () => svg(<><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></>)

/** ZCode's auto-archive card: the switch, then the retention period; each change rescans at once, as ZCode does. */
function AutoArchiveCard({ t, form, onChanged }: { t: Translate; form: ConfigForm<ArchiveSettings>; onChanged: () => void }) {
  const snapshot = useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot())
  const enabled = snapshot.value?.autoArchive === true
  const days = snapshot.value?.autoArchiveDays ?? 30
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const save = (key: keyof ArchiveSettings, value: boolean | number) => {
    setSaving(true)
    setFailed(false)
    void form.set(key, value).then(accepted => { if (accepted) onChanged(); else setFailed(true) }, () => setFailed(true))
      .finally(() => setSaving(false))
  }
  const disabled = saving || snapshot.status !== 'ready' || !snapshot.writable
  const choices = AUTO_ARCHIVE_DAYS.includes(days as never) ? AUTO_ARCHIVE_DAYS : [...AUTO_ARCHIVE_DAYS, days].sort((a, b) => a - b)
  return <div className="tpa-settings">
    <div className="tpa-card">
      <div className="tpa-row">
        <div className="tpa-row-text">
          <div className="tpa-label">{t('autoArchive')}</div>
          <div className="tpa-description">{t('autoArchiveDescription')}</div>
        </div>
        <div className="tpa-row-control">
          <Switch checked={enabled} label={t('autoArchive')} disabled={disabled} onChange={next => save('autoArchive', next)} />
        </div>
      </div>
      <div className="tpa-row">
        <div className="tpa-row-text">
          <div className="tpa-label">{t('autoArchiveDays')}</div>
          <div className="tpa-description">{t('autoArchiveDaysDescription')}</div>
        </div>
        <div className="tpa-row-control">
          <SelectMenu label={t('autoArchiveDays')} value={String(days)} disabled={disabled} onChange={value => save('autoArchiveDays', Number(value))}
            options={choices.map(choice => ({ id: String(choice), label: t('autoArchiveAfter', { days: choice }) }))} />
        </div>
      </div>
    </div>
    {failed ? <div role="alert" className="tpa-alert">{t('settingFailed')}</div> : null}
  </div>
}

// ZCode's archive page in DSH tokens: `border` is l3, `surface` layer 1, `hover` 5% ink, destructive surface 10% error.
export const css = `
.tpa-page { display: grid; gap: 24px; min-width: 0; }
.tpa-settings { display: grid; gap: 8px; min-width: 0; }
.tpa-card { overflow: hidden; border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.tpa-row { display: grid; grid-template-columns: minmax(0, 1fr) 192px; align-items: center; gap: 16px; padding: 12px 16px; }
.tpa-row + .tpa-row { border-top: 1px solid var(--dsw-alias-border-l3); }
@media (max-width: 720px) { .tpa-row { grid-template-columns: minmax(0, 1fr); } }
.tpa-row-text { min-width: 0; }
.tpa-row-control { display: flex; justify-content: flex-end; align-items: center; min-width: 0; }
.tpa-label { font-size: 14px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.tpa-description { margin-top: 4px; font-size: 14px; line-height: 24px; color: var(--tpcowork-settings-subtle, var(--dsw-alias-label-secondary)); }
.tpa-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.tpa-title { margin: 0; font-size: 18px; line-height: 26px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.tpa-danger { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 0; border-radius: 8px; font: inherit; font-size: 14px; cursor: pointer; outline: none;
  background: color-mix(in oklab, var(--dsw-alias-state-error-primary, #d93025) 10%, transparent); color: var(--dsw-alias-state-error-primary, #d93025); }
.tpa-danger:disabled { cursor: default; opacity: .5; }
.tpa-filters { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 13rem); gap: 8px; min-width: 0; }
@media (max-width: 720px) { .tpa-filters { grid-template-columns: minmax(0, 1fr); } }
.tpa-search { position: relative; min-width: 0; }
.tpa-search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--dsw-alias-label-secondary); }
.tpa-search input { box-sizing: border-box; width: 100%; height: 36px; padding: 0 36px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; outline: none; transition: border-color 150ms; }
.tpa-search input::placeholder { color: var(--dsw-alias-label-tertiary); }
.tpa-search input:hover { border-color: var(--dsw-alias-border-l2); }
.tpa-search input:focus { border-color: var(--dsw-alias-border-l1); }
.tpa-search input::-webkit-search-cancel-button { appearance: none; }
.tpa-search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; outline: none; }
.tpa-search-clear:hover { background: color-mix(in oklab, var(--dsw-alias-label-primary) 5%, transparent); }
.tpa-sort { display: flex; align-items: center; gap: 8px; min-width: 0; }
.tpa-sort-label { flex: none; font-size: 14px; color: var(--dsw-alias-label-secondary); }
.tpa-select { display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; box-sizing: border-box; width: 100%; min-width: 0; height: 36px; padding: 0 10px 0 12px;
  border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; cursor: pointer; outline: none; }
.tpa-select:hover:not(:disabled), .tpa-select[aria-expanded="true"] { border-color: var(--dsw-alias-border-l2); }
.tpa-select:disabled { cursor: default; opacity: .5; }
.tpa-select > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpa-status { margin: 0; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
.tpa-alert { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 14px; color: var(--dsw-alias-state-error-primary, #d93025); }
.tpa-notice { margin: 0; padding: 48px 0; text-align: center; font-size: 14px; color: var(--dsw-alias-label-secondary); }
.tpa-loading { margin: 0; padding: 32px 0; font-size: 14px; color: var(--dsw-alias-label-secondary); }
.tpa-group { display: grid; gap: 12px; min-width: 0; }
.tpa-group-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.tpa-group-toggle { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; height: 32px; padding: 0; border: 0; border-radius: 6px; background: transparent;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; font-weight: 500; text-align: left; cursor: pointer; outline: none; }
.tpa-group-toggle:focus-visible { background: color-mix(in oklab, var(--dsw-alias-label-primary) 5%, transparent); }
.tpa-group-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpa-chevron { transition: transform 150ms; }
.tpa-group-toggle[aria-expanded="true"] .tpa-chevron { transform: rotate(90deg); }
.tpa-count { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.tpa-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer; outline: none; }
.tpa-icon:hover:not(:disabled), .tpa-icon[aria-expanded="true"] { background: color-mix(in oklab, var(--dsw-alias-label-primary) 5%, transparent); color: var(--dsw-alias-label-primary); }
.tpa-icon:disabled { cursor: default; opacity: .5; }
.tpa-list { overflow: hidden; padding: 0 16px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-base)); }
.tpa-task { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; min-height: 70px; box-sizing: border-box; padding: 12px 0; }
.tpa-task + .tpa-task { border-top: 1px solid var(--dsw-alias-border-l3); }
.tpa-task-text { display: flex; flex-direction: column; gap: 6px; flex: 1 1 200px; min-width: 0; }
.tpa-task-title { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.tpa-task-time { display: block; font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.tpa-task-actions { display: flex; flex: none; align-items: center; gap: 8px; margin-left: auto; }
.tpa-secondary { height: 28px; padding: 0 12px; border: 0; border-radius: 8px; background: color-mix(in oklab, var(--dsw-alias-label-primary) 6%, transparent);
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; cursor: pointer; outline: none; }
.tpa-secondary:hover:not(:disabled) { background: color-mix(in oklab, var(--dsw-alias-label-primary) 10%, transparent); }
.tpa-secondary:disabled { cursor: default; opacity: .5; }
.tpa-more { display: block; width: 100%; height: 32px; margin: 8px 0; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; cursor: pointer; }
.tpa-more:hover { background: color-mix(in oklab, var(--dsw-alias-label-primary) 5%, transparent); }
.tpa-confirm-delete { background: var(--dsw-alias-state-error-primary, #d93025) !important; color: #fff !important; }
`

const PAGE = 50

/** A select-like trigger opening a check menu, standing in for ZCode's Select. */
function SelectMenu({ id, label, value, options, disabled, onChange }: {
  id?: string; label: string; value: string; options: readonly { id: string; label: string }[]; disabled?: boolean; onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(option => option.id === value) ?? options[0]
  return <Menu open={open} onClose={() => setOpen(false)} items={options.map(option => ({ id: option.id, label: option.label }))} selectedId={value}
    portal align="start" minWidthFromAnchor onSelect={next => { setOpen(false); onChange(next) }}
    anchor={<button id={id} type="button" className="tpa-select" disabled={disabled} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(state => !state)}>
      <span>{current?.label}</span><ChevronDown />
    </button>} />
}

/** One Workspace archive disclosure, with a shared inset list surface when expanded. */
function Group({ t, group, name, sort, disabled, format, onAction }: {
  t: Translate; group: ArchiveGroup; name: string; sort: ArchiveSort; disabled: boolean
  format: (time: number) => string; onAction: (tasks: ArchiveTask[], action: 'delete' | 'unarchive') => void
}) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const [menu, setMenu] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const items: MenuEntry[] = [{ id: 'unarchive', label: t('unarchiveAll') }, { id: 'delete', label: t('deleteAll'), danger: true }]
  return <section className="tpa-group" data-testid="archive-group">
    <div className="tpa-group-head">
      <h3 style={{ margin: 0, flex: 1, minWidth: 0, display: 'flex' }}>
        <button type="button" className="tpa-group-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)}>
          <FolderIcon /><span className="tpa-group-name" title={name}>{name}</span><ChevronRight />
        </button>
      </h3>
      <span className="tpa-count">{t('count', { count: group.tasks.length })}</span>
      <Menu open={menu} onClose={() => setMenu(false)} items={items} portal align="end"
        onSelect={id => { setMenu(false); onAction(group.tasks, id === 'delete' ? 'delete' : 'unarchive') }}
        anchor={<button type="button" className="tpa-icon" disabled={disabled} aria-label={t('groupActions', { name })} aria-haspopup="menu" aria-expanded={menu}
          onClick={() => setMenu(value => !value)}><MoreIcon /></button>} />
    </div>
    {open ? <div className="tpa-list" id={listId} role="list" aria-label={name}>
      {group.tasks.slice(0, limit).map(task => <div key={task.id} className="tpa-task" data-testid="archive-task" role="listitem">
        <div className="tpa-task-text">
          <p className="tpa-task-title" title={task.title}>{task.title}</p>
          <time className="tpa-task-time" dateTime={new Date(sort === 'created' ? task.createdAt : task.updatedAt).toISOString()}>
            {format(sort === 'created' ? task.createdAt : task.updatedAt)}
          </time>
        </div>
        <div className="tpa-task-actions">
          <button type="button" className="tpa-icon" disabled={disabled} aria-label={t('deleteTask', { title: task.title })} title={t('delete')}
            onClick={() => onAction([task], 'delete')}><TrashIcon /></button>
          <button type="button" className="tpa-secondary" disabled={disabled} onClick={() => onAction([task], 'unarchive')}>{t('unarchive')}</button>
        </div>
      </div>)}
      {group.tasks.length > limit ? <button type="button" className="tpa-more" onClick={() => setLimit(value => value + PAGE)}>{t('showMore')}</button> : null}
    </div> : null}
  </section>
}

/** ZCode's archive management: delete-all, search, sort, project filter, then the Workspace groups. */
export function ArchivesPage({ t, api, form }: ArchivesPageProps) {
  const workspaces = useSyncExternalStore(listener => api.workspaces.subscribe(listener), () => api.workspaces.getSnapshot())
  const sessions = useSyncExternalStore(listener => api.sessions.subscribe(listener), () => api.sessions.getSnapshot())
  const [stored, setStored] = useState<ArchivedSession[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const request = useRef(0)
  const archivedKey = workspaces.archivedSessionIds.join('\n')
  const refresh = useCallback(async () => {
    const id = ++request.current
    try {
      const value = await api.list()
      if (request.current !== id) return
      setStored(value)
      setState('ready')
    } catch {
      if (request.current === id) setState('error')
    }
  }, [api])
  // The archive set is live; a change from the sidebar or another window refetches the Host list.
  useEffect(() => { void refresh() }, [refresh, archivedKey])

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ArchiveSort>('updated')
  const [project, setProject] = useState('all')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RemoveResult | null>(null)
  const [confirm, setConfirm] = useState<ArchiveTask[] | null>(null)
  const running = useRef(false)
  const sortId = useId()
  const sources = useMemo<ArchiveSources>(() => {
    const archived = new Set(workspaces.archivedSessionIds)
    return { archived: stored.filter(entry => archived.has(entry.sessionId)), sessions: sessions.byId, workspaces: workspaces.items }
  }, [stored, sessions.byId, workspaces])
  const all = useMemo(() => archiveGroups(sources), [sources])
  const groups = useMemo(() => archiveGroups(sources, { query, sort, project }), [sources, query, sort, project])
  const visible = useMemo(() => groups.flatMap(group => group.tasks), [groups])
  const nameOf = (group: ArchiveGroup) => group.title ?? t('unclassified')
  const formatter = useMemo(() => new Intl.DateTimeFormat(document.documentElement.lang || undefined,
    { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), [])

  const run = async (tasks: ArchiveTask[], action: 'delete' | 'unarchive') => {
    if (running.current || tasks.length === 0) return
    running.current = true
    setBusy(true)
    setResult(null)
    try {
      if (action === 'delete') {
        setResult(await api.remove(tasks.map(task => task.id)))
      } else {
        const outcome = { succeeded: 0, failed: 0, skipped: 0 }
        for (const task of tasks) {
          if (!api.workspaces.getSnapshot().archivedSessionIds.includes(task.id)) { outcome.skipped++; continue }
          try { await api.unarchive(task.id); outcome.succeeded++ } catch { outcome.failed++ }
        }
        setResult(outcome)
      }
      await refresh()
    } catch {
      setResult({ succeeded: 0, failed: tasks.length, skipped: 0 })
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const act = (tasks: ArchiveTask[], action: 'delete' | 'unarchive') => {
    if (action === 'delete') setConfirm(tasks)
    else void run(tasks, action)
  }
  const disabled = busy || state === 'error'

  return <section className="tpa-page" data-testid="archive-management">
    <AutoArchiveCard t={t} form={form} onChanged={() => { void api.rescan().catch(() => undefined) }} />
    <div className="tpa-head">
      <h2 className="tpa-title">{t('title')}</h2>
      <button type="button" className="tpa-danger" disabled={disabled || state === 'loading' || visible.length === 0} onClick={() => act(visible, 'delete')}>
        <TrashIcon />{t('deleteAll')}
      </button>
    </div>
    <div className="tpa-filters">
      <div className="tpa-search">
        <SearchIcon />
        <input type="search" value={query} placeholder={t('search')} aria-label={t('search')} onChange={event => setQuery(event.target.value)} />
        {query ? <button type="button" className="tpa-search-clear" aria-label={t('clearSearch')} onClick={() => setQuery('')}><ClearIcon /></button> : null}
      </div>
      <div className="tpa-sort">
        <label htmlFor={sortId} className="tpa-sort-label">{t('sortLabel')}</label>
        <SelectMenu id={sortId} label={t('sortLabel')} value={sort} onChange={value => setSort(value as ArchiveSort)}
          options={[{ id: 'updated', label: t('sortUpdated') }, { id: 'created', label: t('sortCreated') }]} />
      </div>
      <SelectMenu label={t('projectLabel')} value={all.some(group => group.key === project) ? project : 'all'} onChange={setProject}
        options={[{ id: 'all', label: t('allProjects') }, ...all.map(group => ({ id: group.key, label: nameOf(group) }))]} />
    </div>
    {state === 'error' ? <div role="alert" className="tpa-alert">
      <span>{t('loadFailed')}</span>
      <Button variant="outline" onClick={() => { setState('loading'); void refresh() }}>{t('retry')}</Button>
    </div> : null}
    {busy ? <p role="status" className="tpa-status">{t('working')}</p> : null}
    {result ? <p role={result.failed ? 'alert' : 'status'} className="tpa-status">{t('result', result)}</p> : null}
    {state === 'loading' ? <p role="status" className="tpa-loading">{t('loading')}</p>
      : groups.length === 0 && state !== 'error' ? <p className="tpa-notice">{t(all.length ? 'noResults' : 'empty')}</p>
        : groups.map(group => <Group key={group.key} t={t} group={group} name={nameOf(group)} sort={sort} disabled={disabled}
          format={time => formatter.format(time)} onAction={act} />)}
    <Modal open={confirm !== null} title={t('deleteTitle', { count: confirm?.length ?? 0 })} description={t('deleteDescription')} closeLabel={t('cancel')}
      onClose={() => setConfirm(null)}
      footer={<>
        <Button data-modal-autofocus onClick={() => setConfirm(null)}>{t('cancel')}</Button>
        <Button variant="primary" className="tpa-confirm-delete" onClick={() => {
          const tasks = confirm ?? []
          setConfirm(null)
          void run(tasks, 'delete')
        }}>{t('delete')}</Button>
      </>} />
  </section>
}

/** Registrations are withdrawn with the Client plugin fiber. */
export async function apply(ctx: Context): Promise<void> {
  const dispose = await ctx.remote.$mount(archivesRemote)
  ctx.effect(() => dispose)
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@tpcowork/dsh-archives'
    style.textContent = css
    document.head.appendChild(style)
    return () => style.remove()
  })
  // As in ZCode, a removed workspace's sessions leave with it and return when its folder is added again.
  ctx.inject(['uiWorkspace', 'workspaces', 'sessions', 'remote.archiveManager'], uiCtx => {
    installRemovedWorkspaces(uiCtx, async () => {
      const result = await uiCtx.remote.archiveManager.hidden()
      if (!result.ok) throw result.error
      return result.value
    })
  })
  ctx.inject(['configForms', 'slots', 'locale', 'workspaces', 'sessions', 'remote.archiveManager'], uiCtx => {
    uiCtx.effect(() => uiCtx.locale.register(namespace, { en, zh }))
    const t = uiCtx.locale.bind(namespace) as Translate
    const api: ArchivesApi = {
      workspaces: uiCtx.workspaces.list,
      // The Host Session store shares the `sessions` key, so the Client face is named explicitly as DSH's sidebar does.
      sessions: (uiCtx.get('sessions') as unknown as ISessions).list,
      list: async () => {
        const result = await uiCtx.remote.archiveManager.list()
        if (!result.ok) throw result.error
        return archivedSessionsValue.parse(result.value)
      },
      remove: async (sessionIds) => {
        const result = await uiCtx.remote.archiveManager.remove(sessionIds)
        if (!result.ok) throw result.error
        return removeResultValue.parse(result.value)
      },
      unarchive: sessionId => uiCtx.workspaces.unarchiveSession(sessionId as never),
      // Archiving shows up through the live Workspace archive set, so the count is not needed here.
      rescan: async () => {
        const result = await uiCtx.remote.archiveManager.rescan()
        if (!result.ok) throw result.error
      },
    }
    const form = uiCtx.configForms.get<ArchiveSettings>(entry)
    uiCtx.slots.inject('settings.section', () => uiCtx.configForms.whileServed([entry], () => uiCtx.slots.register({
      name: 'settings.section', id: 'archived-sessions', order: 210, label: () => t('nav'), locale: namespace,
      inject: () => ({ api, form }),
    }, ArchivesPage as (props: ArchivesPageProps) => ReturnType<typeof ArchivesPage>)))
  })
}
