import * as React from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import type { InputZone } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Suggestions, SuggestionsSetting, type SuggestionsProps } from './Suggestions.tsx'
import { createSuggestionPreferences } from './preferences.ts'

/** The input dock supplies the owning session; place suggestions after its native editor. */
export function SuggestionsDock({ session, input, ...options }: InputZone & Omit<SuggestionsProps, 'sessionId' | 'disabled'>) {
  const anchor = React.useRef<HTMLSpanElement>(null)
  const [target, setTarget] = React.useState<Element | null>(null)
  React.useLayoutEffect(() => {
    const pane = anchor.current?.closest('[data-conversation-content]')
    const seat = anchor.current?.closest('[data-composer-seat]')
    if (!pane || !seat) return
    const update = () => {
      // Resolve only inside this seat, so split panes keep their own drafts and layout.
      let stack = seat.querySelector('[data-composer-dock]')?.parentElement
      // Slot renderers may add display:contents wrappers. Find the shared stack,
      // rather than depending on the number of wrappers around either entry.
      while (stack && stack !== seat && !stack.contains(anchor.current)) stack = stack.parentElement
      setTarget(pane.getAttribute('data-content-phase') === 'hero' && stack && stack !== seat ? stack : null)
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(pane, { attributes: true, attributeFilter: ['data-content-phase'] })
    observer.observe(seat, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [session.sessionId])
  const available = session.blank && session.openState === 'open' && !session.running
    && !session.awaitingFirstTurn && session.pendingSubmissions.length === 0
  return <>
    <span ref={anchor} hidden />
    {available && target && createPortal(<Suggestions key={session.sessionId} sessionId={session.sessionId}
      disabled={!['plain', 'claimed'].includes(input.phase)} {...options} />, target)}
  </>
}

export function registerSuggestions(ctx: Context, options: Pick<SuggestionsProps, 'prepare' | 't'>): void {
  const preferences = createSuggestionPreferences()
  ctx.effect(() => () => preferences.dispose())
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'toolbox.task-suggestions', order: 13, locale: 'tpcowork.toolbox',
  }, ({ t }) => <SuggestionsSetting preferences={preferences} t={t} />))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'toolbox.task-suggestions', order: 20,
  }, ({ session, input }) => <SuggestionsDock session={session} input={input} preferences={preferences} {...options} />))
}
