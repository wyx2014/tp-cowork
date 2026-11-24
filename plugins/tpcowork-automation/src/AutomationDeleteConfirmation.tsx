/** Shared confirmation for deleting a task or one run. */
import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { uiFailureKey, type UiKey, type UiText } from './ui-locales.ts'

/** Confirmation stays open on failure, traps focus, and restores focus on close. */
export function DeleteConfirmation({ pending, failure, t, cancel, confirm, title = 'deleteRun', hint = 'deleteRunHint', allowSessionCleanup = false }: { pending: boolean; failure?: string | undefined; t: UiText; title?: UiKey; hint?: UiKey; allowSessionCleanup?: boolean; cancel(): void; confirm(cleanupSessions: boolean): void }) {
  const [cleanupSessions, setCleanupSessions] = React.useState(false)
  return <Modal open className="tp-confirm-dialog" title={t(title)} description={t(hint)} closeLabel={t('cancel')} showCloseButton={false} onClose={() => { if (!pending) cancel() }}
    footer={<><Button variant="outline" data-modal-autofocus disabled={pending} onClick={cancel}>{t('cancel')}</Button>
      <Button variant="primary" className="tp-dialog-danger" disabled={pending} onClick={() => confirm(allowSessionCleanup && cleanupSessions)}>{t(title)}</Button></>}>
    {allowSessionCleanup && <label><input type="checkbox" checked={cleanupSessions} disabled={pending}
      onChange={event => setCleanupSessions(event.target.checked)} /> {t('deleteOwnedSessions')}</label>}
    {failure ? <p role="alert">{t(uiFailureKey(failure) === 'error' ? title === 'delete' ? 'error' : 'runFailure' : uiFailureKey(failure))}</p> : undefined}
  </Modal>
}
