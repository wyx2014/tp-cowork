/** Shared confirmation for deleting a task or one run. */
import * as React from 'react'
import { uiFailureKey, type UiKey, type UiText } from './ui-locales.ts'

/** Confirmation stays open on failure, traps focus, and restores focus on close. */
export function DeleteConfirmation({ pending, failure, t, cancel, confirm, title = 'deleteRun', hint = 'deleteRunHint' }: { pending: boolean; failure?: string | undefined; t: UiText; title?: UiKey; hint?: UiKey; cancel(): void; confirm(): void }) {
  const dialog = React.useRef<HTMLDivElement>(null)
  const pendingRef = React.useRef(pending); pendingRef.current = pending
  React.useEffect(() => {
    const previous = document.activeElement
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <div ref={dialog} role="dialog" aria-modal="true" aria-label={t(title)} className="tp-auto-dialog" onKeyDown={event => {
    if (event.key === 'Escape' && !pendingRef.current) { event.stopPropagation(); cancel() }
    if (event.key === 'Tab') {
      const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      const first = buttons[0], last = buttons.at(-1)
      if (!first) event.preventDefault()
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
  }}><div><h2>{t(title)}</h2><p>{t(hint)}</p>{failure && <p role="alert">{t(uiFailureKey(failure) === 'error' ? title === 'delete' ? 'error' : 'runFailure' : uiFailureKey(failure))}</p>}<div className="tp-auto-actions">
    <button type="button" disabled={pending} onClick={cancel}>{t('cancel')}</button>
    <button type="button" disabled={pending} onClick={confirm}>{t(title)}</button>
  </div></div></div>
}
