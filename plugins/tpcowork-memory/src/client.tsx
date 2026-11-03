/**
 * Client half: the Settings "Memory" section, after ZCode's `MemorySettingsSection` and `MemorySettingsViewer`.
 * The switch writes the Host plugin's volatile `enabled` field; while it is on, the viewer lists the memory files
 * saved on this device by workspace through the Host's read-only `memoryCatalog` Remote.
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { FileTypeIcon, Menu, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { catalogRemote, memoryCatalogValue, type MemoryWorkspaceSummary } from './catalog-remote.ts'
import { en, zh, type MemoryKey } from './locales.ts'
import { formatUpdatedAt } from './updated-at.ts'

const { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React
const namespace = 'settings.memory'
/** The Host entry id from this package's `cordis.patch.yml`. */
const entry = 'tpcowork-memory'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'settings.memory': MemoryKey } }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertClientRemote {
    memoryCatalog: { list(): Promise<RemoteResult<MemoryWorkspaceSummary[]>> }
  }
}
// Keep the remote augmentation reachable for this externally built Client face.
export type MemoryCatalogRemote = TypertClientRemote['memoryCatalog']

export const name = 'tpcowork-memory-client'
export const inject = ['remote']

interface MemorySettings { enabled?: boolean }
type Translate = (key: MemoryKey, params?: Record<string, unknown>) => string

/** One handler the Host desktop offers for a file. */
export interface FileApplication { id: string; name: string; default: boolean; icon: string | null }

/** Native file opening through the Session Remote; absent where the Host has no desktop. */
export interface MemoryOpener {
  available(): Promise<boolean>
  applications(path: string, signal: AbortSignal): Promise<readonly FileApplication[]>
  open(path: string, application?: string): Promise<boolean>
  reveal(path: string): Promise<boolean>
}

export interface MemoryPageProps {
  t: Translate
  form: ConfigForm<MemorySettings>
  catalog: () => Promise<MemoryWorkspaceSummary[]>
  opener?: MemoryOpener | undefined
}

type CatalogState = 'idle' | 'loading' | 'ready' | 'error'

const svg = (children: React.ReactNode, size = 16, className?: string) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
  stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{children}</svg>
const FolderIcon = () => svg(<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />)
const ChevronIcon = ({ size = 16 }: { size?: number }) => svg(<path d="m6 9 6 6 6-6" />, size, 'tpm-subtlest')
const SearchIcon = () => svg(<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>, 16, 'tpm-search-icon')
const ClearIcon = () => svg(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>, 14)
const RefreshIcon = () => svg(<><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></>)
const SpinnerIcon = () => svg(<path d="M21 12a9 9 0 1 1-6.219-8.56" />, 16, 'tpm-spin')

// ZCode's settings parts in DSH tokens: `border` is l3, `card`/`input` layer 1, `surface` and `hover` 3% and 5% ink.
export const css = `
.tpm-page { display: grid; gap: 24px; }
.tpm-card { overflow: hidden; border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.tpm-row { display: grid; grid-template-columns: minmax(0, 1fr) 192px; align-items: center; gap: 16px; padding: 12px 16px; }
.tpm-row-control { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.tpm-label { font-size: 14px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.tpm-description { margin-top: 4px; font-size: 14px; line-height: 24px; color: var(--dsw-alias-label-secondary); }
.tpm-alert { font-size: 14px; color: var(--dsw-alias-state-error-primary, #d93025); }
.tpm-notice { padding: 32px 16px; border: 1px dashed var(--dsw-alias-border-l3); border-radius: 12px; text-align: center; font-size: 14px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.tpm-notice.tpm-search-empty { padding: 40px 16px; }
.tpm-viewer { display: grid; gap: 16px; min-width: 0; }
.tpm-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.tpm-toolbar-start { display: flex; align-items: center; gap: 12px; min-width: 0; }
.tpm-toolbar-end { display: flex; flex: 1; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; }
.tpm-divider { width: 1px; height: 16px; background: var(--dsw-alias-border-l3); }
.tpm-count { flex: none; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
.tpm-scope { display: inline-flex; align-items: center; gap: 4px; height: 28px; max-width: 100%; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; cursor: pointer; transition: background-color 150ms, border-color 150ms; outline: none; }
.tpm-scope:hover, .tpm-scope[aria-expanded="true"] { background: color-mix(in oklab, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-layer-1)); }
.tpm-scope-label { max-width: 192px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpm-subtlest { color: var(--dsw-alias-label-tertiary); flex: none; }
.tpm-search { position: relative; width: 256px; max-width: 100%; }
.tpm-search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--dsw-alias-label-secondary); }
.tpm-search input { box-sizing: border-box; width: 100%; height: 36px; padding: 0 12px 0 36px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; outline: none; transition: border-color 150ms; }
.tpm-search input::placeholder { color: var(--dsw-alias-label-tertiary); }
.tpm-search input:hover { border-color: var(--dsw-alias-border-l2); }
.tpm-search input:focus { border-color: var(--dsw-alias-border-l1); }
.tpm-search input::-webkit-search-cancel-button { appearance: none; }
.tpm-search.tpm-clearable input { padding-right: 36px; }
.tpm-search-clear { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; outline: none; }
.tpm-search-clear:hover { background: color-mix(in oklab, var(--dsw-alias-label-primary) 5%, transparent); }
.tpm-files-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; min-height: 28px; }
.tpm-files-title { margin: 0; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.tpm-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; outline: none; transition: background-color 150ms; }
.tpm-icon-button:hover:not(:disabled) { background: color-mix(in oklab, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-layer-1)); }
.tpm-icon-button:disabled { cursor: default; opacity: .5; }
.tpm-list { overflow: hidden; border-radius: 12px; background: color-mix(in oklab, var(--dsw-alias-label-primary) 3%, transparent); }
.tpm-list-divider { height: 1px; background: color-mix(in oklab, var(--dsw-alias-border-l3) 50%, transparent); }
.tpm-file { display: flex; align-items: center; min-width: 0; transition: background-color 150ms; }
.tpm-file:hover { background: color-mix(in oklab, var(--dsw-alias-label-primary) 5%, transparent); }
.tpm-file-main { display: flex; flex: 1; align-items: center; gap: 12px; min-width: 0; padding: 12px 16px; }
.tpm-file-icon { display: flex; flex: none; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 12px; background: var(--dsw-alias-bg-base); }
.tpm-file-text { flex: 1; min-width: 0; }
.tpm-file-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.tpm-file-updated { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
.tpm-open { flex: none; margin-right: 12px; display: flex; align-items: center; height: 28px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1); transition: border-color 150ms; }
.tpm-open:hover { border-color: var(--dsw-alias-border-l2); }
.tpm-open button { display: inline-flex; align-items: center; justify-content: center; height: 26px; padding: 0; border: 0; border-radius: 0; background: transparent;
  color: var(--dsw-alias-label-primary); cursor: pointer; outline: none; }
.tpm-open button:hover:not(:disabled) { background: color-mix(in oklab, var(--dsw-alias-label-primary) 5%, transparent); }
.tpm-open button:disabled { cursor: default; opacity: .5; }
.tpm-open-main { width: 28px; }
.tpm-open-menu { width: 20px; }
.tpm-open img { width: 16px; height: 16px; object-fit: contain; }
.tpm-menu-icon { width: 16px; height: 16px; object-fit: contain; }
.tpm-spin { animation: tpm-spin 1s linear infinite; }
@keyframes tpm-spin { to { transform: rotate(360deg); } }
`

/** The workspace picker: a pill button opening the list of workspaces that hold memories. */
function ScopeMenu({ t, workspaces, selected, onSelect }: { t: Translate; workspaces: MemoryWorkspaceSummary[]; selected: MemoryWorkspaceSummary; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const items: MenuEntry[] = [
    { type: 'label', id: 'workspaces', text: t('workspaces') },
    ...workspaces.map(workspace => ({ id: workspace.id, label: workspace.label, icon: <FolderIcon /> })),
  ]
  return <Menu open={open} onClose={() => setOpen(false)} items={items} selectedId={selected.id} portal align="start"
    onSelect={id => { setOpen(false); onSelect(id) }}
    anchor={<button type="button" className="tpm-scope" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <FolderIcon />
      <span className="tpm-scope-label">{selected.label}</span>
      <ChevronIcon />
    </button>} />
}

/** The per-file split button: open with the default handler, or choose another handler or the file location. */
function OpenButton({ t, path, opener, applications }: { t: Translate; path: string; opener: MemoryOpener; applications: readonly FileApplication[] | undefined }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const preferred = applications?.find(app => app.default) ?? applications?.[0]
  const run = (work: () => Promise<boolean>) => {
    setBusy(true)
    void work().catch(() => false).finally(() => setBusy(false))
  }
  const items: MenuEntry[] = [
    ...(applications ?? []).map(app => ({ id: `app:${app.id}`, label: app.name,
      icon: app.icon === null ? <FileTypeIcon path={path} size={16} /> : <img className="tpm-menu-icon" src={app.icon} alt="" /> })),
    ...(applications?.length ? [{ type: 'separator' as const, id: 'separator' }] : []),
    { id: 'reveal', label: t('reveal'), icon: <FolderIcon /> },
  ]
  const mainLabel = preferred === undefined ? t('reveal') : `${t('open')} · ${preferred.name}`
  return <span className="tpm-open">
    <button type="button" className="tpm-open-main" aria-label={mainLabel} title={mainLabel} disabled={busy}
      onClick={() => run(() => preferred === undefined ? opener.reveal(path) : opener.open(path, preferred.id))}>
      {preferred?.icon ? <img src={preferred.icon} alt="" /> : preferred ? <FileTypeIcon path={path} size={16} /> : <FolderIcon />}
    </button>
    <Menu open={open} onClose={() => setOpen(false)} items={items} portal align="end"
      onSelect={id => { setOpen(false); run(() => id === 'reveal' ? opener.reveal(path) : opener.open(path, id.slice(4))) }}
      anchor={<button type="button" className="tpm-open-menu" aria-label={t('openWith')} aria-haspopup="menu" aria-expanded={open}
        disabled={busy} onClick={() => setOpen(value => !value)}><ChevronIcon size={14} /></button>} />
  </span>
}

/** ZCode's viewer: workspace picker, memory count, file search, and the file list of the selected workspace. */
function MemoryViewer({ t, state, workspaces, selected, onSelect, onRefresh, opener }: {
  t: Translate; state: CatalogState; workspaces: MemoryWorkspaceSummary[]; selected: MemoryWorkspaceSummary | undefined
  onSelect: (id: string) => void; onRefresh: () => void; opener: MemoryOpener | undefined
}) {
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])
  // Every memory file is Markdown, so one handler query per workspace serves all rows.
  const [desktop, setDesktop] = useState(false)
  const [applications, setApplications] = useState<readonly FileApplication[]>()
  useEffect(() => {
    let live = true
    void opener?.available().then(value => { if (live) setDesktop(value) }, () => undefined)
    return () => { live = false }
  }, [opener])
  const sample = selected?.files[0]?.path
  useEffect(() => {
    setApplications(undefined)
    if (!desktop || opener === undefined || sample === undefined) return undefined
    const controller = new AbortController()
    void opener.applications(sample, controller.signal).then(apps => { if (!controller.signal.aborted) setApplications(apps) }, () => {
      if (!controller.signal.aborted) setApplications([])
    })
    return () => controller.abort()
  }, [desktop, opener, sample])
  const normalized = query.trim().toLocaleLowerCase()
  const visible = useMemo(() => selected?.files.filter(file => file.name.toLocaleLowerCase().includes(normalized)) ?? [], [normalized, selected])

  if (state === 'error') return <div className="tpm-notice" role="alert">{t('failed')}</div>
  if (state === 'loading' && workspaces.length === 0) return <div className="tpm-notice">{t('loading')}</div>
  if (selected === undefined) return <div className="tpm-notice">{t('empty')}</div>
  const count = selected.files.length
  return <section className="tpm-viewer">
    <div className="tpm-toolbar">
      <div className="tpm-toolbar-start">
        <ScopeMenu t={t} workspaces={workspaces} selected={selected} onSelect={onSelect} />
        <div className="tpm-divider" aria-hidden="true" />
        <span className="tpm-count">{t(count === 1 ? 'memoryCountOne' : 'memoryCountOther', { count })}</span>
      </div>
      <div className="tpm-toolbar-end">
        <div className={query ? 'tpm-search tpm-clearable' : 'tpm-search'}>
          <SearchIcon />
          <input type="search" value={query} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} onChange={event => setQuery(event.target.value)} />
          {query ? <button type="button" className="tpm-search-clear" aria-label={t('clearSearch')} onClick={() => setQuery('')}><ClearIcon /></button> : null}
        </div>
      </div>
    </div>
    {normalized && visible.length === 0 ? <div className="tpm-notice tpm-search-empty">{t('searchEmpty')}</div> : <>
      <div className="tpm-files-head">
        <h3 className="tpm-files-title">{t('files')}</h3>
        <button type="button" className="tpm-icon-button" aria-label={t('refresh')} title={t('refresh')} disabled={state === 'loading'} onClick={onRefresh}>
          {state === 'loading' ? <SpinnerIcon /> : <RefreshIcon />}
        </button>
      </div>
      <div className="tpm-list">
        {visible.map((file, index) => <Fragment key={file.name}>
          {index > 0 ? <div className="tpm-list-divider" aria-hidden="true" /> : null}
          <div className="tpm-file">
            <div className="tpm-file-main">
              <span className="tpm-file-icon"><FileTypeIcon path={file.path} size={16} /></span>
              <span className="tpm-file-text">
                <span className="tpm-file-name">{file.name}</span>
                <span className="tpm-file-updated">{formatUpdatedAt(t, now, file.updatedAt)}</span>
              </span>
            </div>
            {desktop && opener !== undefined ? <OpenButton t={t} path={file.path} opener={opener} applications={applications} /> : null}
          </div>
        </Fragment>)}
      </div>
    </>}
  </section>
}

/** The Memory section: ZCode's switch row, then the viewer while memory is on. */
export function MemoryPage({ t, form, catalog, opener }: MemoryPageProps) {
  const snapshot = useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot())
  const enabled = snapshot.value?.enabled === true
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const toggle = (next: boolean) => {
    setSaving(true)
    setFailed(false)
    void form.set('enabled', next).then(accepted => { if (!accepted) setFailed(true) }, () => setFailed(true))
      .finally(() => setSaving(false))
  }
  const request = useRef(0)
  const [state, setState] = useState<CatalogState>('idle')
  const [workspaces, setWorkspaces] = useState<MemoryWorkspaceSummary[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const refresh = useCallback(() => {
    const id = ++request.current
    setState('loading')
    void catalog().then(result => {
      if (request.current !== id) return
      setWorkspaces(result)
      setState('ready')
    }, () => {
      if (request.current !== id) return
      setWorkspaces([])
      setState('error')
    })
  }, [catalog])
  useEffect(() => {
    if (enabled) { refresh(); return }
    request.current++
    setState('idle')
    setWorkspaces([])
    setSelectedId(undefined)
  }, [enabled, refresh])
  const selected = workspaces.find(workspace => workspace.id === selectedId) ?? workspaces[0]
  // The page title comes from the settings navigation, so the section starts with its card.
  return <div className="tpm-page">
    <div className="tpm-card">
      <div className="tpm-row">
        <div style={{ minWidth: 0 }}>
          <div className="tpm-label">{t('switch')}</div>
          <div className="tpm-description">{t('description')}</div>
        </div>
        <div className="tpm-row-control">
          <Switch checked={enabled} onChange={toggle} label={t('switch')}
            disabled={saving || snapshot.status !== 'ready' || !snapshot.writable} />
        </div>
      </div>
    </div>
    {failed ? <div role="alert" className="tpm-alert">{t('failed')}</div> : null}
    {enabled ? <MemoryViewer t={t} state={state} workspaces={workspaces} selected={selected} opener={opener}
      onSelect={setSelectedId} onRefresh={refresh} /> : null}
  </div>
}

/** Registrations are withdrawn with the Client plugin fiber. */
export async function apply(ctx: Context): Promise<void> {
  const dispose = await ctx.remote.$mount(catalogRemote)
  ctx.effect(() => dispose)
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@tpcowork/dsh-memory'
    style.textContent = css
    document.head.appendChild(style)
    return () => style.remove()
  })
  ctx.inject(['configForms', 'slots', 'locale', 'remote.memoryCatalog', 'remote.session'], uiCtx => {
    uiCtx.effect(() => uiCtx.locale.register(namespace, { en, zh }))
    const t = uiCtx.locale.bind(namespace) as Translate
    const form = uiCtx.configForms.get<MemorySettings>(entry)
    const catalog = async () => {
      const result = await uiCtx.remote.memoryCatalog.list()
      if (!result.ok) throw result.error
      return memoryCatalogValue.parse(result.value)
    }
    // Declared in the inject list above: reading an undeclared remote namespace throws, which hid every open button.
    const session = () => uiCtx.remote.session
    const opener: MemoryOpener = {
      available: async () => {
        const result = await session()?.canOpenWorkspacePath()
        return result?.ok === true && result.value === true
      },
      applications: async (path, signal) => {
        const result = await session()?.workspacePathApplications({ path }, signal)
        return result?.ok === true ? result.value : []
      },
      open: async (path, application) => (await session()?.openWorkspacePath({ path, ...application === undefined ? {} : { application } }))?.ok === true,
      reveal: async path => (await session()?.openWorkspacePath({ path, action: 'reveal' }))?.ok === true,
    }
    uiCtx.slots.inject('settings.section', () => uiCtx.configForms.whileServed([entry], () => uiCtx.slots.register({
      name: 'settings.section', id: 'memory', order: 25, label: () => t('nav'), locale: namespace,
      inject: () => ({ form, catalog, opener }),
    }, MemoryPage as (props: MemoryPageProps) => ReturnType<typeof MemoryPage>)))
  })
}
