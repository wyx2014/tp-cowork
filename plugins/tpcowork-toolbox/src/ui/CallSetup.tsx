import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CallSetup as Setup } from '../contracts/call.ts'
import { ToolboxEditor, EditorField } from './Editor.tsx'
import type { SectionProps } from './shared.tsx'

export function CallSetup({ actions, t, onClose, returnFocusId, returnScrollTop }: Pick<SectionProps, 'actions' | 't'> & {
  onClose(): void; returnFocusId: string; returnScrollTop: number
}) {
  const [setup, setSetup] = React.useState<Setup | null>(null)
  const [busy, setBusy] = React.useState(true)
  const [failed, setFailed] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const generation = React.useRef(0)
  React.useEffect(() => {
    const id = ++generation.current
    void actions.callSetup({}).then(value => { if (generation.current === id) setSetup(value) }, () => {
      if (generation.current === id) setFailed(true)
    }).finally(() => { if (generation.current === id) setBusy(false) })
    return () => { generation.current++ }
  }, [actions.callSetup])
  const patch = (value: Partial<Setup>) => { setSetup(previous => previous && { ...previous, ...value, confirmed: false, issues: [] }); setSaved(false) }
  const match = async (importing = false) => {
    if (!setup) return
    const id = ++generation.current
    setBusy(true); setFailed(false); setSaved(false)
    try {
      const value = await actions.callSetup({ ...(!importing ? { caller: setup.caller } : {}), sourceDirectory: setup.sourceDirectory })
      if (generation.current === id) setSetup(value)
    } catch { if (generation.current === id) setFailed(true) }
    finally { if (generation.current === id) setBusy(false) }
  }
  const save = async () => {
    if (!setup) return
    const id = ++generation.current
    setBusy(true); setFailed(false); setSaved(false)
    try {
      const value = await actions.saveCallSetup({ caller: setup.caller, sourceDirectory: setup.sourceDirectory, phoneUrl: setup.phoneUrl,
        pbx: setup.pbx, outgoingPrefix: setup.outgoingPrefix, ...(username ? { username } : {}), ...(password ? { password } : {}) })
      if (generation.current !== id) return
      setSetup(value)
      if (value.confirmed) {
        setUsername(''); setPassword(''); setSaved(true)
        await actions.refreshSkills()
      }
    } catch { if (generation.current === id) setFailed(true) }
    finally { if (generation.current === id) setBusy(false) }
  }
  return <ToolboxEditor title={t('callSetup')} subtitle={t('callSetupHint')} section="skills" t={t}
    pending={busy} disabled={!setup || !/^\d{4}$/.test(setup.caller)} onClose={onClose} onSubmit={() => { void save() }}
    submitLabel={t('callConfirm')} returnFocusId={returnFocusId} returnScrollTop={returnScrollTop}
    feedback={<>{failed && <p role="alert">{t('callFailure')}</p>}{saved && <p role="status">{t('callConfigured')}</p>}
      {!!setup?.issues.length && <ul role="status">{setup.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}</>}>
    {!setup ? <p role="status">{t(busy ? 'loading' : 'callFailure')}</p> : <>
      <EditorField label={t('callCaller')} hint={t('callCallerHint')}><input data-testid="call-caller" inputMode="numeric" autoComplete="off" required pattern="[0-9]{4}" maxLength={4} value={setup.caller}
        onChange={event => patch({ caller: event.target.value, phoneUrl: '' })} /></EditorField>
      <div className="tp-toolbox-actions"><Button type="button" disabled={busy || !/^\d{4}$/.test(setup.caller)} onClick={() => { void match() }}>{t('callMatch')}</Button>
        {setup.phoneUrl && <span data-testid="call-matched-phone">{setup.caller} → {setup.phoneUrl}</span>}</div>
      {(!setup.usernameConfigured || !setup.passwordConfigured) && <p className="tp-toolbox-meta">{t('callCredentialHint')}</p>}
      <EditorField label={t('callUsername')}><input autoComplete="off" maxLength={255} value={username} placeholder={setup.usernameConfigured ? t('callCredentialSaved') : ''} onChange={event => { setUsername(event.target.value); setSaved(false) }} /></EditorField>
      <EditorField label={t('callPassword')}><input type="password" autoComplete="new-password" maxLength={1024} value={password} placeholder={setup.passwordConfigured ? t('callCredentialSaved') : ''} onChange={event => { setPassword(event.target.value); setSaved(false) }} /></EditorField>
      <details><summary>{t('callAdvanced')}</summary>
        <EditorField label={t('callPhone')} hint={t('callPhoneHint')}><input type="url" value={setup.phoneUrl} placeholder="https://192.168.1.100" onChange={event => patch({ phoneUrl: event.target.value })} /></EditorField>
        <EditorField label={t('callPbx')}><input value={setup.pbx} onChange={event => patch({ pbx: event.target.value })} /></EditorField>
        <EditorField label={t('callPrefix')}><input inputMode="numeric" pattern="[0-9]*" value={setup.outgoingPrefix} onChange={event => patch({ outgoingPrefix: event.target.value })} /></EditorField>
        <EditorField label={t('callSource')} hint={t('callSourceHint')}><input value={setup.sourceDirectory} onChange={event => patch({ sourceDirectory: event.target.value })} /></EditorField>
        <Button type="button" disabled={busy} onClick={() => { void match(true) }}>{t('callImport')}</Button>
      </details>
      <p className="tp-toolbox-meta">{t('callReadyHint')}</p>
    </>}
  </ToolboxEditor>
}
