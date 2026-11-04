/**
 * Client half: the Settings 电脑控制 section, after ZCode's Computer Use settings — the switch, this device's readiness
 * (an unsupported environment gets a notice instead of controls), and the applications the user chose to always allow.
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { computerUseStatus, statusRemote, type ComputerUseStatus } from './remote.ts'

const { useCallback, useEffect, useState, useSyncExternalStore } = React
const namespace = 'settings.computer-use'
const entry = 'tpcowork-computer-use'

export const zh = {
  nav: '电脑控制',
  switch: '电脑控制',
  description: '允许 TP Cowork 查看并操作你电脑上的桌面应用。每次控制一个新应用前都会先征求你的同意，开启后可能增加模型调用和 Token 成本。',
  failed: '设置未能保存，请重试。',
  status: '当前设备',
  refresh: '重新检查',
  checking: '正在检查…',
  ready: '可以使用',
  needsAttention: '需要处理',
  'platform.win32': 'Windows',
  'platform.darwin': 'macOS',
  'platform.linux': 'Linux',
  'reason.platform': '当前系统暂不支持电脑控制。',
  'reason.arch': '当前处理器架构暂不支持电脑控制。',
  'reason.macos-version': '电脑控制需要 macOS 13 或更高版本。',
  'reason.wayland': '当前是 Wayland 会话，无法控制其他应用的窗口。请在登录界面选择 X11（Xorg）会话后重试。',
  'reason.no-display': '没有检测到图形桌面（DISPLAY 未设置）。',
  'reason.driver-missing': '缺少电脑控制组件（@trycua/cua-driver），请重新安装 TP Cowork。',
  'reason.driver-failed': '电脑控制组件无法启动。',
  macPermissions: '请在“系统设置 › 隐私与安全性”中为 TP Cowork 打开“辅助功能”和“屏幕录制”，然后点“重新检查”。',
  'check.accessibility': '辅助功能',
  'check.screen_recording': '屏幕录制',
  'check.x11': 'X11 桌面',
  'check.atspi': '无障碍服务（AT-SPI）',
  'check.xsend_event': '输入注入',
  allowed: '始终允许的应用',
  allowedEmpty: '还没有始终允许的应用。Agent 首次控制某个应用时，你可以选择“始终允许”。',
  remove: '移除',
  on: '已开启',
  off: '未开启',
}
export const en: Record<keyof typeof zh, string> = {
  nav: 'Computer Use',
  switch: 'Computer Use',
  description: 'Let TP Cowork view and operate desktop apps on this computer. It asks for your consent before controlling each new app, and may increase model requests and token costs.',
  failed: 'The setting could not be saved. Try again.',
  status: 'This device',
  refresh: 'Check again',
  checking: 'Checking…',
  ready: 'Ready',
  needsAttention: 'Needs attention',
  'platform.win32': 'Windows',
  'platform.darwin': 'macOS',
  'platform.linux': 'Linux',
  'reason.platform': 'Computer Use is not supported on this system.',
  'reason.arch': 'Computer Use is not supported on this processor architecture.',
  'reason.macos-version': 'Computer Use needs macOS 13 or later.',
  'reason.wayland': 'This is a Wayland session, which does not allow controlling other apps\' windows. Sign in with an X11 (Xorg) session and try again.',
  'reason.no-display': 'No graphical desktop was found (DISPLAY is not set).',
  'reason.driver-missing': 'The Computer Use component (@trycua/cua-driver) is missing; reinstall TP Cowork.',
  'reason.driver-failed': 'The Computer Use component could not start.',
  macPermissions: 'In System Settings › Privacy & Security, turn on Accessibility and Screen Recording for TP Cowork, then choose Check again.',
  'check.accessibility': 'Accessibility',
  'check.screen_recording': 'Screen Recording',
  'check.x11': 'X11 desktop',
  'check.atspi': 'Accessibility service (AT-SPI)',
  'check.xsend_event': 'Input injection',
  allowed: 'Always-allowed apps',
  allowedEmpty: 'No apps are always allowed yet. When the agent first controls an app, you can choose "Always allow".',
  remove: 'Remove',
  on: 'On',
  off: 'Off',
}
export type ComputerUseKey = keyof typeof zh
type Translate = (key: ComputerUseKey) => string
interface Grant { id: string; name: string; executablePath: string }
interface Settings { enabled?: boolean; allowedApps?: Grant[] }

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'settings.computer-use': ComputerUseKey } }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertClientRemote { computerUseStatus: { get(): Promise<RemoteResult<unknown>> } }
}

export const name = 'tpcowork-computer-use-client'
export const inject = ['remote']

const css = `
.tcu-page { display: grid; gap: 24px; }
.tcu-card { overflow: hidden; border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.tcu-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 16px; padding: 12px 16px; }
.tcu-row + .tcu-row { border-top: 1px solid color-mix(in oklab, var(--dsw-alias-border-l3) 60%, transparent); }
.tcu-label { font-size: 14px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.tcu-description { margin-top: 4px; font-size: 14px; line-height: 24px; color: var(--tpcowork-settings-subtle, var(--dsw-alias-label-secondary)); overflow-wrap: anywhere; }
.tcu-alert { font-size: 14px; color: var(--dsw-alias-state-error-primary, #d93025); }
.tcu-badge { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 999px; font-size: 12px; font-weight: 500;
  background: color-mix(in oklab, var(--dsw-alias-label-primary) 6%, transparent); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.tcu-badge[data-tone="ok"] { background: color-mix(in oklab, #1e8a3e 14%, transparent); color: #1e8a3e; }
.tcu-badge[data-tone="warn"] { background: color-mix(in oklab, #e07b00 16%, transparent); color: #b86500; }
.tcu-button { height: 28px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; }
.tcu-button:hover:not(:disabled) { background: color-mix(in oklab, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-layer-1)); }
.tcu-button:disabled { cursor: default; opacity: .5; }
.tcu-detail { margin: 0; padding: 0 16px 12px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
`

/** The driver's readiness flags that have a label here; others stay in the detail text. */
function checks(status: ComputerUseStatus): { key: ComputerUseKey; ok: boolean }[] {
  return Object.entries(status.checks ?? {}).flatMap(([name, value]) => {
    const key = `check.${name}` as ComputerUseKey
    return key in zh && typeof value === 'boolean' ? [{ key, ok: value }] : []
  })
}

export interface ComputerUsePageProps { t: Translate; form: ConfigForm<Settings>; status: () => Promise<ComputerUseStatus> }

export function ComputerUsePage({ t, form, status }: ComputerUsePageProps) {
  const snapshot = useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot())
  const enabled = snapshot.value?.enabled === true
  const grants = snapshot.value?.allowedApps ?? []
  const writable = snapshot.status === 'ready' && snapshot.writable
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [state, setState] = useState<ComputerUseStatus | 'checking' | 'error'>('checking')
  const refresh = useCallback(() => {
    setState('checking')
    void status().then(setState, () => setState('error'))
  }, [status])
  useEffect(() => { refresh() }, [refresh])
  const save = (key: keyof Settings, value: unknown) => {
    setSaving(true)
    setFailed(false)
    void form.set(key, value as never).then(accepted => { if (!accepted) setFailed(true) }, () => setFailed(true)).finally(() => setSaving(false))
  }
  const supported = typeof state === 'object' && state.supported
  const rows = typeof state === 'object' ? checks(state) : []
  const attention = rows.some(row => !row.ok)
  return <div className="tcu-page" data-tpcowork-computer-use="">
    <div className="tcu-card">
      <div className="tcu-row">
        <div style={{ minWidth: 0 }}>
          <div className="tcu-label">{t('switch')}</div>
          <div className="tcu-description">{t('description')}</div>
        </div>
        <Switch checked={enabled} onChange={next => { save('enabled', next) }} label={t('switch')}
          disabled={saving || !writable || (!supported && !enabled)} />
      </div>
    </div>
    {failed ? <div role="alert" className="tcu-alert">{t('failed')}</div> : null}
    <div className="tcu-card">
      <div className="tcu-row">
        <div style={{ minWidth: 0 }}>
          <div className="tcu-label">{t('status')}{typeof state === 'object' && `platform.${state.platform}` in zh ? ` · ${t(`platform.${state.platform}` as ComputerUseKey)}` : ''}</div>
          <div className="tcu-description">
            {state === 'checking' ? t('checking') : state === 'error' ? t('reason.driver-failed')
              : !state.supported ? t(`reason.${state.reason ?? 'platform'}` as ComputerUseKey)
                : attention && state.platform === 'darwin' ? t('macPermissions') : attention ? t('needsAttention') : t('ready')}
          </div>
        </div>
        <button type="button" className="tcu-button" disabled={state === 'checking'} onClick={refresh}>{t('refresh')}</button>
      </div>
      {rows.map(row => <div key={row.key} className="tcu-row">
        <div className="tcu-label">{t(row.key)}</div>
        <span className="tcu-badge" data-tone={row.ok ? 'ok' : 'warn'}>{row.ok ? '✓' : '✕'}</span>
      </div>)}
      {typeof state === 'object' && state.detail && (!state.supported || attention) ? <pre className="tcu-detail">{state.detail}</pre> : null}
    </div>
    {supported || grants.length > 0 ? <div className="tcu-card">
      <div className="tcu-row"><div className="tcu-label">{t('allowed')}</div></div>
      {grants.length === 0 ? <div className="tcu-row"><div className="tcu-description" style={{ marginTop: 0 }}>{t('allowedEmpty')}</div></div>
        : grants.map(grant => <div key={grant.id} className="tcu-row">
          <div style={{ minWidth: 0 }}>
            <div className="tcu-label">{grant.name}</div>
            <div className="tcu-description" style={{ marginTop: 0 }}>{grant.executablePath}</div>
          </div>
          <button type="button" className="tcu-button" disabled={saving || !writable}
            onClick={() => { save('allowedApps', grants.filter(item => item.id !== grant.id)) }}>{t('remove')}</button>
        </div>)}
    </div> : null}
  </div>
}

/** Registrations are withdrawn with the Client plugin fiber. */
export async function apply(ctx: Context): Promise<void> {
  const dispose = await ctx.remote.$mount(statusRemote)
  ctx.effect(() => dispose)
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@tpcowork/dsh-computer-use'
    style.textContent = css
    document.head.appendChild(style)
    return () => style.remove()
  })
  ctx.inject(['configForms', 'slots', 'locale', 'remote.computerUseStatus'], uiCtx => {
    uiCtx.effect(() => uiCtx.locale.register(namespace, { en, zh }))
    const t = uiCtx.locale.bind(namespace) as Translate
    const form = uiCtx.configForms.get<Settings>(entry)
    const status = async () => {
      const result = await uiCtx.remote.computerUseStatus.get()
      if (!result.ok) throw result.error
      return computerUseStatus.parse(result.value)
    }
    uiCtx.slots.inject('settings.section', () => uiCtx.configForms.whileServed([entry], () => uiCtx.slots.register({
      name: 'settings.section', id: 'computer-use', order: 27, label: () => t('nav'), locale: namespace,
      inject: () => ({ form, status }),
    }, ComputerUsePage as (props: ComputerUsePageProps) => ReturnType<typeof ComputerUsePage>)))
  })
}
