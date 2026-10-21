import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PromptHubAccountState, DesktopPromptHubApi } from '../../../../deepseek-harness/apps/desktop/src/prompt-hub-protocol.ts'
import * as primitives from '../../../../deepseek-harness/packages/client/ui-primitives/src/index.ts'
import { createSettingsLauncher } from '../src/settings-launcher.js'
import { createPromptHubAccount } from '../src/prompt-hub-account.js'

const SettingsLauncher = createSettingsLauncher(React, primitives)
const labels = JSON.parse(readFileSync(resolve(import.meta.dirname, '../locale/zh.json'), 'utf8')).ui
const t = (key: string) => labels[key]
const signedOut: PromptHubAccountState = { status: 'signed_out', phase: 'idle' }
const signedIn: PromptHubAccountState = { status: 'signed_in', phase: 'idle', user: { id: 'user-1', username: 'fixture-user', name: '测试账号' } }
const disposers: (() => Promise<void>)[] = []
afterEach(async () => { cleanup(); for (const dispose of disposers.splice(0)) await dispose(); vi.restoreAllMocks() })

function fixture(wide = true, initial: PromptHubAccountState = signedOut) {
  let notify: (state: PromptHubAccountState) => void = () => {}
  let state = initial
  const bridge: DesktopPromptHubApi = {
    state: vi.fn(async () => state), start: vi.fn(async () => { state = signedIn; return state }),
    cancel: vi.fn(async () => { state = signedOut; return state }), signOut: vi.fn(async () => { state = signedOut; return state }),
    subscribe: listener => { notify = listener; return () => { notify = () => {} } },
  }
  const account = createPromptHubAccount(bridge)
  disposers.push(() => account.dispose())
  const openSettings = vi.fn()
  const usePromptHub = (selector: (state: PromptHubAccountState) => PromptHubAccountState) => selector(React.useSyncExternalStore(account.source.subscribe, account.source.getSnapshot))
  render(React.createElement(SettingsLauncher, {
    wide, openSettings, settingsShortcut: { keys: ['Meta', ','], aria: 'Meta+,' }, usePromptHub,
    startSignIn: account.startSignIn, cancelSignIn: account.cancelSignIn, signOut: account.signOut, refreshAccount: account.refreshAccount, t,
  }))
  return { bridge, account, openSettings, publish: (value: PromptHubAccountState) => act(() => { state = value; notify(value) }) }
}

it.each([true, false])('uses website authentication and shows the synchronized desktop account (wide: %s)', async wide => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const { bridge } = fixture(wide)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
  expect((await screen.findAllByRole('menuitem')).map(item => item.textContent)).toMatchInlineSnapshot(`
    [
      "设置Meta,",
      "登录",
    ]
  `)
  expect(screen.getByRole('menuitem', { name: '设置' })).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: '意见反馈' })).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '登录' })) })
  expect(bridge.start).toHaveBeenCalledOnce()
  expect(open).not.toHaveBeenCalled()
  if (wide) expect(screen.getByText('测试账号')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
  expect(await screen.findByRole('menuitem', { name: '退出登录' })).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' })) })
  expect(bridge.signOut).toHaveBeenCalledOnce()
  if (wide) expect(screen.getByText('更多')).toBeTruthy()
})

it('keeps settings navigation, its shortcut and focus return', async () => {
  const { openSettings } = fixture()
  await act(async () => {})
  const trigger = screen.getByRole('button', { name: '账号菜单' })
  fireEvent.click(trigger)
  const settings = await screen.findByRole('menuitem', { name: /设置/ })
  expect(settings.getAttribute('aria-keyshortcuts')).toBe('Meta+,')
  fireEvent.click(settings)
  expect(openSettings).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(trigger)
})

it('allows cancellation without a waiting notice and shows retryable failures from the native account', async () => {
  const { bridge, publish } = fixture()
  await act(async () => {})
  publish({ status: 'signed_out', phase: 'waiting' })
  fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
  expect((await screen.findByRole('menu')).textContent).toMatchInlineSnapshot('"设置Meta,取消登录"')
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '取消登录' })) })
  expect(bridge.cancel).toHaveBeenCalledOnce()
  publish({ status: 'expired', phase: 'idle', error: 'timeout' })
  fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
  expect(await screen.findByText(labels.authTimeout)).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '登录' })).toBeTruthy()
})

it('unsubscribes and cancels an owned website login when the appearance unloads', async () => {
  let finish: (state: PromptHubAccountState) => void = () => {}
  const pending = new Promise<PromptHubAccountState>(resolve => { finish = resolve })
  const unsubscribe = vi.fn()
  const bridge = { state: async () => signedOut, subscribe: () => unsubscribe, start: () => pending,
    cancel: vi.fn(async () => { finish(signedOut); return signedOut }) }
  const account = createPromptHubAccount(bridge)
  const signingIn = account.startSignIn()
  await account.dispose()
  await signingIn
  expect(bridge.cancel).toHaveBeenCalledOnce()
  expect(unsubscribe).toHaveBeenCalledOnce()
})
