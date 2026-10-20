import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Readiness } from '../contracts/index.ts'
import type { Load } from '../client/model.ts'
import type { T, UiActions } from './types.ts'
import type { UiKey } from './locales.ts'

/** Local operation lifecycle; abortable probes stop on cancel or unmount. */
export function useOperation(t: T) {
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<UiKey | null>(null)
  const [failed, setFailed] = React.useState(false)
  const controller = React.useRef<AbortController | null>(null)
  React.useEffect(() => () => { controller.current?.abort() }, [])
  const run = async (operation: (signal: AbortSignal) => Promise<void>, success: UiKey | null = 'saved') => {
    if (controller.current) return
    const current = new AbortController(); controller.current = current
    setBusy(true); setNotice(null); setFailed(false)
    try { await operation(current.signal); if (!current.signal.aborted) setNotice(success) }
    catch (error) { if (!current.signal.aborted) { setFailed(true); setNotice(operationFailure(error)) } }
    finally { if (controller.current === current) { controller.current = null; if (!current.signal.aborted) setBusy(false) } }
  }
  return { busy, run, feedback: notice ? <p role={failed ? 'alert' : 'status'}>{t(notice)}</p> : null,
    cancel: () => { controller.current?.abort(); controller.current = null; setBusy(false); setFailed(false); setNotice('cancelled') } }
}
export function ReadinessBadge({ value, t }: { value: Readiness; t: T }) {
  return <span className="tp-toolbox-badge" data-state={value.state}>{t(value.state)}</span>
}
export function Reasons({ value }: { value: Readiness }) { return value.reasons.length ? <ul className="tp-toolbox-reasons">{value.reasons.map((reason, i) => <li key={i}>{reason.message}</li>)}</ul> : null }
export function LoadNotice<TValue extends { complete: boolean }>({ load, available, empty, t }: { load: Load<TValue>; available: boolean; empty: boolean; t: T }) {
  return <>{load.loading && <p role="status">{t('loading')}</p>}{load.failed && <p role="alert">{t('failed')}</p>}
    {!available && <p role="status">{t('unavailable')}</p>}{available && load.value?.complete && !load.loading && !load.failed && empty && <p className="tp-toolbox-empty">{t('empty')}</p>}</>
}
export function ConfirmRemove({ name, onClose, onConfirm, busy, disabled, feedback, t }: { name: string; onClose(): void; onConfirm(): void; busy: boolean; disabled?: boolean; feedback?: React.ReactNode; t: T }) {
  return <Modal open className="tp-toolbox-dialog" contentClassName="tp-toolbox-dialog-content" title={t('confirmRemove', { name })} closeLabel={t('close')} onClose={() => { if (!busy) onClose() }}>
    <p>{t('removeHint')}</p>{feedback}<div className="tp-toolbox-actions"><Button disabled={busy || disabled} onClick={onConfirm}>{t('remove')}</Button><Button disabled={busy} onClick={onClose}>{t('cancel')}</Button></div>
  </Modal>
}
export type SectionProps = { t: T; query: string; actions: UiActions }

export function operationFailure(error: unknown): UiKey {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === 'toolbox/stale-selection') return 'stale'
  if (code === 'skills/user-modified') return 'skillModified'
  if (code === 'skills/not-owned') return 'skillUnmanaged'
  if (code === 'skills/name-conflict') return 'skillConflict'
  if (code === 'skills/invalid-frontmatter') return 'skillInvalidFrontmatter'
  if (code === 'skills/invalid-archive' || code === 'skills/unsupported-package') return 'skillInvalidPackage'
  if (code === 'skills/resource-size' || code === 'skills/resource-count') return 'skillTooLarge'
  if (code === 'skills/missing-resource' || code === 'skills/missing-entry') return 'skillMissingResources'
  if (code === 'skills/import-expired') return 'skillImportExpired'
  if (code === 'skills/update-name-mismatch') return 'skillUpdateMismatch'
  return 'failed'
}
