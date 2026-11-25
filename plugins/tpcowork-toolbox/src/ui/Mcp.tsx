import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Catalog, McpItem } from '../contracts/index.ts'
import type { Load } from '../client/model.ts'
import { ConfirmRemove, FloatingToast, LoadNotice, ReadinessBadge, Reasons, useFloatingToast, useOperation, type SectionProps } from './shared.tsx'
import { visibleMcp } from '../client/visibility.ts'
import { SectionLayout } from './layout.tsx'
import { ToolboxIcon } from './Icon.tsx'
import { McpEditor } from './McpEditor.tsx'
import { mcpIcon } from './capability-presentation.ts'

export function Mcp({ load, available, t, query, actions }: SectionProps & { load: Load<Catalog<McpItem>>; available: boolean }) {
  const operation = useOperation(t)
  const [probing, setProbing] = React.useState(false)
  const probeToast = useFloatingToast()
  const probeController = React.useRef<AbortController | null>(null)
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const [editor, setEditor] = React.useState<{ item: McpItem | null; revision: number; scrollTop: number } | null>(null)
  const [removing, setRemoving] = React.useState<{ item: McpItem; revision: number } | null>(null)
  const editorId = React.useId()
  React.useEffect(() => () => {
    probeController.current?.abort()
    probeController.current = null
  }, [])
  const runProbe = async (item: McpItem) => {
    if (probeController.current) return
    const current = new AbortController()
    probeController.current = current
    setProbing(true)
    probeToast.show('pending', t('mcpProbing', { name: item.label }))
    try {
      const result = await actions.mcpProbe({ id: item.id }, current.signal)
      await actions.refreshMcp()
      if (current.signal.aborted) return
      if (result.readiness.state === 'ready') {
        probeToast.show('success', t('mcpProbePassed', { name: item.label, count: result.toolCount }))
      } else {
        const reason = result.readiness.reasons[0]?.message?.trim()
        probeToast.show('failure', reason ? t('mcpProbeFailedReason', { name: item.label, reason }) : t('mcpProbeFailed', { name: item.label }))
      }
    } catch {
      if (!current.signal.aborted) probeToast.show('failure', t('mcpProbeFailed', { name: item.label }))
    } finally {
      if (probeController.current === current) {
        probeController.current = null
        if (!current.signal.aborted) setProbing(false)
      }
    }
  }
  const cancelProbe = () => {
    probeController.current?.abort()
    probeController.current = null
    setProbing(false)
    probeToast.show('cancelled', t('cancelled'))
  }
  const openEditor = (next: { item: McpItem | null; revision: number; scrollTop: number }) => {
    probeToast.clear()
    setEditor(next)
  }
  const visible = load.value?.items.filter(visibleMcp) ?? []
  const rows = visible.filter(item => item.label.toLowerCase().includes(query.toLowerCase()) || item.id.toLowerCase().includes(query.toLowerCase()))
  const mutable = available && load.value?.complete === true && !load.loading && !load.failed && !operation.busy && !probing
  if (editor) return <McpEditor key={editor.item?.id ?? 'new'} item={editor.item} revision={editor.revision} items={load.value?.items ?? []}
    available={available && load.value?.complete === true && !load.failed} actions={actions} t={t}
    returnFocusId={editor.item ? `${editorId}-edit-${editor.item.id}` : `${editorId}-new`} returnScrollTop={editor.scrollTop} onClose={() => setEditor(null)} />
  return <SectionLayout actions={<Button id={`${editorId}-new`} className="tp-toolbox-primary" icon={<ToolboxIcon name="plus" />} disabled={!mutable} onClick={event => openEditor({ item: null, revision: load.value!.revision, scrollTop: event.currentTarget.closest('.tp-toolbox')?.scrollTop ?? 0 })}>{t('newMcp')}</Button>}>
    <FloatingToast toast={probeToast.toast} anchor={gridRef} closeLabel={t('mcpProbeClose')} cancelLabel={t('cancel')} onCancel={cancelProbe} onClose={probeToast.clear} />
    <LoadNotice load={load} available={available} empty={!visible.length} t={t} />
    {load.value && !load.value.complete && <p role="alert">{t('incomplete')}</p>}{operation.feedback}
    {!!visible.length && !rows.length && <p className="tp-toolbox-empty">{t('noMatches')}</p>}
    <div ref={gridRef} className="tp-toolbox-grid">{rows.map(item => <article className="tp-toolbox-card" key={item.id}>
      <div className="tp-toolbox-card-body"><header><h3 className="tp-capability-heading"><img src={mcpIcon(item.id)} alt="" /><span>{item.label}</span></h3><ReadinessBadge value={item.readiness} t={t} /></header>
      <p className="tp-toolbox-card-description">{t(item.enabled ? 'enabled' : 'disabled')} · {t('tools')}: {item.toolCount}</p><Reasons value={item.readiness} />
      {!!item.credentials.length && <ul className="tp-toolbox-card-credentials">{item.credentials.map(credential => <li key={credential.ref}>{credential.ref}: {t(credential.configured ? 'configured' : 'missing')}</li>)}</ul>}</div>
      <div className="tp-toolbox-actions">{!item.managed && <><Button id={`${editorId}-edit-${item.id}`} disabled={!mutable} onClick={event => openEditor({ item, revision: load.value!.revision, scrollTop: event.currentTarget.closest('.tp-toolbox')?.scrollTop ?? 0 })}>{t('edit')}</Button>
        <Button disabled={!mutable} onClick={() => { void operation.run(async () => { await actions.mcpEnable({ id: item.id, enabled: !item.enabled, expectedRevision: load.value!.revision }); await actions.refresh() }) }}>{t(item.enabled ? 'disable' : 'enable')}</Button></>}
        <Button disabled={!mutable} onClick={() => { void runProbe(item) }}>{t('probe')}</Button>
        {!item.managed && <Button disabled={!mutable} onClick={() => setRemoving({ item, revision: load.value!.revision })}>{t('remove')}</Button>}</div>
    </article>)}</div>
    {removing && <ConfirmRemove name={removing.item.label} busy={operation.busy} disabled={!mutable} feedback={operation.feedback} t={t} onClose={() => setRemoving(null)} onConfirm={() => { void operation.run(async () => {
      await actions.mcpRemove({ id: removing.item.id, expectedRevision: removing.revision }); setRemoving(null); await actions.refresh()
    }, 'removed') }} />}
  </SectionLayout>
}
