/** PromptHub presentation; credentials, downloads and installation stay on the Host. */
import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Catalog, PromptHubApi, PromptHubSkill, SkillItem } from '../../contracts/index.ts'
import { type SectionProps } from '../shared.tsx'
import { failureKey, visibleFailure, useHubOperation as useOperation } from './operation.tsx'
import type { UiKey } from '../locales.ts'
import { SectionLayout } from '../layout.tsx'
import { ToolboxDetail } from '../Editor.tsx'
import { ToolboxIcon } from '../Icon.tsx'

type Snapshot = Awaited<ReturnType<PromptHubApi['detail']>>
function downloadable(item: PromptHubSkill) {
  // Older public catalog responses omit moderation fields.
  return (!item.visibility && !item.approvalStatus) || (item.visibility === 'public' && item.approvalStatus === 'approved')
}
function Badges({ item, installed, t }: { item: PromptHubSkill; installed: boolean; t: SectionProps['t'] }) {
  return <><span className="tp-store-badge" data-tone="store">{t('storeBadge')}</span>
    {['pending', 'rejected'].includes(item.approvalStatus ?? '') && <span className="tp-store-badge" data-tone={item.approvalStatus}>{t(item.approvalStatus === 'pending' ? 'storePending' : 'storeRejected')}</span>}
    {installed && <span className="tp-store-badge" data-tone="installed">{t('installed')}</span>}</>
}
export function PromptHub({ available, epoch, skills, t, query, actions }: SectionProps & { available: boolean; epoch: number; skills: Catalog<SkillItem> | null }) {
  const [account, setAccount] = React.useState<Awaited<ReturnType<PromptHubApi['account']>> | null>(null)
  const [rows, setRows] = React.useState<PromptHubSkill[]>([])
  const [cursor, setCursor] = React.useState<string | undefined>()
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState<UiKey | null>(null)
  const [detail, setDetail] = React.useState<{ item: PromptHubSkill; focusId: string; scrollTop: number } | null>(null)
  const [update, setUpdate] = React.useState<PromptHubSkill | null>(null)
  const [installedNames, setInstalledNames] = React.useState<string[]>([])
  const [acting, setActing] = React.useState<string | null>(null)
  const [revision, setRevision] = React.useState(0)
  const generation = React.useRef(0)
  const operation = useOperation(t)
  const listId = React.useId()
  const refresh = () => setRevision(value => value + 1)
  React.useEffect(() => { setInstalledNames([]) }, [skills])
  React.useEffect(() => {
    if (!available) return
    let active = true
    generation.current++
    const controller = new AbortController()
    setLoading(true); setFailed(null); setRows([]); setCursor(undefined)
    void (async () => {
      try {
        const status = await actions.hubAccount()
        if (!active) return
        setAccount(status)
        if (!status.configured) { setDetail(null); setUpdate(null); return }
        const page = await actions.hubList({ query }, controller.signal)
        if (active) { setRows(page.items); setCursor(page.cursor) }
      } catch (error) {
        if (active) {
          setFailed(failureKey(error))
          void actions.hubAccount().then(status => { if (active) setAccount(status) }, () => {})
        }
      } finally { if (active) setLoading(false) }
    })()
    return () => { active = false; controller.abort(); generation.current++ }
  }, [available, epoch, query, revision, actions.hubAccount, actions.hubList])
  const isInstalled = (item: PromptHubSkill) => installedNames.includes(item.name.toLowerCase()) || !!skills?.items.some(local => local.installed && ['user', 'prompthub'].includes(local.origin) && local.name.toLowerCase() === item.name.toLowerCase())
  const canInstall = !!account?.configured && !!skills?.complete && !operation.busy
  const install = (item: PromptHubSkill, replace = false, snapshot?: Snapshot) => {
    if (!canInstall || !downloadable(item)) return
    void operation.run(async signal => {
      setActing(item.id)
      try {
        const source = snapshot ?? await actions.hubDetail({ id: item.id }, signal)
        if (!downloadable({ ...item, ...source.skill })) throw { code: 'prompthub/package-changed' }
        const result = await actions.hubInstall({ requestId: crypto.randomUUID(), source: { kind: 'prompthub', skillId: item.id, versionId: source.skill.versionId, fingerprint: source.fingerprint }, scope: { kind: 'user' }, conflict: replace ? 'replace-owned' : 'reject' }, signal)
        if (result.state === 'failed' || result.state === 'cancelled') throw result.error ?? { code: result.state === 'cancelled' ? 'prompthub/cancelled' : 'prompthub/operation-failed' }
        if (signal.aborted) return
        setInstalledNames(previous => [...new Set([...previous, item.name.toLowerCase()])])
        setUpdate(null)
        await actions.refresh()
      } finally { setActing(null) }
    }, 'storeDownloaded')
  }
  const download = (item: PromptHubSkill, snapshot?: Snapshot) => { if (isInstalled(item)) setUpdate(item); else install(item, false, snapshot) }
  const failure = visibleFailure(failed)
  const updateDialog = update && <Modal open className="tp-toolbox-dialog" contentClassName="tp-toolbox-dialog-content" title={t('update')} closeLabel={t('close')} onClose={() => { if (!operation.busy) setUpdate(null) }}>
    <p>{t('storeUpdateConfirm', { name: update.name })}</p><p>{t('hubConflict')}</p>{operation.feedback}
    <div className="tp-toolbox-actions"><Button disabled={operation.busy} onClick={() => setUpdate(null)}>{t('cancel')}</Button><Button className="tp-toolbox-primary" disabled={!canInstall} onClick={() => install(update, true)}>{t('update')}</Button>
      {operation.busy && <Button onClick={operation.cancel}>{t('storeCancelDownload')}</Button>}</div>
  </Modal>
  if (detail) return <><HubDetail key={detail.item.id} item={detail.item} installed={isInstalled(detail.item)} actions={actions} t={t} canInstall={canInstall} busy={operation.busy} feedback={!update && operation.feedback} returnFocusId={detail.focusId} returnScrollTop={detail.scrollTop}
    onDownload={snapshot => download({ ...detail.item, ...snapshot.skill }, snapshot)} onCancel={operation.cancel} onClose={() => { if (!operation.busy) setDetail(null) }} />{updateDialog}</>
  if (!available) return <SectionLayout><p role="status">{t('unavailable')}</p></SectionLayout>
  return <SectionLayout>
    {loading && <div className="tp-store-loading" role="status"><ToolboxIcon name="spinner" size={20} />{t('storeLoading')}</div>}
    {failure && <><p role="alert">{t(failure)}</p><Button onClick={refresh}>{t('refresh')}</Button></>}
    {!update && operation.feedback}
    {!loading && !failed && account?.configured && !rows.length && <p className="tp-toolbox-empty">{t(query.trim() ? 'noMatches' : 'storeEmpty')}</p>}
    <div className="tp-store-list" aria-busy={loading}>{rows.map((item, index) => {
      const installed = isInstalled(item), busy = acting === item.id
      return <article className="tp-store-card" key={item.id} data-skill-store-card>
        <button id={`${listId}-${index}`} type="button" className="tp-store-open" aria-label={`${t('detail')}: /${item.name}`} disabled={operation.busy} onClick={event => setDetail({ item, focusId: event.currentTarget.id, scrollTop: event.currentTarget.closest('.tp-toolbox')?.scrollTop ?? 0 })}>
          <span className="tp-store-icon"><ToolboxIcon name="report" size={18} /></span>
          <span className="tp-store-card-body"><span className="tp-store-card-title"><span className="tp-store-name">/{item.name}</span><Badges item={item} installed={installed} t={t} /></span>
            <span className="tp-store-description">{item.description || t('storeNoDescription')}</span>
            {!!item.tags?.length && <span className="tp-store-tags">{item.tags.join(' · ')}</span>}
          </span>
        </button>
        {downloadable(item) && <button type="button" className="tp-store-download" aria-label={`${t(installed ? 'update' : 'storeDownload')}: /${item.name}`} title={t(installed ? 'update' : 'storeDownload')} disabled={!canInstall} onClick={() => download(item)}>
          <ToolboxIcon name={busy ? 'spinner' : installed ? 'refresh' : 'download'} size={17} />
        </button>}
      </article>
    })}</div>
    {cursor && <div className="tp-store-more"><Button disabled={loading || operation.busy} onClick={() => { void operation.run(async signal => {
      const expected = generation.current
      const page = await actions.hubList({ query, cursor }, signal)
      if (generation.current !== expected) return
      setRows(previous => [...previous, ...page.items.filter(item => !previous.some(row => row.id === item.id))]); setCursor(page.cursor)
    }, null) }}>{t('more')}</Button></div>}
    {operation.busy && !update && <Button onClick={operation.cancel}>{t('storeCancelDownload')}</Button>}
    {updateDialog}
  </SectionLayout>
}
function HubDetail({ item, installed, actions, t, onClose, onDownload, onCancel, canInstall, busy, feedback, returnFocusId, returnScrollTop }: {
  item: PromptHubSkill; installed: boolean; actions: SectionProps['actions']; t: SectionProps['t']; onClose(): void; onDownload(snapshot: Snapshot): void; onCancel(): void; canInstall: boolean; busy: boolean; feedback: React.ReactNode; returnFocusId: string; returnScrollTop: number
}) {
  const [detail, setDetail] = React.useState<Snapshot | null>(null)
  const [failed, setFailed] = React.useState<UiKey | null>(null)
  const [retry, setRetry] = React.useState(0)
  React.useEffect(() => { let active = true; const controller = new AbortController(); setFailed(null); setDetail(null); void actions.hubDetail({ id: item.id, preview: true }, controller.signal).then(value => { if (active) setDetail(value) }, error => { if (active) setFailed(failureKey(error)) }); return () => { active = false; controller.abort() } }, [item.id, actions.hubDetail, retry])
  const current = { ...item, ...detail?.skill }
  const failure = visibleFailure(failed)
  return <ToolboxDetail title={`/${current.name}`} subtitle={current.description || t('storeNoDescription')} section="prompthub" t={t} pending={busy} onClose={onClose} returnFocusId={returnFocusId} returnScrollTop={returnScrollTop} className="tp-store-detail"
    actions={<>{downloadable(current) && <Button className="tp-toolbox-primary" disabled={!detail?.skill.versionId || !canInstall} onClick={() => { if (detail) onDownload(detail) }}><ToolboxIcon name={busy ? 'spinner' : installed ? 'refresh' : 'download'} />{t(installed ? 'update' : 'storeDownload')}</Button>}{busy && <Button onClick={onCancel}>{t('storeCancelDownload')}</Button>}</>}>
    <div className="tp-store-detail-meta"><Badges item={current} installed={installed} t={t} />{current.version && <span>{t('version')} {current.version}</span>}</div>
    {!!current.tags?.length && <div className="tp-store-detail-tags">{current.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
    {feedback}
    {failure ? <div><p role="alert">{t(failure)}</p><Button onClick={() => setRetry(value => value + 1)}>{t('refresh')}</Button></div> : !detail && !failed ? <div className="tp-store-loading" role="status"><ToolboxIcon name="spinner" size={20} />{t('loading')}</div> : detail && <>
      <section className="tp-toolbox-detail-section"><h2>{t('skillContent')}</h2><pre className="tp-toolbox-content">{detail.content || t('storeNoContent')}</pre></section>
      <section className="tp-toolbox-detail-section"><h2>{t('resources')} · {detail.files.length}</h2><ul className="tp-toolbox-detail-list">{detail.files.map(file => <li key={file.path}>{file.path} ({file.size})</li>)}</ul></section>
    </>}
  </ToolboxDetail>
}
