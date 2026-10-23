import * as React from 'react'
import { Button, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { suggestionBatch, suggestionSkillLabel, type Suggestion } from './catalog.ts'
import type { SuggestionPreferences } from './preferences.ts'
import type { T } from '../types.ts'

export interface SuggestionsProps {
  sessionId: string | undefined; disabled: boolean; preferences: SuggestionPreferences; t: T
  prepare(sessionId: string, item: Suggestion, signal: AbortSignal): Promise<'ready' | 'unavailable' | 'cancelled'>
}
export function Suggestions({ sessionId, disabled, preferences, prepare, t }: SuggestionsProps) {
  const { enabled } = React.useSyncExternalStore(preferences.state.subscribe, preferences.state.getSnapshot)
  const [batch, setBatch] = React.useState(0)
  const [closing, setClosing] = React.useState(false)
  const [saveFailed, setSaveFailed] = React.useState(false)
  const [error, setError] = React.useState('')
  const [pending, setPending] = React.useState<string | null>(null)
  const operation = React.useRef<AbortController | null>(null)
  const cancel = () => { operation.current?.abort(); operation.current = null; setPending(null) }
  React.useEffect(() => () => { operation.current?.abort() }, [sessionId, enabled])
  if (!enabled) return null
  const choose = async (item: Suggestion) => {
    if (!sessionId || disabled) return
    cancel(); setError('')
    const current = new AbortController(); operation.current = current; setPending(item.id)
    try {
      const result = await prepare(sessionId, item, current.signal)
      if (!current.signal.aborted && result === 'unavailable') setError(t('suggestionsUnavailable', { name: suggestionSkillLabel(item.skill!, t) }))
    } catch { if (!current.signal.aborted) setError(t('suggestionsFailed')) }
    finally { if (operation.current === current) { operation.current = null; setPending(null) } }
  }
  return <section className="tp-task-suggestions" data-testid="task-suggestions" aria-label={t('suggestionsTitle')}>
    <header><span>{t('suggestionsTitle')}</span><div>
      <button type="button" data-testid="suggestions-refresh" onClick={() => { cancel(); setBatch(value => value + 1); setError('') }}>{t('suggestionsRefresh')}</button>
      <button type="button" className="tp-suggestions-close" aria-label={t('suggestionsClose')} onClick={() => { cancel(); setSaveFailed(false); setClosing(true) }}>
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
    </div></header>
    <ul>{suggestionBatch(batch).map(item => <li key={item.id}><button type="button" data-suggested-task={item.id} disabled={disabled || !sessionId} aria-busy={pending === item.id} onClick={() => { void choose(item) }}>
      <span className="tp-suggestion-icon"><img src={item.icon} alt="" width="24" height="24" draggable={false} /></span><span>{t(item.label)}</span>
    </button></li>)}</ul>
    {error && <p className="tp-suggestion-feedback" role="status">{error}</p>}
    <Modal open={closing} title={t('suggestionsClose')} closeLabel={t('close')} className="tp-toolbox-dialog" contentClassName="tp-toolbox-dialog-content" onClose={() => setClosing(false)}>
      <p>{t('suggestionsCloseHint')}</p>{saveFailed && <p role="alert">{t('suggestionsSaveFailed')}</p>}<div className="tp-toolbox-actions"><Button onClick={() => setClosing(false)}>{t('cancel')}</Button>
        <Button onClick={() => { try { preferences.setEnabled(false); setClosing(false); setError('') } catch { setSaveFailed(true) } }}>{t('suggestionsConfirm')}</Button></div>
    </Modal>
  </section>
}
export function SuggestionsSetting({ preferences, t }: { preferences: SuggestionPreferences; t: T }) {
  const { enabled } = React.useSyncExternalStore(preferences.state.subscribe, preferences.state.getSnapshot)
  const [failed, setFailed] = React.useState(false)
  return <div className="tp-suggestions-setting"><div><div>{t('suggestionsSetting')}</div><p>{t('suggestionsSettingHint')}</p>{failed && <p role="alert">{t('suggestionsSaveFailed')}</p>}</div>
    <Switch label={t('suggestionsSetting')} checked={enabled} onChange={value => { try { preferences.setEnabled(value); setFailed(false) } catch { setFailed(true) } }} />
  </div>
}
