import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { TpcoworkHubAccountState, DesktopTpcoworkHubApi } from '../../../../deepseek-harness/apps/desktop/src/tpcoworkhub-protocol.ts'
import * as primitives from '../../../../deepseek-harness/packages/client/ui-primitives/src/index.ts'
import { createSettingsLauncher } from '../src/settings-launcher.js'
import { createTpcoworkHubAccount } from '../src/tpcoworkhub-account.js'

const SettingsLauncher = createSettingsLauncher(React, primitives)
const labels = JSON.parse(readFileSync(resolve(import.meta.dirname, '../locale/zh.json'), 'utf8')).ui
const t = (key: string, params: Record<string, string> = {}) => labels[key]?.replace(/\{(\w+)\}/g, (_: string, name: string) => params[name] ?? '')
const signedOut: TpcoworkHubAccountState = { status: 'signed_out', phase: 'idle' }
const signedIn: TpcoworkHubAccountState = { status: 'signed_in', phase: 'idle', user: { id: 'user-1', username: 'fixture-user', name: '测试账号' } }
const disposers: (() => Promise<void>)[] = []
afterEach(async () => { cleanup(); for (const dispose of disposers.splice(0)) await dispose(); vi.restoreAllMocks() })

function fixture(wide = true, initial: TpcoworkHubAccountState = signedOut) {
  let notify: (state: TpcoworkHubAccountState) => void = () => {}
  let state = initial
  const bridge: DesktopTpcoworkHubApi = {
    state: vi.fn(async () => state), start: vi.fn(async () => { state = signedIn; return state }),
    cancel: vi.fn(async () => { state = signedOut; return state }), signOut: vi.fn(async () => { state = signedOut; return state }),
    subscribe: listener => { notify = listener; return () => { notify = () => {} } },
  }
  const account = createTpcoworkHubAccount(bridge)
  disposers.push(() => account.dispose())
  const openSettings = vi.fn()
  let preferences = { locales: [{ id: 'zh', label: '简体中文' }, { id: 'en', label: 'English' }], localePreference: 'system', themePreference: 'system' }
  const preferenceListeners = new Set<() => void>()
  const preferenceSource = { getSnapshot: () => preferences, subscribe: (fn: () => void) => { preferenceListeners.add(fn); return () => preferenceListeners.delete(fn) } }
  const setInterfacePreference = vi.fn(async (id: string) => {
    const [kind, value] = id.split(':')
    preferences = { ...preferences, ...(kind === 'locale' ? { localePreference: value } : { themePreference: value }) }
    for (const listener of preferenceListeners) listener()
  })
  const useInterfacePreferences = (selector: (state: typeof preferences) => typeof preferences) => selector(React.useSyncExternalStore(preferenceSource.subscribe, preferenceSource.getSnapshot))
  const useTpcoworkHub = (selector: (state: TpcoworkHubAccountState) => TpcoworkHubAccountState) => selector(React.useSyncExternalStore(account.source.subscribe, account.source.getSnapshot))
  render(React.createElement(SettingsLauncher, {
    wide, openSettings, useInterfacePreferences, setInterfacePreference, refreshPreferences: vi.fn(), settingsShortcut: { keys: ['Meta', ','], aria: 'Meta+,' }, useTpcoworkHub,
    startSignIn: account.startSignIn, cancelSignIn: account.cancelSignIn, signOut: account.signOut, refreshAccount: account.refreshAccount, t,
  }))
  return { bridge, account, openSettings, setInterfacePreference, publish: (value: TpcoworkHubAccountState) => act(() => { state = value; notify(value) }) }
}

it.each([true, false])('uses website authentication and shows the synchronized desktop account (wide: %s)', async wide => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const { bridge } = fixture(wide)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: /账号菜单/ }))
  expect((await screen.findAllByRole('menuitem')).map(item => item.textContent)).toEqual(['界面语言', '界面主题', '连接使用'])
  expect(screen.queryByRole('menuitem', { name: '意见反馈' })).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '连接使用' })) })
  expect(bridge.start).toHaveBeenCalledOnce()
  expect(open).not.toHaveBeenCalled()
  if (wide) expect(screen.getByText('测试账号')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /账号菜单/ }))
  expect(await screen.findByRole('menuitem', { name: '退出登录' })).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' })) })
  expect(bridge.signOut).toHaveBeenCalledOnce()
  if (wide) expect(screen.getByText('连接使用')).toBeTruthy()
})

it('keeps settings as an independent button with its shortcut', async () => {
  const { openSettings } = fixture()
  await act(async () => {})
  const settings = screen.getByRole('button', { name: '设置' })
  expect(settings.getAttribute('aria-keyshortcuts')).toBe('Meta+,')
  settings.focus()
  fireEvent.click(settings)
  expect(openSettings).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(settings)
  expect(screen.queryByRole('menu')).toBeNull()
})

it('selects language and theme, reflects checks and restores menu focus', async () => {
  const { setInterfacePreference } = fixture()
  await act(async () => {})
  const trigger = screen.getByRole('button', { name: /账号菜单/ })
  const choose = async (parent: string, label: string) => {
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: parent }))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: label })) })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  }
  await choose('界面语言', 'English')
  expect(setInterfacePreference).toHaveBeenLastCalledWith('locale:en')
  await choose('界面主题', '深色')
  expect(setInterfacePreference).toHaveBeenLastCalledWith('theme:dark')
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('menuitem', { name: '界面语言' }))
  expect(screen.getByRole('menuitem', { name: 'English' }).querySelector('[data-selected=true]')).toBeTruthy()
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
})

it('shows account details without login, usage or plan placeholders', async () => {
  fixture(true, signedIn)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: /账号菜单/ }))
  expect(screen.getByText('账号 ID：user-1')).toBeTruthy()
  expect(screen.getAllByText('测试账号')).toHaveLength(2)
  expect(screen.queryByRole('menuitem', { name: '界面缩放' })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: '连接使用' })).toBeNull()
})

it('reports preference failures and allows a retry', async () => {
  const { setInterfacePreference } = fixture()
  setInterfacePreference.mockRejectedValueOnce(new Error('refused'))
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: /账号菜单/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: '界面主题' }))
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '深色' })) })
  expect(screen.getByRole('status').textContent).toBe(labels.preferenceFailed)
  expect(screen.getByRole('menuitem', { name: '界面主题' }).hasAttribute('disabled')).toBe(false)
})

it('allows cancellation without a waiting notice and shows retryable failures from the native account', async () => {
  const { bridge, publish } = fixture()
  await act(async () => {})
  publish({ status: 'signed_out', phase: 'waiting' })
  fireEvent.click(screen.getByRole('button', { name: /账号菜单/ }))
  expect(await screen.findByRole('menuitem', { name: '取消登录' })).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '取消登录' })) })
  expect(bridge.cancel).toHaveBeenCalledOnce()
  publish({ status: 'expired', phase: 'idle', error: 'timeout' })
  fireEvent.click(screen.getByRole('button', { name: /账号菜单/ }))
  expect(await screen.findByText(labels.authTimeout)).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '连接使用' })).toBeTruthy()
})

it('unsubscribes and cancels an owned website login when the appearance unloads', async () => {
  let finish: (state: TpcoworkHubAccountState) => void = () => {}
  const pending = new Promise<TpcoworkHubAccountState>(resolve => { finish = resolve })
  const unsubscribe = vi.fn()
  const bridge = { state: async () => signedOut, subscribe: () => unsubscribe, start: () => pending,
    cancel: vi.fn(async () => { finish(signedOut); return signedOut }) }
  const account = createTpcoworkHubAccount(bridge)
  const signingIn = account.startSignIn()
  await account.dispose()
  await signingIn
  expect(bridge.cancel).toHaveBeenCalledOnce()
  expect(unsubscribe).toHaveBeenCalledOnce()
})
