import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Catalog, McpItem } from '../contracts/index.ts'
import type { Load } from '../client/model.ts'
import { ConfirmRemove, LoadNotice, ReadinessBadge, Reasons, useOperation, type SectionProps } from './shared.tsx'
import type { UiKey } from './locales.ts'
import { visibleMcp } from '../client/visibility.ts'
import { SectionLayout } from './layout.tsx'
import { ToolboxIcon } from './Icon.tsx'
import { McpEditor } from './McpEditor.tsx'
const connectionKeys: Record<McpItem['connection'], UiKey> = { unknown: 'connectionUnknown', disconnected: 'disconnected', connecting: 'connecting', connected: 'connected', reconnecting: 'reconnecting', error: 'error' }

export function Mcp({ load, available, t, query, actions }: SectionProps & { load: Load<Catalog<McpItem>>; available: boolean }) {
  const operation = useOperation(t)
  const probing = useOperation(t)
  const [editor, setEditor] = React.useState<{ item: McpItem | null; revision: number; scrollTop: number } | null>(null)
  const [removing, setRemoving] = React.useState<{ item: McpItem; revision: number } | null>(null)
  const editorId = React.useId()
  const visible = load.value?.items.filter(visibleMcp) ?? []
  const rows = visible.filter(item => item.label.toLowerCase().includes(query.toLowerCase()) || item.id.toLowerCase().includes(query.toLowerCase()))
  const mutable = available && load.value?.complete === true && !load.loading && !load.failed && !operation.busy && !probing.busy
  if (editor) return <McpEditor key={editor.item?.id ?? 'new'} item={editor.item} revision={editor.revision} items={load.value?.items ?? []}
    available={available && load.value?.complete === true && !load.failed} actions={actions} t={t}
    returnFocusId={editor.item ? `${editorId}-edit-${editor.item.id}` : `${editorId}-new`} returnScrollTop={editor.scrollTop} onClose={() => setEditor(null)} />
  return <SectionLayout actions={<Button id={`${editorId}-new`} className="tp-toolbox-primary" icon={<ToolboxIcon name="plus" />} disabled={!mutable} onClick={event => setEditor({ item: null, revision: load.value!.revision, scrollTop: event.currentTarget.closest('.tp-toolbox')?.scrollTop ?? 0 })}>{t('newMcp')}</Button>}>
    <LoadNotice load={load} available={available} empty={!visible.length} t={t} />
    {load.value && !load.value.complete && <p role="alert">{t('incomplete')}</p>}{operation.feedback}{probing.feedback}
    {probing.busy && <Button onClick={probing.cancel}>{t('cancel')}</Button>}
    {!!visible.length && !rows.length && <p className="tp-toolbox-empty">{t('noMatches')}</p>}
    <div className="tp-toolbox-grid">{rows.map(item => <article className="tp-toolbox-card" key={item.id}>
      <div className="tp-toolbox-card-body"><header><h3>{item.label}</h3><ReadinessBadge value={item.readiness} t={t} /></header>
      <p className="tp-toolbox-card-description">{t(item.enabled ? 'enabled' : 'disabled')} · {t(connectionKeys[item.connection])} · {t('tools')}: {item.toolCount}</p><Reasons value={item.readiness} />
      {!!item.credentials.length && <ul className="tp-toolbox-card-credentials">{item.credentials.map(credential => <li key={credential.ref}>{credential.ref}: {t(credential.configured ? 'configured' : 'missing')}</li>)}</ul>}</div>
      <div className="tp-toolbox-actions"><Button id={`${editorId}-edit-${item.id}`} disabled={!mutable} onClick={event => setEditor({ item, revision: load.value!.revision, scrollTop: event.currentTarget.closest('.tp-toolbox')?.scrollTop ?? 0 })}>{t('edit')}</Button>
        <Button disabled={!mutable} onClick={() => { void operation.run(async () => { await actions.mcpEnable({ id: item.id, enabled: !item.enabled, expectedRevision: load.value!.revision }); await actions.refresh() }) }}>{t(item.enabled ? 'disable' : 'enable')}</Button>
        <Button disabled={!mutable} onClick={() => { void probing.run(async signal => { const result = await actions.mcpProbe({ id: item.id }, signal); await actions.refresh(); if (result.readiness.state !== 'ready') throw new Error('toolbox/probe-failed') }, 'probeDone') }}>{t('probe')}</Button>
        <Button disabled={!mutable} onClick={() => setRemoving({ item, revision: load.value!.revision })}>{t('remove')}</Button></div>
    </article>)}</div>
    {removing && <ConfirmRemove name={removing.item.label} busy={operation.busy} disabled={!mutable} feedback={operation.feedback} t={t} onClose={() => setRemoving(null)} onConfirm={() => { void operation.run(async () => {
      await actions.mcpRemove({ id: removing.item.id, expectedRevision: removing.revision }); setRemoving(null); await actions.refresh()
    }, 'removed') }} />}
  </SectionLayout>
}
