/** Load an existing Session through DSH; hand its live reference to navigation before release. */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { automationResult: unknown }
}
/** Failed history reads never navigate or create an empty Session. */
export async function openRunSession(sessions: ISessions, navigate: (id: SessionId) => void, id: SessionId, title: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  // New automation runs can be bound before the Client Session catalog receives its next update.
  await sessions.refresh()
  signal.throwIfAborted()
  await sessions.using(id, { source: 'automationResult', signal }, async reference => {
    signal.throwIfAborted()
    const session = reference.binding.session
    const snapshot = session.getSnapshot()
    if (snapshot.openState !== 'open' || snapshot.removed) throw new Error('Run conversation is unavailable')
    // Pin the run title durably so a generated or blank Session title cannot replace it.
    if (sessions.list.getSnapshot().byId[id]?.title !== title) {
      const result = await session.rename(title)
      if (!result.ok) throw result.error
    }
    signal.throwIfAborted()
    navigate(id)
  })
}
