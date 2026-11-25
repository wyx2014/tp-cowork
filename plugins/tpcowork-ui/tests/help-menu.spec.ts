import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as primitives from '../../../../deepseek-harness/packages/client/ui-primitives/src/index.ts'
import zh from '../locale/zh.json'
import en from '../locale/en.json'
import { createHelpMenu } from '../src/help-menu.js'

const pluginStyles = readFileSync(resolve(import.meta.dirname, '../styles.css'), 'utf8')

afterEach(() => {
  cleanup()
  document.body.removeAttribute('data-tpcowork-ui')
  document.getElementById('tpcowork-ui-test-styles')?.remove()
})

function translator(messages: Record<string, string>) {
  return (key: string, params?: Record<string, string>) =>
    (messages[key] ?? key).replace(/\{(\w+)\}/gu, (_match, name: string) => String(params?.[name] ?? ''))
}

it('renders the reference About TP CoWork 0.1.0 card with Apple Silicon note, copyright and OK dismissal', async () => {
  const HelpMenu = createHelpMenu(React, createPortal, primitives, 'data:image/png;base64,AA==', 'frame', {
    FloatingToastStack: () => null,
    successDuration: 3500,
  })
  const snapshot = { status: 'signed_in', phase: 'idle', user: { id: 'u1' } }
  const account = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
  }
  const desktop = {
    deviceInfo: vi.fn(async () => 'platform=darwin; app_arch=arm64; memory_gib=32.0'),
  }
  const year = String(new Date().getFullYear())

  document.body.setAttribute('data-tpcowork-ui', '')
  const style = document.createElement('style')
  style.id = 'tpcowork-ui-test-styles'
  style.textContent = pluginStyles
  document.head.append(style)

  const view = render(React.createElement(HelpMenu, {
    t: translator(zh.ui),
    submitFeedback: vi.fn(),
    attachFeedbackIssue: vi.fn(),
    listFeedbackIssues: vi.fn(),
    account,
    desktop,
    workspace: false,
  }))

  await waitFor(() => expect(desktop.deviceInfo).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: '帮助' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '关于 TP CoWork' }))

  const dialog = await screen.findByRole('dialog', { name: '关于 TP CoWork' })
  expect(dialog.getAttribute('data-dsh-modal')).toBe('headless')
  expect(dialog.classList.contains('tpcowork-about-dialog')).toBe(true)
  expect(getComputedStyle(dialog).getPropertyValue('--dsh-modal-width').trim()).toBe('256px')
  expect(getComputedStyle(dialog).maxWidth).toBe('256px')
  expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe('TP CoWork版本 0.1.0')
  expect(within(dialog).getByText('已针对 Apple Silicon 优化。')).toBeTruthy()
  expect(within(dialog).getByText(`版权所有 © ${year} TP CoWork。`)).toBeTruthy()

  fireEvent.click(within(dialog).getByRole('button', { name: '确定' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '关于 TP CoWork' })).toBeNull())

  // English locale without Apple Silicon omits the optimization line and closes on Enter.
  view.rerender(React.createElement(HelpMenu, {
    t: translator(en.ui),
    submitFeedback: vi.fn(),
    attachFeedbackIssue: vi.fn(),
    listFeedbackIssues: vi.fn(),
    account,
    desktop: { deviceInfo: vi.fn(async () => 'platform=win32; app_arch=x64') },
    workspace: false,
  }))
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'About TP CoWork' }))

  const enDialog = await screen.findByRole('dialog', { name: 'About TP CoWork' })
  expect(within(enDialog).getByRole('heading', { level: 2 }).textContent).toBe('TP CoWorkversion 0.1.0')
  expect(within(enDialog).queryByText('Optimized for Apple Silicon.')).toBeNull()
  expect(within(enDialog).getByText(`Copyright © ${year} TP CoWork.`)).toBeTruthy()
  expect(within(enDialog).getByRole('button', { name: 'OK' })).toBeTruthy()
  fireEvent.keyDown(enDialog, { key: 'Enter' })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'About TP CoWork' })).toBeNull())
})
