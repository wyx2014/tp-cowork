import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolboxInitialization } from '../contracts/index.ts'
import type { T } from './types.ts'
import { operationFailure, useOperation } from './shared.tsx'

/** Report partial setup without replacing the available catalogs. */
export function InitializationNotice({ value, retry, t }: { value: ToolboxInitialization; retry(): Promise<void>; t: T }) {
  const operation = useOperation(t)
  if (value.state === 'ready') return null
  if (value.state === 'pending' || value.state === 'running') return <p role="status">{t('initializationRunning')}</p>
  return <div data-testid="toolbox-initialization-failed" role="alert">
    <p>{t('initializationFailed')}</p>
    <ul className="tp-toolbox-reasons">{value.issues.map((issue, i) => {
      const reason = issue.code.includes('EACCES') || issue.code.includes('EPERM') || issue.code.includes('EBUSY')
        ? 'initializationAccess' : issue.code === 'skills/incomplete-inventory' ? 'initializationInventory' : operationFailure(issue)
      return <li key={i}>{t(issue.kind === 'skill' ? 'initializationSkill' : issue.kind === 'mcp' ? 'mcp' : 'initializationResources')}: {issue.resourceId} — {t(reason)} <code>{issue.code}</code></li>
    })}</ul>
    <Button variant="outline" disabled={operation.busy} onClick={() => { void operation.run(retry, null) }}>{t('retryInitialization')}</Button>
    {operation.feedback}
  </div>
}
