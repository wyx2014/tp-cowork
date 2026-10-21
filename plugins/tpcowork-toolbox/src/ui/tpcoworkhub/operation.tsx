import * as React from 'react'
import type { UiKey } from '../locales.ts'
import type { T } from '../types.ts'

export function failureKey(error: unknown): UiKey {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (/session-expired|login-required/.test(code)) return 'hubExpired'
  if (/not-configured/.test(code)) return 'hubUnconfigured'
  if (/name-conflict|not-owned|user-modified/.test(code)) return 'hubConflict'
  if (/package|resource|source-changed/.test(code)) return 'hubPackage'
  if (/unsafe-upload/.test(code)) return 'hubUnsafe'
  if (/publish-uncertain/.test(code)) return 'hubUncertain'
  if (/cancelled/.test(code)) return 'cancelled'
  return 'failed'
}
export function visibleFailure(key: UiKey | null): UiKey | null {
  return key === 'hubExpired' || key === 'hubUnconfigured' ? null : key
}
/** Cancel remains busy until Host cleanup settles. Never show late success after cancellation. */
export function useHubOperation(t: T, cancelled: UiKey = 'cancelled') {
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<UiKey | null>(null)
  const controller = React.useRef<AbortController | null>(null)
  const mounted = React.useRef(true)
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  const run = async (work: (signal: AbortSignal) => Promise<void>, success: UiKey | null = 'saved') => {
    if (controller.current) return
    const current = new AbortController(); controller.current = current
    setBusy(true); setNotice(null)
    try { await work(current.signal); if (mounted.current) setNotice(current.signal.aborted ? cancelled : success) }
    catch (error) { if (mounted.current) setNotice(current.signal.aborted && failureKey(error) !== 'hubUncertain' ? cancelled : failureKey(error)) }
    finally { if (controller.current === current) { controller.current = null; if (mounted.current) setBusy(false) } }
  }
  return { busy, run, cancel: () => controller.current?.abort(), feedback: visibleFailure(notice) ? <p role={['saved', 'imported', 'published', 'cancelled', 'storeDownloaded'].includes(notice!) ? 'status' : 'alert'}>{t(notice!)}</p> : null }
}
