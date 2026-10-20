/** Selection notices; selected capabilities are native inline editor references. */
import * as React from 'react'
import type { ChoiceDockProps } from './types.ts'
import { hasSelection, selectionIssues } from '../client/model.ts'

export function ChoiceDock(props: ChoiceDockProps) {
  const sessionId = props.useSession(snapshot => snapshot.sessionId)
  const choice = props.useToolbox(state => state.choices[sessionId])
  React.useEffect(() => { void props.loadChoice(sessionId) }, [sessionId, props.loadChoice])
  if (!choice) return null
  if (!hasSelection(choice.draft)) return null
  if (choice.phase === 'submitting') return <span className="tp-toolbox-selection-status" role="status">{props.t('submitting')}</span>
  if (!choice.catalog && !choice.unavailable) return <span className="tp-toolbox-selection-status" role="status">{props.t('loading')}</span>
  const issues = selectionIssues(choice)
  if (choice.phase === 'draft' && issues.length > 0) return <p className="tp-toolbox-selection-error" role="alert">{props.t(issues.length === 1 && issues[0] === 'stale' ? 'stale' : 'invalidSelection')}</p>
  return null
}
