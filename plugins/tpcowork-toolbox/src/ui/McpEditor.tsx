import * as React from 'react'
import type { McpDefinition, McpItem } from '../contracts/index.ts'
import { EditorField, ToolboxEditor } from './Editor.tsx'
import { ToolboxIcon } from './Icon.tsx'
import type { SectionProps } from './shared.tsx'
import { operationFailure } from './shared.tsx'
import { McpFormError } from './mcp-form.ts'
import { generatedMcpId, newPair, previewMcpImport, serverForm, serverValues, type ImportRow, type McpPair, type ServerForm } from './mcp-editor-form.ts'
import type { UiKey } from './locales.ts'
import { mcpIcon } from './capability-presentation.ts'

export function McpEditor({ item, revision, items, available, actions, t, onClose, returnFocusId, returnScrollTop }: {
  item: McpItem | null; revision: number; items: McpItem[]; available: boolean; actions: SectionProps['actions']; t: SectionProps['t']; onClose(): void; returnFocusId: string; returnScrollTop: number
}) {
  const [saved, setSaved] = React.useState<McpDefinition>()
  const [form, setForm] = React.useState(serverForm)
  const [mode, setMode] = React.useState<'remote' | 'local' | 'import'>('remote')
  const [loading, setLoading] = React.useState(!!item)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [retry, setRetry] = React.useState(0)
  const [error, setError] = React.useState<UiKey | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [probe, setProbe] = React.useState<{ ok: boolean; toolCount: number }>()
  const [advanced, setAdvanced] = React.useState(false)
  const [json, setJson] = React.useState('')
  const [preview, setPreview] = React.useState<ImportRow[]>([])
  const [decisions, setDecisions] = React.useState<Record<string, { action: string; name?: string }>>({})
  const currentRevision = React.useRef(revision)
  const controller = React.useRef<AbortController | null>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const titleId = React.useId()
  React.useEffect(() => () => controller.current?.abort(), [])
  React.useEffect(() => {
    if (!item) return
    let active = true
    setLoading(true); setLoadFailed(false)
    void actions.mcpDefinition({ id: item.id }).then(value => {
      if (!active) return
      setSaved(value); setForm(serverForm(value)); setMode(value.transport === 'stdio' ? 'local' : 'remote'); setLoading(false)
    }, () => { if (active) { setLoadFailed(true); setLoading(false) } })
    return () => { active = false }
  }, [item, actions.mcpDefinition, retry])
  const patch = (change: Partial<ServerForm>) => { setError(null); setProbe(undefined); setForm(previous => ({ ...previous, ...change })) }
  const close = () => { if (!controller.current || busy === 'probe') { controller.current?.abort(); onClose() } }
  const run = async (kind: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current) return
    const active = new AbortController(); controller.current = active; setBusy(kind); setError(null)
    try { await work(active.signal) }
    catch (error) {
      if (!active.signal.aborted) {
        const key = error instanceof McpFormError ? error.key : operationFailure(error)
        setError(key)
        if (['invalidMcpId', 'invalidMcpCwd', 'invalidMcpConnectTimeout', 'invalidMcpToolTimeout'].includes(key)) setAdvanced(true)
      }
    } finally { if (controller.current === active) { controller.current = null; setBusy(null) } }
  }
  const submit = (testOnly: boolean) => run(testOnly ? 'probe' : 'save', async signal => {
    const entry = serverValues(form, generatedMcpId(form.label, items), saved)
    if (testOnly) { setProbe(undefined); const result = await actions.mcpProbeDraft(entry, signal); if (!signal.aborted) setProbe(result); return }
    await (saved ? actions.mcpUpdate : actions.mcpCreate)({ expectedRevision: currentRevision.current, ...entry })
    // Remember the saved identity before testing, so a failed connection can be
    // edited and retried without creating a duplicate server or re-sending secrets.
    const definition = entry.definition
    setSaved(definition); setForm(serverForm(definition))
    if (definition.enabled) {
      try {
        const result = await actions.mcpProbe({ id: definition.id }, signal)
        if (result.readiness.state !== 'ready') { setProbe({ ok: false, toolCount: 0 }); setError('mcpSavedConnectionFailed'); return }
      } catch { setProbe({ ok: false, toolCount: 0 }); setError('mcpSavedConnectionFailed'); return }
      finally { currentRevision.current = (await actions.mcpInventory()).revision; await actions.refresh() }
    } else await actions.refresh()
    onClose()
  })
  const setImportText = (value: string) => { setJson(value); setPreview([]); setDecisions({}); setError(null) }
  const parseImport = () => {
    try {
      const rows = previewMcpImport(json, items)
      setPreview(rows); setDecisions(Object.fromEntries(rows.map(row => [row.originalId, { action: row.error ? 'skip' : row.conflict ? '' : 'add' }]))); setError(null)
    } catch (error) { setError(error instanceof McpFormError ? error.key : 'invalidMcpImport') }
  }
  const canImport = preview.some(row => decisions[row.originalId]?.action && decisions[row.originalId]?.action !== 'skip') && preview.every(row => {
    const choice = decisions[row.originalId]
    return choice?.action === 'skip' || (!row.error && choice?.action && (choice.action !== 'rename' || /^[A-Za-z0-9_-]{1,32}$/.test(choice.name ?? '')))
  })
  const commitImport = () => run('import', async () => {
    const entries = []
    for (const row of preview) {
      const choice = decisions[row.originalId]!
      if (choice.action === 'skip') continue
      const previous = choice.action === 'replace' ? await actions.mcpDefinition({ id: row.originalId }) : undefined
      entries.push({ ...serverValues({ ...row.form, id: choice.action === 'rename' ? choice.name! : row.originalId }, row.originalId, previous), replace: choice.action === 'replace' })
    }
    await actions.mcpImport({ expectedRevision: currentRevision.current, entries }); await actions.refresh(); onClose()
  })
  const blocked = !available || loading || loadFailed || !!busy
  const title = t(item ? 'editMcpServer' : 'addMcpServer')
  return <ToolboxEditor title={title} subtitle={t('mcpEditorHint')} section="mcp" t={t} className="tp-mcp-editor" noValidate
    visual={<img className="tp-capability-detail-icon" src={mcpIcon(saved?.id ?? item?.id ?? '')} alt="" />}
    pending={!!busy && busy !== 'probe'} disabled={blocked} returnFocusId={returnFocusId} returnScrollTop={returnScrollTop}
    onClose={close} onSubmit={() => { if (mode === 'import') { if (canImport) void commitImport() } else void submit(false) }}
    toolbarActions={<>
      <button type="button" className="tp-mcp-outline" disabled={!!busy && busy !== 'probe'} onClick={close}>{t('cancel')}</button>
        {mode === 'import' ? <><button type="button" className="tp-mcp-outline" disabled={blocked || !json.trim()} onClick={parseImport}><ToolboxIcon name="json" size={14} />{t('mcpPreview')}</button><button type="submit" className="tp-toolbox-primary" disabled={blocked || !canImport}><ToolboxIcon name={busy === 'import' ? 'spinner' : 'check'} size={14} />{t('mcpConfirmImport')}</button></> : <><button type="button" className="tp-mcp-outline" disabled={blocked} onClick={() => void submit(true)}><ToolboxIcon name={busy === 'probe' ? 'spinner' : 'play'} size={14} />{t('mcpTestConnection')}</button><button type="submit" className="tp-toolbox-primary" disabled={blocked || !form.label.trim() || !(mode === 'local' ? form.command.trim() : form.endpoint.trim())}><ToolboxIcon name={busy === 'save' ? 'spinner' : 'check'} size={14} />{t(saved?.enabled === false ? 'mcpSaveChanges' : 'mcpSaveConnect')}</button></>}
    </>}>
      {!item && !saved && <nav className="tp-mcp-modes" aria-label={t('mcpMethod')}>
        {(['remote', 'local', 'import'] as const).map(value => <button key={value} type="button" disabled={blocked} aria-pressed={mode === value} onClick={() => { setMode(value); patch({ transport: value === 'local' ? 'stdio' : 'streamable-http' }) }}>
          <ToolboxIcon name={value === 'remote' ? 'globe' : value === 'local' ? 'terminal' : 'json'} size={15} />{t(value === 'remote' ? 'mcpRemote' : value === 'local' ? 'mcpLocal' : 'mcpImportConfig')}
        </button>)}
      </nav>}
      <div className="tp-mcp-body">
        {loading && <p role="status">{t('loading')}</p>}{loadFailed && <div><p role="alert">{t('failed')}</p><button type="button" onClick={() => setRetry(value => value + 1)}>{t('refresh')}</button></div>}
        {error && <div className="tp-mcp-feedback error" role="alert">{t(error)}</div>}
        {mode === 'import' ? <fieldset disabled={blocked} className="tp-mcp-fields">
          <div className="tp-mcp-field-heading"><label htmlFor={`${titleId}-json`}>{t('mcpConfigJson')}</label><button type="button" className="tp-mcp-outline" onClick={() => fileInput.current?.click()}><ToolboxIcon name="upload" size={14} />{t('mcpChooseFile')}</button></div>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''
            if (!file) return
            if (file.size > 1024 * 1024) { setError('mcpImportTooLarge'); return }
            void file.text().then(setImportText, () => setError('mcpFileReadFailed'))
          }} />
          <textarea id={`${titleId}-json`} className="tp-mcp-json" value={json} onChange={event => setImportText(event.target.value)} spellCheck={false} placeholder={'{\n  "mcpServers": {\n    "docs": { "url": "https://example.com/mcp" }\n  }\n}'} />
          {preview.map(row => <div className="tp-mcp-import-entry" key={row.originalId}>
            <div className="tp-mcp-import-name"><strong>{row.form.label}</strong><span>{row.originalId} · {row.form.transport}</span></div>
            {row.error && <p className="tp-mcp-error">{t(row.error as UiKey)}</p>}
            <select aria-label={`${row.form.label} ${t('mcpImportAction')}`} value={decisions[row.originalId]?.action ?? ''} onChange={event => setDecisions(previous => ({ ...previous, [row.originalId]: { action: event.target.value } }))}>
              {row.error ? <option value="skip">{t('mcpSkip')}</option> : row.conflict ? <><option value="">{t('mcpConflict')}</option><option value="replace">{t('mcpReplace')}</option><option value="rename">{t('mcpRename')}</option><option value="skip">{t('mcpSkip')}</option></> : <><option value="add">{t('mcpAdd')}</option><option value="skip">{t('mcpSkip')}</option></>}
            </select>
            {decisions[row.originalId]?.action === 'rename' && <input aria-label={`${row.form.label} ${t('mcpNewId')}`} value={decisions[row.originalId]?.name ?? ''} placeholder="docs-2" onChange={event => setDecisions(previous => ({ ...previous, [row.originalId]: { action: 'rename', name: event.target.value } }))} />}
          </div>)}
        </fieldset> : <fieldset disabled={blocked} className="tp-mcp-fields">
          <EditorField label={t('mcpServiceName')}><input maxLength={120} value={form.label} placeholder={t('mcpServiceNamePlaceholder')} onChange={event => patch({ label: event.target.value })} /></EditorField>
          {mode === 'remote' ? <>
            <EditorField label={t('mcpServerUrl')}><input value={form.endpoint} placeholder="https://example.com/mcp" spellCheck={false} onChange={event => patch({ endpoint: event.target.value })} /></EditorField>
            <EditorField label={t('mcpAuth')}><select value={form.auth} onChange={event => patch({ auth: event.target.value as ServerForm['auth'] })}><option value="none">{t('mcpAuthNone')}</option><option value="bearer">Bearer Token</option><option value="headers">{t('mcpAuthHeaders')}</option></select></EditorField>
            {form.auth === 'bearer' && <EditorField label={t('mcpAccessToken')}><input type="password" autoComplete="new-password" value={form.token} onChange={event => patch({ token: event.target.value })} /></EditorField>}
            {form.auth === 'headers' && <PairEditor label={t('mcpHeaders')} rows={form.headers} onChange={headers => patch({ headers })} t={t} />}
          </> : <>
            <EditorField label={t('mcpExecutable')}><input value={form.command} placeholder="npx / uvx / /path/to/program" spellCheck={false} onChange={event => patch({ command: event.target.value })} /></EditorField>
            <div className="tp-mcp-field-heading"><span>{t('mcpArguments')}</span><button type="button" className="tp-mcp-icon" aria-label={t('mcpAddArgument')} onClick={() => patch({ args: [...form.args, ''] })}><ToolboxIcon name="plus" size={15} /></button></div>
            {form.args.map((arg, index) => <div className="tp-mcp-argument" key={index}><input aria-label={t('mcpArgumentNumber', { number: index + 1 })} value={arg} spellCheck={false} onChange={event => patch({ args: form.args.map((value, i) => i === index ? event.target.value : value) })} /><button type="button" className="tp-mcp-icon" aria-label={t('mcpRemoveArgument', { number: index + 1 })} onClick={() => patch({ args: form.args.filter((_, i) => i !== index) })}><ToolboxIcon name="trash" size={15} /></button></div>)}
            <PairEditor label={t('mcpEnvironment')} rows={form.env} onChange={env => patch({ env })} t={t} />
          </>}
          <details className="tp-mcp-advanced" open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}><summary>{t('mcpAdvanced')}</summary><div className="tp-mcp-fields">
            <EditorField label={t('mcpServerId')}><input value={form.id} readOnly={!!saved} maxLength={32} placeholder={t('mcpAutoId')} spellCheck={false} onChange={event => patch({ id: event.target.value })} /></EditorField>
            {mode === 'remote' ? <EditorField label={t('mcpProtocol')}><select value={form.transport} onChange={() => {}}><option value="streamable-http">Streamable HTTP</option><option value="sse" disabled>SSE (Legacy)</option></select></EditorField> : <EditorField label={t('mcpWorkingDirectory')}><input value={form.cwd} placeholder={t('mcpOptional')} onChange={event => patch({ cwd: event.target.value })} /></EditorField>}
            {!!form.query.length && mode === 'remote' && <PairEditor label={t('credentialQuery')} rows={form.query} onChange={query => patch({ query })} t={t} />}
            <div className="tp-mcp-timeouts"><EditorField label={t('mcpConnectTimeout')}><input type="number" min={1} max={300} value={form.connectTimeout} onChange={event => patch({ connectTimeout: event.target.value })} /></EditorField><EditorField label={t('mcpToolTimeout')}><input type="number" min={1} max={600} value={form.toolTimeout} onChange={event => patch({ toolTimeout: event.target.value })} /></EditorField></div>
          </div></details>
        </fieldset>}
        {probe && <div className={`tp-mcp-feedback ${probe.ok ? 'success' : 'error'}`} role="status">{t(probe.ok ? 'mcpTestPassed' : 'mcpTestFailed', { count: probe.toolCount })}</div>}
      </div>
  </ToolboxEditor>
}

function PairEditor({ label, rows, onChange, t }: { label: string; rows: McpPair[]; onChange(rows: McpPair[]): void; t: SectionProps['t'] }) {
  return <div className="tp-mcp-pairs"><div className="tp-mcp-field-heading"><span>{label}</span><button type="button" className="tp-mcp-icon" aria-label={t('mcpAddPair', { label })} onClick={() => onChange([...rows, newPair()])}><ToolboxIcon name="plus" size={15} /></button></div>
    {rows.map((row, index) => <div className="tp-mcp-pair" key={row.id}>
      <input aria-label={t('mcpPairKey', { label, number: index + 1 })} value={row.key} readOnly={!!row.ref} placeholder={t('mcpPairName')} spellCheck={false} onChange={event => onChange(rows.map(item => item.id === row.id ? { ...item, key: event.target.value } : item))} />
      <input aria-label={t('mcpPairValue', { label, number: index + 1 })} type="password" autoComplete="new-password" value={row.value} placeholder={t(row.ref ? 'mcpStoredValue' : 'mcpValue')} onChange={event => onChange(rows.map(item => item.id === row.id ? { ...item, value: event.target.value } : item))} />
      <button type="button" className="tp-mcp-icon" aria-label={t('mcpRemovePair', { label, number: index + 1 })} onClick={() => onChange(rows.filter(item => item.id !== row.id))}><ToolboxIcon name="trash" size={15} /></button>
    </div>)}
  </div>
}
