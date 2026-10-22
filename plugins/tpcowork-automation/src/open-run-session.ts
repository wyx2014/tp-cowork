/** Load an existing Session through DSH; hand its live reference to navigation before release. */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { automationResult: unknown }
}
/** Failed history reads never navigate or create an empty Session. */
export async function openRunSession(sessions: ISessions, navigate: (id: SessionId) => void, id: SessionId, title: string, signal: AbortSignal,
  reportTitleFailure: (error: unknown) => void = error => console.warn('Automation result title update failed', error),
): Promise<void> {
  signal.throwIfAborted()
  // New automation runs can be bound before the Client Session catalog receives its next update.
  if (!sessions.list.getSnapshot().byId[id]) await sessions.refresh()
  signal.throwIfAborted()
  if (!sessions.list.getSnapshot().byId[id]) {
    throw new Error('Run conversation is not in the Session catalog')
  }
  await sessions.using(id, { source: 'automationResult', signal }, async reference => {
    signal.throwIfAborted()
    const session = reference.binding.session
    const snapshot = session.getSnapshot()
    // A released Host Agent also sets removed; successful history remains readable.
    if (snapshot.openState !== 'open') throw snapshot.openError ?? new Error('Run conversation is unavailable')
    signal.throwIfAborted()
    navigate(id)
    // Renaming can require a Host Agent resume; that must not prevent reading persisted history.
    if (sessions.list.getSnapshot().byId[id]?.title !== title) {
      void session.rename(title).then(result => {
        if (!result.ok) reportTitleFailure(result.error)
      }, reportTitleFailure)
    }
  })
}

/** Only an explicit missing-session response warrants claiming the result is missing. */
export function runSessionFailureKey(error: unknown): 'missingResult' | 'openFailed' {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'session/not-found'
    ? 'missingResult' : 'openFailed'
}
