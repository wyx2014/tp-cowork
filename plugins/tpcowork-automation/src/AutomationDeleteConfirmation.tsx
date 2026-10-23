/** Shared confirmation for deleting a task or one run. */
import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { uiFailureKey, type UiKey, type UiText } from './ui-locales.ts'

/** Confirmation stays open on failure, traps focus, and restores focus on close. */
export function DeleteConfirmation({ pending, failure, t, cancel, confirm, title = 'deleteRun', hint = 'deleteRunHint' }: { pending: boolean; failure?: string | undefined; t: UiText; title?: UiKey; hint?: UiKey; cancel(): void; confirm(): void }) {
  return <Modal open className="tp-confirm-dialog" title={t(title)} description={t(hint)} closeLabel={t('cancel')} showCloseButton={false} onClose={() => { if (!pending) cancel() }}
    footer={<><Button variant="outline" data-modal-autofocus disabled={pending} onClick={cancel}>{t('cancel')}</Button>
      <Button variant="primary" className="tp-dialog-danger" disabled={pending} onClick={confirm}>{t(title)}</Button></>}>
    {failure ? <p role="alert">{t(uiFailureKey(failure) === 'error' ? title === 'delete' ? 'error' : 'runFailure' : uiFailureKey(failure))}</p> : undefined}
  </Modal>
}
