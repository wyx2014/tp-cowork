// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { ArchivesPage, type ArchivesPageProps } from '../src/client.tsx'
import { zh } from '../src/locales.ts'

afterEach(cleanup)
const source = <T,>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })
const t: ArchivesPageProps['t'] = (key, params) => String(zh[key]).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''))

it('opens a workspace archive as a list and keeps row restore and confirmed deletion', async () => {
  const api: ArchivesPageProps['api'] = {
    workspaces: source({ items: [], archivedSessionIds: ['a', 'b'] }),
    sessions: source({ byId: { a: { displayTitle: 'Research report', updatedAt: 200 }, b: { displayTitle: 'Weekly summary', updatedAt: 100 } } }),
    list: vi.fn().mockResolvedValue([{ sessionId: 'a', createdAt: 10 }, { sessionId: 'b', createdAt: 20 }]),
    remove: vi.fn().mockResolvedValue({ succeeded: 1, failed: 0, skipped: 0 }),
    unarchive: vi.fn().mockResolvedValue(undefined), rescan: vi.fn().mockResolvedValue(undefined),
  }
  const form = { ...source({ value: { autoArchive: false, autoArchiveDays: 7 }, status: 'ready', writable: true }), set: vi.fn().mockResolvedValue(true) } as unknown as ArchivesPageProps['form']
  const view = render(<ArchivesPage api={api} form={form} t={t} />)
  const toggle = await view.findByRole('button', { name: '未归类', exact: true })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle)
  const list = view.getByRole('list', { name: '未归类' })
  expect(list.id).toBe(toggle.getAttribute('aria-controls'))
  expect(view.getAllByRole('listitem')).toHaveLength(2)
  expect(list.querySelectorAll('time[datetime]')).toHaveLength(2)
  fireEvent.click(view.getAllByRole('button', { name: '取消归档', exact: true })[0]!)
  expect(api.unarchive).toHaveBeenCalledWith('a')
  expect(api.remove).not.toHaveBeenCalled()
  const remove = view.getByRole('button', { name: '删除“Weekly summary”', exact: true })
  await waitFor(() => expect(remove.hasAttribute('disabled')).toBe(false))
  fireEvent.click(remove)
  expect(api.remove).not.toHaveBeenCalled()
  fireEvent.click(view.getByText('取消', { selector: 'button', exact: true }))
  expect(api.remove).not.toHaveBeenCalled()
  fireEvent.click(remove)
  fireEvent.click(view.getByRole('button', { name: '删除', exact: true }))
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith(['b']))
})
