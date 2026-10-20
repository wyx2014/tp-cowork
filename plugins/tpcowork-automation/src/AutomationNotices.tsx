/** App-wide result toasts stay mounted through main-panel navigation. */
import * as React from 'react'
import type { AutomationRunMonitor } from './run-monitor.ts'
import type { UiText } from './ui-locales.ts'

export function AutomationNotices({ monitor, t }: { monitor: AutomationRunMonitor; t: UiText }) {
  const notices = React.useSyncExternalStore(monitor.subscribe, monitor.getSnapshot)
  return <div className="tp-auto-toasts">{notices.map(notice => <div role="status" className="tp-auto-toast" key={notice.runId}>
    <button type="button" onClick={() => monitor.open(notice)}><strong>{t(notice.status === 'error' ? 'notificationError' : 'notificationCompleted')}</strong><span>{notice.taskName}</span></button>
    <button type="button" aria-label={t('close')} onClick={() => monitor.dismiss(notice.runId)}>×</button>
  </div>)}</div>
}
