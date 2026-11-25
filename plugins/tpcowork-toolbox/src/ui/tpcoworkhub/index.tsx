/** TpcoworkHub presentation; credentials, downloads and installation stay on the Host. */
import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Catalog, TpcoworkHubApi, TpcoworkHubSkill, SkillItem } from '../../contracts/index.ts'
import { FloatingToast, useFloatingToast, type SectionProps } from '../shared.tsx'
import { failureKey, visibleFailure, useHubOperation as useOperation } from './operation.tsx'
import type { UiKey } from '../locales.ts'
import { SectionLayout } from '../layout.tsx'
import { ToolboxDetail } from '../Editor.tsx'
import { ToolboxIcon } from '../Icon.tsx'

type Snapshot = Awaited<ReturnType<TpcoworkHubApi['detail']>>
function downloadable(item: TpcoworkHubSkill) {
  // Older public catalog responses omit moderation fields.
  return (!item.visibility && !item.approvalStatus) || (item.visibility === 'public' && item.approvalStatus === 'approved')
}
function Badges({ item, installed, t }: { item: TpcoworkHubSkill; installed: boolean; t: SectionProps['t'] }) {
  return <><span className="tp-store-badge" data-tone="store">{t('storeBadge')}</span>
    {['pending', 'rejected'].includes(item.approvalStatus ?? '') && <span className="tp-store-badge" data-tone={item.approvalStatus}>{t(item.approvalStatus === 'pending' ? 'storePending' : 'storeRejected')}</span>}
    {installed && <span className="tp-store-badge" data-tone="installed">{t('installed')}</span>}</>
}
export function TpcoworkHub({ available, epoch, skills, t, query, actions }: SectionProps & { available: boolean; epoch: number; skills: Catalog<SkillItem> | null }) {
  const [account, setAccount] = React.useState<Awaited<ReturnType<TpcoworkHubApi['account']>> | null>(null)
  const [rows, setRows] = React.useState<TpcoworkHubSkill[]>([])
  const [cursor, setCursor] = React.useState<string | undefined>()
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState<UiKey | null>(null)
  const [detail, setDetail] = React.useState<{ item: TpcoworkHubSkill; focusId: string; scrollTop: number } | null>(null)
  const [update, setUpdate] = React.useState<TpcoworkHubSkill | null>(null)
  const [installedIds, setInstalledIds] = React.useState<string[]>([])
  const [installing, setInstalling] = React.useState(false)
  const [acting, setActing] = React.useState<string | null>(null)
  const [revision, setRevision] = React.useState(0)
  const generation = React.useRef(0)
  const installController = React.useRef<AbortController | null>(null)
  const mountedRef = React.useRef(true)
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const installToast = useFloatingToast()
  const operation = useOperation(t)
  const listId = React.useId()
  const refresh = () => setRevision(value => value + 1)
  React.useEffect(() => { setInstalledIds([]) }, [skills])
  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      installController.current?.abort()
      installController.current = null
    }
  }, [])
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
  const isInstalled = (item: TpcoworkHubSkill) => installedIds.includes(item.id) || !!skills?.items.some(local => local.installed && ['user', 'tpcoworkhub'].includes(local.origin) && (local.hubSkillId === item.id || local.name.toLowerCase() === item.name.toLowerCase()))
  const canInstall = !!account?.configured && !!skills?.complete && !installing && !operation.busy
  const cancelInstall = () => { installController.current?.abort() }
  const install = (item: TpcoworkHubSkill, replace = false, snapshot?: Snapshot) => {
    if (!canInstall || !downloadable(item) || installController.current) return
    const current = new AbortController()
    installController.current = current
    setInstalling(true)
    setActing(item.id)
    installToast.show('pending', t(replace ? 'storeUpdating' : 'storeDownloading', { name: item.name }))
    void (async () => {
      try {
        const source = snapshot ?? await actions.hubDetail({ id: item.id }, current.signal)
        if (!downloadable({ ...item, ...source.skill })) throw { code: 'tpcoworkhub/package-changed' }
        const result = await actions.hubInstall({ requestId: crypto.randomUUID(), source: { kind: 'tpcoworkhub', skillId: item.id, versionId: source.skill.versionId, fingerprint: source.fingerprint }, scope: { kind: 'user' }, conflict: replace ? 'replace-owned' : 'reject' }, current.signal)
        if (result.state === 'failed' || result.state === 'cancelled') throw result.error ?? { code: result.state === 'cancelled' ? 'tpcoworkhub/cancelled' : 'tpcoworkhub/operation-failed' }
        if (!mountedRef.current) return
        if (current.signal.aborted) {
          setUpdate(null)
          installToast.show('cancelled', t('cancelled'))
          return
        }
        setInstalledIds(previous => [...new Set([...previous, item.id])])
        setUpdate(null)
        try { await actions.refreshSkills() } catch { /* Local catalog errors are surfaced in Skills. */ }
        if (!mountedRef.current) return
        installToast.show('success', t(replace ? 'storeUpdateSucceeded' : 'storeDownloadSucceeded', { name: item.name }))
      } catch (error) {
        if (!mountedRef.current) return
        setUpdate(null)
        const key = failureKey(error)
        if (current.signal.aborted && key !== 'hubUncertain') {
          installToast.show('cancelled', t('cancelled'))
        } else {
          const visible = visibleFailure(key)
          if (visible) {
            installToast.show('failure', t(replace ? 'storeUpdateFailedReason' : 'storeDownloadFailedReason', { name: item.name, reason: t(visible) }))
          } else {
            installToast.clear()
            void actions.hubAccount().then(status => { if (mountedRef.current) setAccount(status) }, () => {})
          }
        }
      } finally {
        if (installController.current === current) installController.current = null
        if (mountedRef.current) { setActing(null); setInstalling(false) }
      }
    })()
  }
  const download = (item: TpcoworkHubSkill, snapshot?: Snapshot) => { if (isInstalled(item)) setUpdate(item); else install(item, false, snapshot) }
  const failure = visibleFailure(failed)
  const toastNode = <FloatingToast toast={installToast.toast} anchor={anchorRef} closeLabel={t('storeToastClose')} cancelLabel={t('storeCancelDownload')} onCancel={cancelInstall} onClose={installToast.clear} />
  const updateDialog = update && <Modal open className="tp-toolbox-dialog tp-confirm-dialog" contentClassName="tp-toolbox-dialog-content" title={t('update')} description={`${t('storeUpdateConfirm', { name: update.name })}\n${t('hubConflict')}`} closeLabel={t('close')} showCloseButton={false} onClose={() => { if (!installing) setUpdate(null) }}
    footer={<><Button variant="outline" data-modal-autofocus disabled={installing} onClick={() => setUpdate(null)}>{t('cancel')}</Button>
      <Button variant="primary" disabled={!canInstall} onClick={() => install(update, true)}>{t('update')}</Button></>} />
  if (detail) return <>{toastNode}<HubDetail key={detail.item.id} item={detail.item} installed={isInstalled(detail.item)} actions={actions} t={t} canInstall={canInstall} busy={installing} anchorRef={anchorRef} returnFocusId={detail.focusId} returnScrollTop={detail.scrollTop}
    onDownload={snapshot => download({ ...detail.item, ...snapshot.skill }, snapshot)} onClose={() => { if (!installing) setDetail(null) }} />{updateDialog}</>
  if (!available) return <SectionLayout><p role="status">{t('unavailable')}</p></SectionLayout>
  return <SectionLayout>
    {toastNode}
    {loading && <div className="tp-store-loading" role="status"><ToolboxIcon name="spinner" size={20} />{t('storeLoading')}</div>}
    {failure && <><p role="alert">{t(failure)}</p><Button onClick={refresh}>{t('refresh')}</Button></>}
    {operation.feedback}
    {!loading && !failed && account?.configured && !rows.length && <p className="tp-toolbox-empty">{t(query.trim() ? 'noMatches' : 'storeEmpty')}</p>}
    <div ref={anchorRef} className="tp-store-list" aria-busy={loading}>{rows.map((item, index) => {
      const installed = isInstalled(item), busy = acting === item.id
      return <article className="tp-store-card" key={item.id} data-skill-store-card>
        <button id={`${listId}-${index}`} type="button" className="tp-store-open" aria-label={`${t('detail')}: /${item.name}`} disabled={installing || operation.busy} onClick={event => setDetail({ item, focusId: event.currentTarget.id, scrollTop: event.currentTarget.closest('.tp-toolbox')?.scrollTop ?? 0 })}>
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
    {cursor && <div className="tp-store-more"><Button disabled={loading || installing || operation.busy} onClick={() => { void operation.run(async signal => {
      const expected = generation.current
      const page = await actions.hubList({ query, cursor }, signal)
      if (generation.current !== expected) return
      setRows(previous => [...previous, ...page.items.filter(item => !previous.some(row => row.id === item.id))]); setCursor(page.cursor)
    }, null) }}>{t('more')}</Button></div>}
    {updateDialog}
  </SectionLayout>
}
function HubDetail({ item, installed, actions, t, onClose, onDownload, canInstall, busy, anchorRef, returnFocusId, returnScrollTop }: {
  item: TpcoworkHubSkill; installed: boolean; actions: SectionProps['actions']; t: SectionProps['t']; onClose(): void; onDownload(snapshot: Snapshot): void; canInstall: boolean; busy: boolean; anchorRef: React.RefObject<HTMLDivElement>; returnFocusId: string; returnScrollTop: number
}) {
  const [detail, setDetail] = React.useState<Snapshot | null>(null)
  const [failed, setFailed] = React.useState<UiKey | null>(null)
  const [retry, setRetry] = React.useState(0)
  React.useEffect(() => { let active = true; const controller = new AbortController(); setFailed(null); setDetail(null); void actions.hubDetail({ id: item.id, preview: true }, controller.signal).then(value => { if (active) setDetail(value) }, error => { if (active) setFailed(failureKey(error)) }); return () => { active = false; controller.abort() } }, [item.id, actions.hubDetail, retry])
  const current = { ...item, ...detail?.skill }
  const failure = visibleFailure(failed)
  return <ToolboxDetail title={`/${current.name}`} subtitle={current.description || t('storeNoDescription')} section="tpcoworkhub" t={t} pending={busy} onClose={onClose} returnFocusId={returnFocusId} returnScrollTop={returnScrollTop} className="tp-store-detail"
    actions={downloadable(current) && <Button className="tp-toolbox-primary" disabled={!detail?.skill.versionId || !canInstall} onClick={() => { if (detail) onDownload(detail) }}><ToolboxIcon name={busy ? 'spinner' : installed ? 'refresh' : 'download'} />{t(installed ? 'update' : 'storeDownload')}</Button>}>
    <div ref={anchorRef} className="tp-store-detail-meta"><Badges item={current} installed={installed} t={t} />{current.version && <span>{t('version')} {current.version}</span>}</div>
    {!!current.tags?.length && <div className="tp-store-detail-tags">{current.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
    {failure ? <div><p role="alert">{t(failure)}</p><Button onClick={() => setRetry(value => value + 1)}>{t('refresh')}</Button></div> : !detail && !failed ? <div className="tp-store-loading" role="status"><ToolboxIcon name="spinner" size={20} />{t('loading')}</div> : detail && <>
      <section className="tp-toolbox-detail-section"><h2>{t('skillContent')}</h2><pre className="tp-toolbox-content">{detail.content || t('storeNoContent')}</pre></section>
      <section className="tp-toolbox-detail-section"><h2>{t('resources')} · {detail.files.length}</h2><ul className="tp-toolbox-detail-list">{detail.files.map(file => <li key={file.path}>{file.path} ({file.size})</li>)}</ul></section>
    </>}
  </ToolboxDetail>
}
