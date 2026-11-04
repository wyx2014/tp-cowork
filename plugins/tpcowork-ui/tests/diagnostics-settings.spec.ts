import React from 'react'
import * as primitives from '../../../../deepseek-harness/packages/client/ui-primitives/src/index.ts'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { installDiagnosticsSettings } from '../src/diagnostics-settings.js'
import zh from '../locale/zh.json' with { type: 'json' }

afterEach(cleanup)
const t = (key: string) => (zh as { ui: Record<string, string> }).ui[key] ?? key

function mount(bridge: unknown, active = 'zh-CN') {
  const registered: { options: Record<string, unknown>; component: (props: { t: typeof t }) => React.ReactNode }[] = []
  const ctx = {
    locale: { getSnapshot: () => ({ active }) },
    slots: {
      inject: (_name: string, register: () => unknown) => register(),
      register: (options: Record<string, unknown>, component: (props: { t: typeof t }) => React.ReactNode) => { registered.push({ options, component }) },
    },
  }
  installDiagnosticsSettings(ctx, React, primitives, 42, bridge)
  return registered
}

it('adds no row outside the desktop shell', () => {
  expect(mount(undefined)).toEqual([])
  expect(mount({})).toEqual([])
})

it('asks the desktop to export in the interface language and shows progress while it runs', async () => {
  let finish!: () => void
  const request = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const [row] = mount({ request })
  expect(row!.options).toMatchObject({ name: 'settings.general.item', id: 'tpcowork-diagnostics', order: 42 })
  render(React.createElement(row!.component, { t }))
  expect(screen.getByText('诊断信息')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '导出…' }))
  expect(request).toHaveBeenCalledWith('diagnostics', { action: 'export', locale: 'zh' })
  expect((screen.getByRole('button', { name: '正在导出…' }) as HTMLButtonElement).disabled).toBe(true)
  finish()
  await waitFor(() => expect(screen.getByRole('button', { name: '导出…' })).toBeTruthy())
})

it('explains when this desktop build cannot export', async () => {
  const [row] = mount({ request: vi.fn(async () => { throw new Error('Unknown operation') }) }, 'en')
  render(React.createElement(row!.component, { t }))
  fireEvent.click(screen.getByRole('button', { name: '导出…' }))
  await waitFor(() => expect(screen.getByText(/当前桌面版本不支持导出诊断信息/u)).toBeTruthy())
})
