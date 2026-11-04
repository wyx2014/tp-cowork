// @vitest-environment jsdom
import * as React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ComputerUsePage, zh, type ComputerUseKey } from '../src/client.tsx'
import type { ComputerUseStatus } from '../src/remote.ts'

afterEach(cleanup)
const t = (key: ComputerUseKey) => zh[key]

function form(value: { enabled?: boolean; allowedApps?: { id: string; name: string; executablePath: string }[] }) {
  let snapshot = { status: 'ready', writable: true, value }
  const listeners = new Set<() => void>()
  const set = vi.fn(async (key: string, next: unknown) => {
    snapshot = { ...snapshot, value: { ...snapshot.value, [key]: next } }
    for (const listener of listeners) listener()
    return true
  })
  return { set, getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) } }
}
const mount = (settings: ReturnType<typeof form>, status: ComputerUseStatus) =>
  render(<ComputerUsePage t={t} form={settings as never} status={async () => status} />)

it('turns Computer Use on, shows macOS permissions to grant, and removes an always-allowed app', async () => {
  const settings = form({ enabled: false, allowedApps: [{ id: 'a'.repeat(64), name: '备忘录', executablePath: '/System/Applications/Notes.app' }] })
  mount(settings, { supported: true, platform: 'darwin', checks: { accessibility: false, screen_recording: true }, detail: 'Accessibility: not granted' })
  await screen.findByText(zh.macPermissions)
  expect(screen.getByText('当前设备 · macOS')).toBeTruthy()
  expect(screen.getByText('辅助功能').parentElement!.textContent).toContain('✕')
  expect(screen.getByText('屏幕录制').parentElement!.textContent).toContain('✓')
  fireEvent.click(screen.getByRole('switch', { name: '电脑控制' }))
  await waitFor(() => expect(settings.set).toHaveBeenCalledWith('enabled', true))
  fireEvent.click(screen.getByRole('button', { name: '移除' }))
  await waitFor(() => expect(settings.set).toHaveBeenCalledWith('allowedApps', []))
  await screen.findByText(zh.allowedEmpty)
})

it('shows ZCode\'s unsupported notice instead of controls where Computer Use cannot run', async () => {
  const settings = form({ enabled: false })
  mount(settings, { supported: false, platform: 'linux', reason: 'wayland' })
  await screen.findByText(zh['reason.wayland'])
  expect((screen.getByRole('switch', { name: '电脑控制' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.queryByText(zh.allowed)).toBeNull()
})

it('reports Windows as ready', async () => {
  mount(form({ enabled: true }), { supported: true, platform: 'win32', checks: { accessibility: true } })
  await screen.findByText(zh.ready)
  expect(screen.getByText('当前设备 · Windows')).toBeTruthy()
})
