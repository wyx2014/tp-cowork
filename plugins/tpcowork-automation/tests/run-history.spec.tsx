// @vitest-environment jsdom
/** Rendered history writes to the real Host service, with delayed faults only where asserted. */
import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import Registry from '@deepseek-ai/dsh-typert-registry'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../deepseek-harness/packages/storage/storage-domain/tests/helpers/memory-backend.ts'
import { AutomationService } from '../src/host.ts'
import { AutomationPage } from '../src/AutomationPage.tsx'
import { AutomationCatalog } from '../src/ui-state.ts'
import { canOpenResult, collectRuns, groupRuns, isUnread, matchesFilter, runDateKey, runTitle, searchRuns } from '../src/run-history.ts'
import { en, zh } from '../src/ui-locales.ts'
import type { AutomationUiServices } from '../src/ui-types.ts'
import type { ScheduledTask, ScheduledTaskRun } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
async function harness() {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage); await ctx.plugin(Registry)
  const backend = new MemoryStorageBackend(new MemoryMediaPool())
  ctx.effect(() => ctx.storage.backend.register('runs', backend))
  const domains = new DomainFacility(ctx, { backend: 'runs' }); ctx.provide('storageDomain', domains)
  ctx.effect(() => async () => { await domains.closeAll(); await backend.close() })
  let fiber = await ctx.plugin(AutomationService)
  const projects: never[] = []
  const services: AutomationUiServices = { automation: ctx.automation, bindings: async () => ({ skills: [], connectors: [], skillsAvailable: true }),
    projects: { getSnapshot: () => projects, subscribe: () => () => {} }, askAssistant: vi.fn(), openSession: vi.fn(async () => {}) }
  async function create(name: string, status: 'running' | 'completed' | 'error' = 'completed', extra: { once?: boolean; reminder?: boolean; missing?: boolean } = {}) {
    const task = (await ctx.automation.create({ name, prompt: `Instructions for ${name}`, schedule: extra.once ? { frequency: 'once', at: '2031-01-01T00:00:00Z' } : { frequency: 'manual' }, executionMode: extra.reminder ? 'reminder' : 'agent' })).tasks.find(t => t.name === name)!
    const run = await ctx.automation.beginRun({ taskId: task.id, trigger: 'manual' })
    if (!extra.reminder) await ctx.automation.bindRun({ taskId: task.id, runId: run.id, sessionId: `session-${name}`, ownsSession: false, conversationAvailable: true })
    if (status !== 'running') await ctx.automation.finishRun({ taskId: task.id, runId: run.id, status,
      resultType: extra.reminder ? 'none' : 'conversation', conversationAvailable: !extra.reminder && !extra.missing,
      ...(extra.missing ? { unavailableReason: 'missing' } : {}), ...(status === 'error' ? { error: 'Visible execution failure' } : {}) })
    return { task, run }
  }
  async function show(locale: 'en' | 'zh' = 'en') {
    const copy = locale === 'en' ? en : zh
    render(<AutomationPage services={services} locale={locale} t={key => copy[key]} />)
    fireEvent.click(await screen.findByRole('tab', { name: new RegExp(copy.runs) }))
    return copy
  }
  const read = async (task: ScheduledTask) => (await ctx.automation.list()).tasks.find(t => t.id === task.id)
  return { ctx, services, create, show, read, reopen: async () => { await fiber.dispose(); fiber = await ctx.plugin(AutomationService) } }
}
const row = (name: string) => screen.getByText(name, { selector: '.tp-auto-history-task > span' }).closest('tr')!
const button = (name: string, text: string) => within(row(name)).getByRole('button', { name: text, exact: true })
const menuAction = (name: string, label: string) => {
  fireEvent.click(button(name, en.runActions))
  fireEvent.click(screen.getByRole('menuitem', { name: label, exact: true }))
}

it.each(['en', 'zh'] as const)('shows a compact %s table including archived runs, with direct conversation actions', async locale => {
  const h = await harness()
  await h.create('alpha', 'running'); await h.create('beta', 'error'); const archived = await h.create('archived', 'completed', { once: true })
  await h.ctx.automation.markRunViewed({ taskId: archived.task.id, runId: archived.run.id })
  const t = await h.show(locale)
  expect(screen.getByRole('table', { name: t.runs })).toBeDefined()
  expect(screen.getAllByRole('row')).toHaveLength(4)
  expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual([t.name, t.triggeredAt, t.triggerSource, t.status, t.historyDuration, t.runActions])
  expect(screen.queryByRole('searchbox')).toBeNull()
  expect(screen.queryByRole('button', { name: t.details })).toBeNull()
  expect(within(row('beta')).getByLabelText(t.unread)).toBeDefined()
  expect(within(row('alpha')).queryByLabelText(t.unread)).toBeNull()
  expect(within(row('archived')).queryByLabelText(t.unread)).toBeNull()
  expect(h.services.openSession).not.toHaveBeenCalled()
})

it('leaves a failed open unread and retries that result directly from the error', async () => {
  const h = await harness(); const { task } = await h.create('once', 'completed', { once: true })
  h.services.openSession = vi.fn().mockRejectedValueOnce(new Error('missing')).mockResolvedValue(undefined)
  await h.show()
  expect((await h.read(task))!.runs[0]!.viewedAt).toBeUndefined()
  fireEvent.click(button('once', en.jumpToSession))
  await screen.findByText(en.openFailed)
  expect((await h.read(task))!.runs[0]!.viewedAt).toBeUndefined()
  expect(within(row('once')).getByLabelText(en.unread)).toBeDefined()
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: en.retry }))
  await waitFor(() => expect(h.services.openSession).toHaveBeenCalledTimes(2))
  await waitFor(async () => expect((await h.read(task))!.runs[0]!.viewedAt).toBeDefined())
  expect(h.services.openSession).toHaveBeenLastCalledWith('session-once', expect.stringContaining(' - once'), expect.any(AbortSignal))
  expect(screen.queryByRole('region', { name: en.details })).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: /^Tasks/ }))
  expect(screen.queryByRole('heading', { name: 'once', exact: true })).toBeNull()
  await h.reopen(); expect((await h.read(task))!.runs[0]!.viewedAt).toBeDefined()
})

it('reports an explicitly deleted result separately and preserves unread state', async () => {
  const h = await harness(); const { task } = await h.create('deleted result')
  h.services.openSession = vi.fn().mockRejectedValue({ code: 'session/not-found' })
  await h.show(); fireEvent.click(button('deleted result', en.jumpToSession))
  await screen.findByText(en.missingResult)
  expect(screen.queryByText(en.openFailed)).toBeNull()
  expect((await h.read(task))!.runs[0]!.viewedAt).toBeUndefined()
})

it('opens the conversation even when saving its read status fails', async () => {
  const h = await harness(); const { task } = await h.create('read failure')
  vi.spyOn(h.ctx.automation, 'markRunViewed').mockRejectedValue({ code: 'automation/storage_failure' })
  await h.show(); fireEvent.click(button('read failure', en.jumpToSession))
  await screen.findByText(en.storageFailure)
  expect(h.services.openSession).toHaveBeenCalledTimes(1)
  expect(screen.queryByText(en.openFailed)).toBeNull()
  expect((await h.read(task))!.runs[0]!.viewedAt).toBeUndefined()
})

it('follows a running result without marking read, then acknowledges the followed result when it finishes', async () => {
  const h = await harness(); const { task, run } = await h.create('live', 'running')
  const interval = vi.spyOn(window, 'setInterval')
  await h.show()
  fireEvent.click(button('live', en.runActions))
  expect(screen.getByRole('menuitem', { name: en.deleteRecord })).toHaveProperty('disabled', true)
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(button('live', en.jumpToSession))
  await waitFor(() => expect(h.services.openSession).toHaveBeenCalledTimes(1))
  expect((await h.read(task))!.runs[0]!.viewedAt).toBeUndefined()
  await h.ctx.automation.finishRun({ taskId: task.id, runId: run.id, status: 'completed', resultType: 'conversation', conversationAvailable: true })
  const refresh = interval.mock.calls[0]![0] as () => void
  await act(async () => { refresh() })
  await waitFor(async () => expect((await h.read(task))!.runs[0]!.viewedAt).toBeDefined())
})

it('confirms reminders without navigation; once is removed, recurring read survives reopen', async () => {
  const h = await harness(); const once = await h.create('once reminder', 'completed', { once: true, reminder: true })
  const repeat = await h.create('repeat reminder', 'completed', { reminder: true })
  await h.show()
  expect(screen.queryByRole('button', { name: en.details })).toBeNull()
  fireEvent.click(button('once reminder', en.confirmReminder))
  await waitFor(() => expect(screen.queryByText('once reminder', { selector: '.tp-auto-history-task > span' })).toBeNull())
  expect(await h.read(once.task)).toBeUndefined()
  fireEvent.click(button('repeat reminder', en.confirmReminder))
  await waitFor(() => expect(button('repeat reminder', en.confirmed)).toHaveProperty('disabled', true))
  expect(h.services.openSession).not.toHaveBeenCalled()
  await h.reopen(); expect((await h.read(repeat.task))!.runs[0]!.viewedAt).toBeDefined()
})

it('disables missing conversations, exposes execution failure on hover and retries explicit acknowledgement', async () => {
  const h = await harness(); const { task } = await h.create('missing', 'error', { missing: true })
  const viewed = vi.spyOn(h.ctx.automation, 'markRunViewed').mockRejectedValueOnce({ code: 'automation/storage_failure' })
  await h.show()
  expect(button('missing', en.jumpToSession)).toHaveProperty('disabled', true)
  expect(button('missing', en.jumpToSession).getAttribute('title')).toBe(en.missingResult)
  expect(screen.getByTitle('Visible execution failure')).toBeDefined()
  expect(viewed).not.toHaveBeenCalled()
  menuAction('missing', en.viewed)
  await screen.findByText(en.storageFailure)
  expect(viewed).toHaveBeenCalledTimes(1)
  expect((await h.read(task))!.runs[0]!.viewedAt).toBeUndefined()
  menuAction('missing', en.viewed)
  await waitFor(async () => expect((await h.read(task))!.runs[0]!.viewedAt).toBeDefined())
  expect(h.services.openSession).not.toHaveBeenCalled()
})

it('requires deletion confirmation, prevents duplicate writes, keeps a failed record and permits retry', async () => {
  const h = await harness(); const { task, run } = await h.create('delete me')
  let reject!: (value: unknown) => void
  const remove = vi.spyOn(h.ctx.automation, 'deleteRun').mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  await h.show(); menuAction('delete me', en.deleteRecord)
  let dialog = screen.getByRole('dialog')
  expect(remove).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: en.cancel }))
  expect(screen.queryByRole('dialog')).toBeNull()
  menuAction('delete me', en.deleteRecord); dialog = screen.getByRole('dialog')
  const confirm = within(dialog).getByRole('button', { name: en.deleteRecord })
  fireEvent.click(confirm); fireEvent.click(confirm)
  expect(remove).toHaveBeenCalledTimes(1); expect(confirm).toHaveProperty('disabled', true)
  await act(async () => reject({ code: 'automation/session_cleanup_failed' }))
  await within(dialog).findByText(en.cleanupFailure)
  expect((await h.read(task))!.runs.some(r => r.id === run.id)).toBe(true)
  fireEvent.click(confirm)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByText('delete me', { selector: '.tp-auto-history-task > span' })).toBeNull()
  expect((await h.read(task))!.runs).toEqual([])
})

it('drops a stale pre-confirmation poll instead of resurrecting a removed reminder', async () => {
  const h = await harness(); const { task, run } = await h.create('gone', 'completed', { once: true, reminder: true })
  const previous = await h.ctx.automation.list()
  let resolve!: (value: typeof previous) => void
  const list = h.services.automation.list
  h.services.automation.list = () => new Promise(done => { resolve = done })
  const catalog = new AutomationCatalog(h.services.automation)
  const poll = catalog.refresh()
  await catalog.mutate(() => h.ctx.automation.markRunViewed({ taskId: task.id, runId: run.id }))
  resolve(previous); await poll
  expect(catalog.getSnapshot().catalog!.tasks).toEqual([])
  catalog.dispose(); h.services.automation.list = list
})

it('calendar grouping sorts by start time and never borrows Session titles or infers availability', async () => {
  const h = await harness(); await h.create('alpha'); await h.create('beta')
  const tasks = (await h.ctx.automation.list()).tasks
  const first = tasks.find(t => t.name === 'alpha')!.runs[0]!, second = tasks.find(t => t.name === 'beta')!.runs[0]!
  first.startedAt = new Date(2026, 9, 14, 23, 59).getTime(); second.startedAt = new Date(2026, 9, 15, 0, 1).getTime()
  const entries = collectRuns(tasks)
  expect(entries.map(e => e.run.startedAt)).toEqual([second.startedAt, first.startedAt])
  expect(groupRuns(entries).map(([date]) => date)).toEqual([runDateKey(second.startedAt), runDateKey(first.startedAt)])
  expect(runTitle(entries[0]!, 'en')).toContain(' - beta')
  expect(searchRuns(entries, 'ALPHA', 'en')).toHaveLength(1)
  expect(isUnread({ ...first, viewedAt: 0 })).toBe(false)
  expect(matchesFilter({ ...first, status: 'running' }, 'unread')).toBe(false)
  for (const patch of [{ resultType: 'none' }, { conversationAvailable: false }, { conversationId: undefined }, { unavailableReason: 'legacy' }]) {
    expect(canOpenResult({ ...first, ...patch } as ScheduledTaskRun)).toBe(false)
  }
})


it('none results confirm without a fake conversation even for an agent failure', async () => {
  const h = await harness(); const { task, run } = await h.create('no result', 'running')
  await h.ctx.automation.finishRun({ taskId: task.id, runId: run.id, status: 'error', resultType: 'none', conversationAvailable: false, error: 'No usable result' })
  await h.show()
  expect(screen.queryByRole('button', { name: en.details })).toBeNull()
  expect(screen.getByTitle('No usable result')).toBeDefined()
  fireEvent.click(button('no result', en.confirmReminder))
  await waitFor(() => expect(button('no result', en.confirmed)).toHaveProperty('disabled', true))
  expect(h.services.openSession).not.toHaveBeenCalled()
  expect(await h.read(task)).toBeDefined()
})

it('leaving history cancels an outstanding open attempt', async () => {
  const h = await harness(); await h.create('pending open', 'running')
  let openSignal!: AbortSignal
  h.services.openSession = vi.fn((_id, _title, signal) => new Promise<void>(resolve => {
    openSignal = signal
    signal.addEventListener('abort', () => resolve(), { once: true })
  }))
  await h.show(); fireEvent.click(button('pending open', en.jumpToSession))
  await waitFor(() => expect(h.services.openSession).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('tab', { name: /^Tasks/ }))
  expect(openSignal.aborted).toBe(true)
  expect(screen.queryByRole('alert')).toBeNull()
})
