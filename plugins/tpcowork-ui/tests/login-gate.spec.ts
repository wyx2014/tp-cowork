import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as primitives from '../../../../deepseek-harness/packages/client/ui-primitives/src/index.ts'
import { OnboardingSurface } from '../../../../deepseek-harness/packages/client/ui-settings-account/src/client/OnboardingSurface.tsx'
import { createLoginGate } from '../src/login-gate.js'

const LoginGate = createLoginGate(React, primitives, 'data:image/png;base64,')
const labels = JSON.parse(readFileSync(resolve(import.meta.dirname, '../locale/zh.json'), 'utf8')).ui
const inertDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'inert')
beforeEach(() => {
  // JSDOM does not reflect inert; native Chromium reflects property writes into the attribute.
  Object.defineProperty(HTMLElement.prototype, 'inert', { configurable: true,
    get(this: HTMLElement) { return this.hasAttribute('inert') },
    set(this: HTMLElement, value: boolean) { this.toggleAttribute('inert', value) },
  })
})
afterEach(() => {
  try { cleanup() }
  finally {
    if (inertDescriptor) Object.defineProperty(HTMLElement.prototype, 'inert', inertDescriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, 'inert')
  }
})

function mount(initial: { status: string; phase: string; error?: string }) {
  let state = initial
  const subscribers = new Set<() => void>()
  const account = { getSnapshot: () => state, subscribe: (listener: () => void) => { subscribers.add(listener); return () => subscribers.delete(listener) } }
  const startSignIn = vi.fn()
  const cancelSignIn = vi.fn()
  const refreshAccount = vi.fn()
  const view = render(React.createElement(React.Fragment, null,
    React.createElement('button', null, 'Private workspace'),
    React.createElement(LoginGate, { account, startSignIn, cancelSignIn, refreshAccount, t: (key: string) => labels[key] })))
  return { startSignIn, cancelSignIn, refreshAccount, background: view.container,
    publish(next: typeof state) { act(() => { state = next; for (const listener of subscribers) listener() }) } }
}

it('blocks every workbench surface until login and restores the barrier on logout or expiry', async () => {
  const fixture = mount({ status: 'loading', phase: 'idle' })
  expect(screen.getByText('正在确认账号…')).toBeTruthy()
  expect(fixture.background.hidden).toBe(true)
  expect(fixture.background.hasAttribute('inert')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Private workspace' })).toBeNull()
  fixture.publish({ status: 'signed_out', phase: 'idle' })
  expect(screen.getByRole('heading', { name: '欢迎来到 TP CoWork' })).toBeTruthy()
  expect(screen.getByText('连接账号，开始使用 TP CoWork')).toBeTruthy()
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(document.querySelector('.tpcowork-login-page')?.textContent).not.toMatch(/SkillHub|模型|配置|请先登录/)
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(document.querySelector('[data-dsh-modal-part="mask"]')!)
  expect(screen.getByRole('dialog', { name: '欢迎来到 TP CoWork' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '开始登录' }))
  expect(fixture.startSignIn).toHaveBeenCalledOnce()
  // A settings portal opened by an application command must also remain hidden and inert.
  const portal = document.createElement('div')
  portal.textContent = 'Private settings'
  portal.setAttribute('aria-hidden', 'false')
  document.body.appendChild(portal)
  await waitFor(() => expect(portal.hidden).toBe(true))
  expect(portal.hasAttribute('inert')).toBe(true)
  fixture.publish({ status: 'signed_in', phase: 'idle' })
  expect(screen.queryByRole('dialog', { name: '欢迎来到 TP CoWork' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Private workspace' })).toBeTruthy()
  expect(fixture.background.hidden).toBe(false)
  expect(fixture.background.hasAttribute('inert')).toBe(false)
  expect(portal.hidden).toBe(false)
  expect(portal.getAttribute('aria-hidden')).toBe('false')
  fixture.publish({ status: 'signed_out', phase: 'idle' })
  expect(screen.queryByRole('button', { name: 'Private workspace' })).toBeNull()
  fixture.publish({ status: 'signed_in', phase: 'idle' })
  fixture.publish({ status: 'expired', phase: 'idle' })
  expect(screen.getByText('登录已过期，请重新登录')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Private workspace' })).toBeNull()
  portal.remove()
})

it('keeps waiting and failed authentication on the login page with cancel and retry', () => {
  const fixture = mount({ status: 'signed_out', phase: 'waiting' })
  expect(screen.queryByRole('button', { name: 'Private workspace' })).toBeNull()
  expect(screen.getByRole('button', { name: '等待浏览器登录…' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '取消登录' }))
  expect(fixture.cancelSignIn).toHaveBeenCalledOnce()
  fixture.publish({ status: 'signed_out', phase: 'idle' })
  expect(screen.getByRole('dialog', { name: '欢迎来到 TP CoWork' })).toBeTruthy()
  fixture.publish({ status: 'unavailable', phase: 'idle', error: 'failed' })
  expect(screen.getByRole('alert').textContent).toContain('暂时无法登录')
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(fixture.refreshAccount).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: 'Private workspace' })).toBeNull()
})

it.each([
  ['startup-first', 'startup-first'], ['login-first', 'startup-first'],
  ['startup-first', 'login-first'], ['login-first', 'login-first'],
])('shares native onboarding isolation with login (mount: %s, release: %s)', async (order, release) => {
  const root = document.createElement('div')
  root.id = 'root'
  root.inert = false
  document.body.appendChild(root)
  try {
    const startup = order === 'startup-first' ? render(React.createElement(OnboardingSurface, null, 'Startup')) : null
    const fixture = mount({ status: 'signed_out', phase: 'idle' })
    const laterStartup = order === 'login-first' ? render(React.createElement(OnboardingSurface, null, 'Startup')) : null
    expect(root.inert).toBe(true)
    if (release === 'login-first') {
      fixture.publish({ status: 'signed_in', phase: 'idle' })
      expect(root.hidden).toBe(false)
      expect(root.inert).toBe(true)
    }
    startup?.unmount()
    laterStartup?.unmount()
    if (release === 'startup-first') {
      await waitFor(() => expect(root.hidden && root.inert).toBe(true))
      fixture.publish({ status: 'signed_in', phase: 'idle' })
    }
    expect(root.hidden).toBe(false)
    expect(root.inert).toBe(false)
  } finally {
    root.remove()
  }
})
