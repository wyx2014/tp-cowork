// @vitest-environment jsdom
/** Rendered forms talk to real Host storage; catalogs alone are delayed for race tests. */
import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../deepseek-harness/packages/storage/storage-domain/tests/helpers/memory-backend.ts'
import { AutomationService } from '../src/host.ts'
import { AutomationPage } from '../src/AutomationPage.tsx'
import { AutomationEditor } from '../src/AutomationEditor.tsx'
import { en, zh } from '../src/ui-locales.ts'
import { getAutomationTemplates } from '../src/automation-templates.ts'
import { AutomationCatalog, newDraft, isArchivedOneTimeTask } from '../src/ui-state.ts'
import { wallTime, wallTimeInstant } from '../src/editor-time.ts'
import { SlotRegistry } from '../../../../deepseek-harness/packages/client/ui-renderer/src/client/registry.ts'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { registerAutomationUi } from '../src/ui.tsx'
import type { AutomationUiServices } from '../src/ui-types.ts'
import type { ScheduleConfig, ScheduleTaskDraft, ScheduleTasksPayload } from '../src/types.ts'

const contexts: Context[] = []
const empty: ScheduleTasksPayload = { tasks: [], status: { enabled: true, jobs: 0, next_wake_at_ms: null } }
afterEach(async () => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
async function harness() {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage); await ctx.plugin(TypertRegistry)
  const backend = new MemoryStorageBackend(new MemoryMediaPool())
  ctx.effect(() => ctx.storage.backend.register('ui', backend))
  const facility = new DomainFacility(ctx, { backend: 'ui' }); ctx.provide('storageDomain', facility)
  ctx.effect(() => async () => { await facility.closeAll(); await backend.close() })
  await ctx.plugin(AutomationService)
  const projects = [{ id: WorkspaceId('alpha'), name: 'Alpha', path: '/project/alpha' }, { id: WorkspaceId('beta'), name: 'Beta', path: '/project/beta' }]
  const services: AutomationUiServices = {
    automation: ctx.automation, projects: { getSnapshot: () => projects, subscribe: () => () => {} },
    bindings: vi.fn(async () => ({ skills: [{ name: 'report', description: 'Report' }], connectors: [{ name: 'docs' }, { name: 'mail' }], skillsAvailable: true })),
    askAssistant: vi.fn(), openSession: vi.fn(async () => {}),
  }
  return { ctx, services, projects }
}
const draft = (schedule: ScheduleConfig): ScheduleTaskDraft => ({ name: 'Round trip', prompt: 'Read this workspace', schedule })
const text = (key: keyof typeof en) => en[key]
function input(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
function pickProject(name: string) {
  fireEvent.click(screen.getByRole('button', { name: en.selectProject }))
  fireEvent.click(screen.getByRole('menuitem', { name, exact: true }))
}
async function addSchedule() {
  fireEvent.click(screen.getByText(en.addSchedule))
  fireEvent.click(screen.getByRole('menuitem', { name: en.once, exact: true }))
  await screen.findByRole('button', { name: en.removeSchedule })
}

describe('task page and detached editor', () => {
  it('keeps the draft across editor tabs, requires a schedule and round-trips execution choices and default clearing', async () => {
    const { ctx, services } = await harness()
    services.executionOptions = async () => ({
      models: { default: { provider: 'test', model: 'standard' }, routableProviders: ['test'], failures: [], groups: [{ id: 'test', name: 'Test', models: [
        { id: 'standard', name: 'Standard' }, { id: 'reasoner', name: 'Reasoner', reasoning: { efforts: [
          { id: ReasoningEffortId('low'), name: 'Low' }, { id: ReasoningEffortId('high'), name: 'High' },
        ], defaultEffort: ReasoningEffortId('low') } },
      ] }] },
      permissions: { defaultPreset: 'workspace-write', defaultOptions: [], options: [
        { value: 'workspace-write', name: 'Workspace write' }, { value: 'danger-full-access', name: 'Full access' },
      ] },
    })
    const hostUpdate = ctx.automation.update.bind(ctx.automation)
    const update = vi.spyOn(ctx.automation, 'update').mockImplementation(request => hostUpdate(JSON.parse(JSON.stringify(request))))
    render(<AutomationPage services={services} locale="en" t={text} />)
    fireEvent.click(await screen.findByRole('button', { name: en.new }))
    input(en.name, 'Zcode editor'); input(en.prompt, 'Preserve this unsaved draft')
    await addSchedule()
    fireEvent.click(screen.getByRole('button', { name: en.removeSchedule }))
    expect(screen.getByRole('button', { name: en.createTask })).toHaveProperty('disabled', true)
    await addSchedule(); input(en.frequency, 'manual')
    await waitFor(() => expect(screen.getByLabelText(en.model)).toHaveProperty('disabled', false))
    input(en.model, JSON.stringify(['test', 'reasoner'])); input(en.reasoning, 'high'); input(en.permissions, 'danger-full-access')
    fireEvent.click(screen.getByRole('tab', { name: en.editorHistory, exact: true }))
    expect(screen.getByText(en.newHistoryHint)).toBeDefined()
    expect((await ctx.automation.list()).tasks).toHaveLength(0)
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' })
    expect(screen.getByLabelText(en.prompt)).toHaveProperty('value', 'Preserve this unsaved draft')
    expect(screen.getByLabelText(en.model)).toHaveProperty('value', JSON.stringify(['test', 'reasoner']))
    fireEvent.click(screen.getByRole('button', { name: en.createTask }))
    await screen.findByRole('heading', { name: 'Zcode editor' })
    expect((await ctx.automation.list()).tasks[0]).toMatchObject({ modelSelection: { provider: 'test', model: 'reasoner', reasoningEffort: 'high' }, permissionPreset: 'danger-full-access' })
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    await waitFor(() => expect(screen.getByLabelText(en.model)).toHaveProperty('disabled', false))
    expect(screen.getByLabelText(en.reasoning)).toHaveProperty('value', 'high')
    expect(screen.getByLabelText(en.permissions)).toHaveProperty('value', 'danger-full-access')
    input(en.model, ''); input(en.permissions, '')
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByRole('heading', { name: 'Zcode editor' })
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ modelSelection: null, permissionPreset: null }) }))
    expect((await ctx.automation.list()).tasks[0]!.modelSelection).toBeUndefined()
    expect((await ctx.automation.list()).tasks[0]!.permissionPreset).toBeUndefined()
  })

  it('selects a frequency before adding a schedule, edits its fields inline and keeps an existing timezone internally', async () => {
    const { ctx, services } = await harness()
    const zone = 'America/New_York'
    await ctx.automation.create(draft({ frequency: 'daily', time: { hour: 9, minute: 0 }, timezone: zone }))
    render(<AutomationPage services={services} locale="en" t={text} />)
    fireEvent.click(await screen.findByRole('button', { name: en.edit }))
    expect(screen.queryByLabelText(en.timezone)).toBeNull()
    expect(screen.queryByText(zone)).toBeNull()
    input(en.time, '14:01')
    fireEvent.click(screen.getByRole('button', { name: en.removeSchedule }))
    fireEvent.click(screen.getByText(en.addSchedule))
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('menuitem', { name: en.weekly, exact: true }))
    input(en.dayOfWeek, '5')
    expect(screen.getByLabelText(en.time).closest('.tp-auto-schedule-inline')).not.toBeNull()
    expect(screen.queryByLabelText(en.timezone)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByRole('heading', { name: 'Round trip' })
    expect((await ctx.automation.list()).tasks[0]!.schedule).toMatchObject({ frequency: 'weekly', dayOfWeek: 5, time: { hour: 14, minute: 1 }, timezone: zone })
  })

  it('shows only the edited task in its history tab and preserves unsaved settings when returning', async () => {
    const { ctx, services } = await harness()
    for (const name of ['First', 'Second']) {
      const task = (await ctx.automation.create({ ...draft({ frequency: 'manual' }), name })).tasks.find(task => task.name === name)!
      const run = await ctx.automation.beginRun({ taskId: task.id, trigger: 'manual' })
      await ctx.automation.finishRun({ taskId: task.id, runId: run.id, status: 'completed', resultType: 'none', conversationAvailable: false })
    }
    render(<AutomationPage services={services} locale="en" t={text} />)
    const card = (await screen.findByRole('heading', { name: 'First' })).closest('article')!
    fireEvent.click(within(card).getByRole('button', { name: en.edit }))
    input(en.name, 'Unsaved first')
    fireEvent.click(screen.getByRole('tab', { name: en.editorHistory, exact: true }))
    const table = screen.getByRole('table', { name: en.editorHistory })
    const first = (await ctx.automation.list()).tasks.find(task => task.name === 'First')!
    expect(table.querySelector('tbody tr')?.getAttribute('data-run-id')).toBe(first.runs[0]!.id)
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('button', { name: en.run, exact: true })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: en.editorSettings, exact: true }))
    expect(screen.getByLabelText(en.name)).toHaveProperty('value', 'Unsaved first')
    expect((await ctx.automation.list()).tasks.find(task => task.name === 'First')).toBeDefined()
  })

  it('saves the current draft before running, blocks duplicate submissions and protects live records', async () => {
    const { ctx, services } = await harness()
    const runNow = vi.fn(async (id: Parameters<typeof ctx.automation.runNow>[0]['id']) => {
      expect((await ctx.automation.list()).tasks.find(task => task.id === id)!.prompt).toBe('Current instructions')
      await ctx.automation.beginRun({ taskId: id, trigger: 'manual' })
    })
    ctx.effect(() => ctx.automation.attachRuntime({ runNow, nextRunAt: () => undefined, dispose: async () => {} }))
    const task = (await ctx.automation.create(draft({ frequency: 'manual' }))).tasks[0]!
    const hostUpdate = ctx.automation.update.bind(ctx.automation)
    let release!: () => void
    const update = vi.spyOn(ctx.automation, 'update').mockImplementationOnce(async request => {
      await new Promise<void>(done => { release = done })
      return hostUpdate(request)
    })
    render(<AutomationPage services={services} locale="en" t={text} />)
    fireEvent.click(await screen.findByRole('button', { name: en.edit }))
    input(en.prompt, 'Current instructions')
    const runButton = screen.getByRole('button', { name: en.run, exact: true })
    fireEvent.click(runButton); fireEvent.click(runButton)
    expect(update).toHaveBeenCalledTimes(1)
    expect(runNow).not.toHaveBeenCalled()
    expect(runButton).toHaveProperty('disabled', true)
    await act(async () => release())
    await waitFor(() => expect(runNow).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true))
    expect(screen.getByLabelText(en.prompt)).toHaveProperty('value', 'Current instructions')
    fireEvent.click(screen.getByRole('button', { name: en.taskActions }))
    expect(screen.getByRole('menuitem', { name: en.editorDelete })).toHaveProperty('disabled', true)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('tab', { name: en.editorHistory, exact: true }))
    fireEvent.click(screen.getByRole('button', { name: en.runActions }))
    expect(screen.getByRole('menuitem', { name: en.deleteRecord })).toHaveProperty('disabled', true)
    expect(screen.getByRole('menuitem', { name: en.jumpToSession })).toHaveProperty('disabled', true)
    expect((await ctx.automation.list()).tasks.find(t => t.id === task.id)!.runs).toHaveLength(1)
  })

  it('does not run on a failed save, retains the editor on admission failure and allows retry', async () => {
    const { ctx, services } = await harness()
    const runNow = vi.fn().mockRejectedValueOnce({ code: 'automation/runtime_unavailable' }).mockResolvedValue(undefined)
    ctx.effect(() => ctx.automation.attachRuntime({ runNow, nextRunAt: () => undefined, dispose: async () => {} }))
    await ctx.automation.create(draft({ frequency: 'manual' }))
    const update = vi.spyOn(ctx.automation, 'update').mockRejectedValueOnce({ code: 'automation/storage_failure' })
    render(<AutomationPage services={services} locale="en" t={text} />)
    fireEvent.click(await screen.findByRole('button', { name: en.edit }))
    input(en.name, 'Unsaved until retry')
    fireEvent.click(screen.getByRole('button', { name: en.run, exact: true }))
    await screen.findByText(en.storageFailure)
    expect(runNow).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.run, exact: true }))
    await screen.findByText(en.runtimeUnavailable)
    expect(screen.getByLabelText(en.name)).toHaveProperty('value', 'Unsaved until retry')
    fireEvent.click(screen.getByRole('button', { name: en.run, exact: true }))
    await waitFor(() => expect(runNow).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(update).toHaveBeenCalledTimes(3)
    expect(screen.getByLabelText(en.name)).toHaveProperty('value', 'Unsaved until retry')
  })

  it('pauses and resumes through the editor menu without saving the draft and retries task deletion', async () => {
    const { ctx, services } = await harness()
    const task = (await ctx.automation.create(draft({ frequency: 'daily', time: { hour: 9, minute: 0 } }))).tasks[0]!
    render(<AutomationPage services={services} locale="en" t={text} />)
    fireEvent.click(await screen.findByRole('button', { name: en.edit }))
    input(en.name, 'Still a draft')
    fireEvent.click(screen.getByRole('button', { name: en.taskActions }))
    fireEvent.click(screen.getByRole('menuitem', { name: en.pause }))
    await screen.findByText(en.paused)
    expect((await ctx.automation.list()).tasks[0]).toMatchObject({ id: task.id, name: task.name, status: 'paused' })
    fireEvent.click(screen.getByRole('button', { name: en.taskActions }))
    fireEvent.click(screen.getByRole('menuitem', { name: en.resume }))
    await screen.findByText(en.editorActive)
    expect(screen.getByLabelText(en.name)).toHaveProperty('value', 'Still a draft')
    fireEvent.click(screen.getByRole('tab', { name: en.editorHistory, exact: true }))
    fireEvent.click(screen.getByRole('button', { name: en.taskActions }))
    fireEvent.click(screen.getByRole('menuitem', { name: en.editorDelete }))
    const remove = vi.spyOn(ctx.automation, 'delete').mockRejectedValueOnce({ code: 'automation/storage_failure' })
    let dialog = screen.getByRole('dialog', { name: en.delete })
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: en.cancel }))
    fireEvent.click(screen.getByRole('button', { name: en.taskActions }))
    fireEvent.click(screen.getByRole('menuitem', { name: en.editorDelete }))
    dialog = screen.getByRole('dialog', { name: en.delete })
    fireEvent.click(within(dialog).getByRole('button', { name: en.delete }))
    await within(dialog).findByText(en.storageFailure)
    expect((await ctx.automation.list()).tasks).toHaveLength(1)
    fireEvent.click(within(dialog).getByRole('button', { name: en.delete }))
    await screen.findByText(en.empty)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((await ctx.automation.list()).tasks).toHaveLength(0)
  })

  it('renders trigger time, source, skipped and successful outcomes with compact durations and deletes only the chosen record', async () => {
    const { ctx, services } = await harness()
    const task = (await ctx.automation.create(draft({ frequency: 'daily' }))).tasks[0]!
    const scheduledAt = new Date('2026-10-18T01:00:00Z').getTime()
    await ctx.automation.setNextRunAt(task.id, scheduledAt)
    const skipped = await ctx.automation.beginRun({ taskId: task.id, trigger: 'scheduled', scheduledAt })
    await ctx.automation.finishRun({ taskId: task.id, runId: skipped.id, status: 'skipped', resultType: 'none', conversationAvailable: false, skippedReason: 'Computer was asleep', completedAt: skipped.startedAt })
    const success = await ctx.automation.beginRun({ taskId: task.id, trigger: 'manual' })
    await ctx.automation.finishRun({ taskId: task.id, runId: success.id, status: 'completed', resultType: 'none', conversationAvailable: false, completedAt: success.startedAt + 324000 })
    render(<AutomationPage services={services} locale="zh" t={key => zh[key]} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.edit }))
    fireEvent.click(screen.getByRole('tab', { name: zh.editorHistory, exact: true }))
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual([zh.triggeredAt, zh.triggerSource, zh.status, zh.historyDuration, zh.runActions])
    const skipRow = document.querySelector(`[data-run-id="${skipped.id}"]`) as HTMLElement
    expect(within(skipRow).getByText(zh.runSkipped)).toBeDefined()
    expect(within(skipRow).getByText(zh.scheduledTrigger)).toBeDefined()
    expect(within(skipRow).getByText('0s')).toBeDefined()
    expect(skipRow.querySelector('time')?.dateTime).toBe(new Date(scheduledAt).toISOString())
    const successRow = document.querySelector(`[data-run-id="${success.id}"]`) as HTMLElement
    expect(within(successRow).getByText('5m 24s')).toBeDefined()
    expect(within(successRow).getByText(zh.runSuccess)).toBeDefined()
    fireEvent.click(within(skipRow).getByRole('button', { name: zh.runActions }))
    expect(screen.getByRole('menuitem', { name: zh.jumpToSession })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('menuitem', { name: zh.deleteRecord }))
    const remove = vi.spyOn(ctx.automation, 'deleteRun').mockRejectedValueOnce({ code: 'automation/session_cleanup_failed' })
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: zh.deleteRecord }))
    await within(dialog).findByText(zh.cleanupFailure)
    expect((await ctx.automation.list()).tasks[0]!.runs).toHaveLength(2)
    fireEvent.click(within(dialog).getByRole('button', { name: zh.deleteRecord }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(remove).toHaveBeenLastCalledWith({ taskId: task.id, runId: skipped.id })
    expect((await ctx.automation.list()).tasks[0]!.runs.map(run => run.id)).toEqual([success.id])
  })

  it('jumps directly to an existing result, persists read state and never creates a new session', async () => {
    const { ctx, services } = await harness()
    const task = (await ctx.automation.create(draft({ frequency: 'manual' }))).tasks[0]!
    const run = await ctx.automation.beginRun({ taskId: task.id, trigger: 'manual' })
    await ctx.automation.bindRun({ taskId: task.id, runId: run.id, sessionId: 'existing-result', ownsSession: false, conversationAvailable: true })
    await ctx.automation.finishRun({ taskId: task.id, runId: run.id, status: 'completed', resultType: 'conversation', conversationAvailable: true })
    const markViewed = vi.spyOn(ctx.automation, 'markRunViewed').mockRejectedValueOnce({ code: 'automation/storage_failure' })
    services.openSession = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    render(<AutomationPage services={services} locale="en" t={text} />)
    fireEvent.click(await screen.findByRole('button', { name: en.edit }))
    fireEvent.click(screen.getByRole('tab', { name: en.editorHistory, exact: true }))
    const jump = () => {
      fireEvent.click(screen.getByRole('button', { name: en.runActions }))
      fireEvent.click(screen.getByRole('menuitem', { name: en.jumpToSession }))
    }
    jump(); await screen.findByText(en.storageFailure)
    expect(services.openSession).not.toHaveBeenCalled()
    jump(); await screen.findByText(en.openFailed)
    expect((await ctx.automation.list()).tasks[0]!.runs[0]!.viewedAt).toBeTypeOf('number')
    jump(); await waitFor(() => expect(services.openSession).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(en.openFailed)).toBeNull())
    expect(services.openSession).toHaveBeenLastCalledWith('existing-result', expect.stringContaining(' - Round trip'), expect.any(AbortSignal))
    expect(markViewed).toHaveBeenCalledTimes(2)
    expect(services.askAssistant).not.toHaveBeenCalled()
  })

  it('requires confirmation before migration and keeps an interrupted migration available for retry', async () => {
    const { ctx, services } = await harness()
    ctx.automation.migrationStatus = () => ({ phase: 'interrupted', pending: 2, pausedOverdue: [] })
    services.migrateNative = vi.fn(async () => {
      ctx.automation.migrationStatus = () => ({ phase: 'complete', pending: 0, pausedOverdue: ['overdue'] })
      return ctx.automation.list()
    })
    render(<AutomationPage services={services} locale="en" t={text} />)
    await screen.findByText(en.migrationInterrupted)
    fireEvent.click(screen.getByRole('button', { name: en.migrateNative }))
    expect(services.migrateNative).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.cancel }))
    expect(services.migrateNative).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.migrateNative }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.migrateNative }))
    await screen.findByText(en.migrationOverdue)
    expect(services.migrateNative).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('registers through real DSH slots and locale services and releases entries, styles and page timers', async () => {
    const { ctx, services, projects } = await harness()
    const slots = new SlotRegistry(ctx)
    const locale = new LocaleRuntime(ctx); ctx.provide('locale', locale)
    const snapshot = { items: projects.map(item => ({ workspaceId: item.id, title: item.name, path: item.path })) }
    ctx.provide('workspaces', { list: { getSnapshot: () => snapshot, subscribe: () => () => {} } })
    ctx.provide('sessions', { refresh: vi.fn(async () => {}), list: { getSnapshot: () => ({ ids: [], projectionsBySession: {} }), subscribe: () => () => {} } })
    ctx.provide('uiWorkspace', { startSession: services.askAssistant, openSession: services.openSession, registerSessionGroup: () => () => {} })
    slots.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } } }, () => null)
    const plugin = await ctx.plugin({ inject: ['automation', 'slots', 'locale', 'workspaces', 'uiWorkspace'], apply: registerAutomationUi })
    const entry = slots.entries('main').find(entry => entry.options.key === 'schedules')!
    expect(entry.options.priority).toBe(-20)
    expect(slots.entries('sidebar.panellist')).toHaveLength(1)
    expect(locale.bind('tpcowork.automation')('title')).toBeTruthy()
    const Page = entry.component as React.ComponentType
    const view = render(<Page />)
    await screen.findByText(locale.bind('tpcowork.automation')('empty'))
    expect(document.querySelector('style[data-plugin="@tpcowork/dsh-automation"]')).not.toBeNull()
    view.unmount()
    await plugin.dispose()
    expect(slots.entries('main')).toEqual([])
    expect(slots.entries('sidebar.panellist')).toEqual([])
    expect(document.querySelector('style[data-plugin="@tpcowork/dsh-automation"]')).toBeNull()
  })
  it.each(['zh', 'en'])('all six %s templates fill a draft and cancel without creating a task', async locale => {
    const { ctx, services } = await harness()
    const copy = locale === 'zh' ? zh : en
    render(<AutomationPage services={services} locale={locale} t={key => copy[key]} />)
    await screen.findByText(copy.empty)
    for (const template of getAutomationTemplates(locale)) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(template.draft.name) }))
      expect(screen.getByLabelText(copy.name)).toHaveProperty('value', template.draft.name)
      expect(screen.getByLabelText(copy.prompt)).toHaveProperty('value', template.draft.prompt)
      expect(screen.getByLabelText(copy.frequency)).toHaveProperty('value', template.draft.schedule.frequency)
      expect((await ctx.automation.list()).tasks).toEqual([])
      fireEvent.click(screen.getByRole('button', { name: copy.title, exact: true }))
    }
    fireEvent.click(screen.getByRole('button', { name: copy.ask }))
    expect(services.askAssistant).toHaveBeenCalledWith(copy.askPrompt)
  })

  it('new task defaults to once and only saving creates a Host definition', async () => {
    const { ctx, services } = await harness()
    render(<AutomationPage services={services} locale="en" t={text} />)
    await screen.findByText(en.empty)
    fireEvent.click(screen.getByRole('button', { name: en.new }))
    expect(screen.queryByLabelText(en.timezone)).toBeNull()
    input(en.name, 'First task'); input(en.prompt, 'First instructions')
    expect(screen.getByRole('button', { name: en.createTask })).toHaveProperty('disabled', true)
    await addSchedule()
    fireEvent.click(screen.getByRole('button', { name: en.createTask }))
    await screen.findByRole('heading', { name: 'First task' })
    const task = (await ctx.automation.list()).tasks[0]!
    expect(task.schedule.frequency).toBe('once')
    expect(task.mcpPresets).toEqual([])
  })

  it('reports an invalid rule without discarding the draft or reporting a successful save', async () => {
    const { ctx, services } = await harness()
    render(<AutomationPage services={services} locale="en" t={text} />)
    await screen.findByText(en.empty)
    fireEvent.click(screen.getByRole('button', { name: en.new }))
    await addSchedule()
    input(en.name, 'Invalid timing'); input(en.prompt, 'Keep this prompt')
    input(en.frequency, 'custom'); input(en.cronExpression, 'invalid cron')
    fireEvent.click(screen.getByRole('button', { name: en.createTask }))
    await screen.findByText(en.invalidRule)
    expect(screen.getByLabelText(en.prompt)).toHaveProperty('value', 'Keep this prompt')
    expect((await ctx.automation.list()).tasks).toEqual([])
  })

  it.each<ScheduleConfig>([
    { frequency: 'once', at: '2031-03-04T12:34:56.000Z', timezone: 'Asia/Shanghai' },
    { frequency: 'monthly', dayOfMonth: 31, time: { hour: 23, minute: 59 }, timezone: 'America/New_York' },
    { frequency: 'manual', timezone: 'UTC' },
    { frequency: 'custom', cronExpression: '0 9 * * * 30 2031', timezone: 'UTC' },
    { frequency: 'custom', everyMs: 123456, time: { hour: 3, minute: 2 }, timezone: 'UTC' },
  ])('persists and reloads $frequency without rewriting timing or missing bindings', async schedule => {
    const { ctx, services, projects } = await harness()
    const created = (await ctx.automation.create({ ...draft(schedule), description: 'Saved description', executionMode: 'reminder', skillName: 'missing-skill', mcpPresets: [{ name: 'missing', display_name: 'Original' }], projectId: WorkspaceId('missing-project'), workspacePath: '/original' })).tasks[0]!
    const { name, description, executionMode, prompt, skillName, mcpPresets, projectId, workspacePath } = created
    render(<AutomationEditor editing initial={{ name, description, executionMode, prompt, skillName, mcpPresets, projectId, workspacePath, schedule: created.schedule }} services={services} projects={projects} t={text} pending={false} close={() => {}} save={async data => { await ctx.automation.update({ id: created.id, data }); return true }} />)
    expect(screen.queryByText('More settings')).toBeNull()
    for (const label of [en.description, en.mode, en.directory, en.skill]) expect(screen.queryByLabelText(label)).toBeNull()
    expect(services.bindings).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.selectProject }))
    expect(screen.getByRole('menuitem', { name: /Unavailable binding · missing-project/ })).toHaveProperty('disabled', true)
    fireEvent.keyDown(document, { key: 'Escape' })
    input(en.name, 'Renamed')
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(async () => expect((await ctx.automation.list()).tasks[0]!.name).toBe('Renamed'))
    expect((await ctx.automation.list()).tasks[0]).toMatchObject({ schedule, description, executionMode, skillName: 'missing-skill', mcpPresets: [{ name: 'missing', display_name: 'Original' }], projectId: 'missing-project', workspacePath: '/original' })
  })

  it('selects projects through the homepage menu and preserves saved skills and connections', async () => {
    const { ctx, services } = await harness()
    await ctx.automation.create({ ...draft({ frequency: 'manual' }), skillName: 'report', mcpPresets: [{ name: 'docs' }] })
    render(<AutomationPage services={services} locale="en" t={text} />)
    fireEvent.click(await screen.findByRole('button', { name: en.edit }))
    const trigger = screen.getByRole('button', { name: en.selectProject })
    expect(trigger.closest('.tp-auto-project-row')).not.toBeNull()
    expect(trigger.closest('.tp-auto-instructions-toolbar')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    pickProject('Beta')
    expect(trigger.textContent).toBe('Beta')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByRole('heading', { name: 'Round trip' })
    expect((await ctx.automation.list()).tasks[0]).toMatchObject({ projectId: 'beta', workspacePath: '/project/beta', skillName: 'report', mcpPresets: [{ name: 'docs' }] })
    cleanup()
    render(<AutomationPage services={services} locale="en" t={text} />)
    fireEvent.click(await screen.findByRole('button', { name: en.edit }))
    expect(screen.getByRole('button', { name: en.selectProject }).textContent).toBe('Beta')
    pickProject('Alpha')
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByRole('heading', { name: 'Round trip' })
    expect((await ctx.automation.list()).tasks[0]).toMatchObject({ projectId: 'alpha', workspacePath: '/project/alpha', skillName: 'report', mcpPresets: [{ name: 'docs' }] })
  })

  it('sends an explicit project clear through JSON and reloads with the independent directory intact', async () => {
    const { ctx, services } = await harness()
    await ctx.automation.create({ ...draft({ frequency: 'manual' }), projectId: WorkspaceId('beta'), workspacePath: '/explicit/override' })
    const hostUpdate = ctx.automation.update.bind(ctx.automation)
    const update = vi.spyOn(ctx.automation, 'update').mockImplementation(request => hostUpdate(JSON.parse(JSON.stringify(request))))
    render(<AutomationPage services={services} locale="en" t={text} />)
    fireEvent.click(await screen.findByRole('button', { name: en.edit }))
    pickProject(en.noProject)
    expect(screen.getByRole('button', { name: en.selectProject }).textContent).toBe(en.selectProject)
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByRole('heading', { name: 'Round trip' })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ projectId: null }) }))
    expect((await ctx.automation.list()).tasks[0]!.projectId).toBeUndefined()
    expect((await ctx.automation.list()).tasks[0]!.workspacePath).toBe('/explicit/override')
    cleanup()
    render(<AutomationPage services={services} locale="en" t={text} />)
    fireEvent.click(await screen.findByRole('button', { name: en.edit }))
    expect(screen.getByRole('button', { name: en.selectProject }).textContent).toBe(en.selectProject)
    expect((await ctx.automation.list()).tasks[0]!.workspacePath).toBe('/explicit/override')
  })

  it('keeps unsaved input during polling, execution option retries and a failed save', async () => {
    const { ctx, services } = await harness()
    await ctx.automation.create(draft({ frequency: 'manual' }))
    services.executionOptions = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({})
    const view = render(<AutomationPage services={services} locale="en" t={text} />)
    fireEvent.click(await screen.findByRole('button', { name: en.edit }))
    input(en.name, 'Unsaved input')
    await screen.findByText(en.executionOptionsError)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => expect(services.executionOptions).toHaveBeenCalledTimes(2))
    expect(services.bindings).not.toHaveBeenCalled()
    const remoteTask = (await ctx.automation.list()).tasks[0]!
    await ctx.automation.update({ id: remoteTask.id, data: { ...draft({ frequency: 'manual' }), name: 'Remote change' } })
    vi.useFakeTimers()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.getByLabelText(en.name)).toHaveProperty('value', 'Unsaved input')
    vi.useRealTimers()
    const update = vi.spyOn(ctx.automation, 'update').mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.error)
    expect(screen.getByLabelText(en.name)).toHaveProperty('value', 'Unsaved input')
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByRole('heading', { name: 'Unsaved input' })
    expect(update).toHaveBeenCalledTimes(2)
    vi.useFakeTimers(); view.unmount(); expect(vi.getTimerCount()).toBe(0)
  })

  it('retains history for archived once tasks and keeps failed/unread/recurring tasks visible', async () => {
    const { ctx, services } = await harness()
    for (const [name, frequency, outcome, viewed] of [
      ['archived', 'once', 'completed', true], ['unread', 'once', 'completed', false], ['failed', 'once', 'error', true], ['recurring', 'daily', 'completed', true],
    ] as const) {
      const task = (await ctx.automation.create({ name, prompt: name, schedule: frequency === 'once' ? { frequency, at: '2031-01-01T00:00:00Z' } : { frequency } })).tasks.find(task => task.name === name)!
      const run = await ctx.automation.beginRun({ taskId: task.id, trigger: 'manual' })
      await ctx.automation.bindRun({ taskId: task.id, runId: run.id, sessionId: `session-${name}`, ownsSession: true, conversationAvailable: true })
      await ctx.automation.finishRun({ taskId: task.id, runId: run.id, status: outcome, resultType: 'conversation', conversationAvailable: true })
      if (viewed) await ctx.automation.markRunViewed({ taskId: task.id, runId: run.id })
    }
    render(<AutomationPage services={services} locale="en" t={text} />)
    await screen.findByRole('heading', { name: 'recurring' })
    expect(screen.queryByRole('heading', { name: 'archived' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'unread' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'failed' })).toBeDefined()
    fireEvent.click(screen.getByRole('tab', { name: /Run history/ }))
    expect(screen.getByText('archived', { selector: '.tp-auto-history-task > span' })).toBeDefined()
    const unreadCard = screen.getByText('unread', { selector: '.tp-auto-history-task > span' }).closest('tr')!
    fireEvent.click(within(unreadCard).getByRole('button', { name: en.jumpToSession }))
    await waitFor(() => expect(services.openSession).toHaveBeenCalledWith('session-unread', expect.stringContaining(' - unread'), expect.any(AbortSignal)))
  })

  it('retries a catalog failure and never opens a conversation inferred only from a Session ID', async () => {
    const { ctx, services } = await harness()
    await ctx.automation.create(draft({ frequency: 'manual' }))
    const task = (await ctx.automation.list()).tasks[0]!
    const run = await ctx.automation.beginRun({ taskId: task.id, trigger: 'manual' })
    await ctx.automation.bindRun({ taskId: task.id, runId: run.id, sessionId: 'allocated-but-not-queryable', ownsSession: true })
    await ctx.automation.finishRun({ taskId: task.id, runId: run.id, status: 'error', resultType: 'none', conversationAvailable: false })
    vi.spyOn(ctx.automation, 'list').mockRejectedValueOnce(new Error('offline'))
    render(<AutomationPage services={services} locale="en" t={text} />)
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await screen.findByRole('heading', { name: 'Round trip' })
    fireEvent.click(screen.getByRole('tab', { name: /Run history/ }))
    expect(screen.queryByRole('button', { name: en.jumpToSession })).toBeNull()
    expect(services.openSession).not.toHaveBeenCalled()
    cleanup()
    const running = await ctx.automation.beginRun({ taskId: task.id, trigger: 'manual' })
    await ctx.automation.bindRun({ taskId: task.id, runId: running.id, sessionId: 'queryable-running', ownsSession: true, conversationAvailable: true })
    render(<AutomationPage services={services} locale="en" t={text} />)
    await screen.findByRole('heading', { name: 'Round trip' })
    fireEvent.click(screen.getByRole('tab', { name: /Run history/ }))
    fireEvent.click(screen.getAllByRole('button', { name: en.jumpToSession })[0]!)
    await waitFor(() => expect(services.openSession).toHaveBeenCalledWith('queryable-running', expect.stringContaining(' - Round trip'), expect.any(AbortSignal)))
    expect((await ctx.automation.list()).tasks[0]!.runs[0]!.viewedAt).toBeUndefined()
  })

  it('opens the precise unread run from its task card without acknowledging a reminder', async () => {
    const { ctx, services } = await harness()
    const task = (await ctx.automation.create({ ...draft({ frequency: 'manual' }), executionMode: 'reminder' })).tasks[0]!
    const run = await ctx.automation.beginRun({ taskId: task.id, trigger: 'manual' })
    await ctx.automation.finishRun({ taskId: task.id, runId: run.id, status: 'completed', resultType: 'none', conversationAvailable: false })
    render(<AutomationPage services={services} locale="en" t={text} />)
    const card = (await screen.findByRole('heading', { name: task.name })).closest('article')!
    fireEvent.click(within(card).getByRole('button', { name: /Unread 1/ }))
    const detail = document.querySelector('tr[data-target=true]') as HTMLElement
    expect(detail.getAttribute('data-run-id')).toBe(run.id)
    expect(screen.getByRole('tab', { name: /Run history/ }).getAttribute('aria-selected')).toBe('true')
    expect((await ctx.automation.list()).tasks[0]!.runs[0]!.viewedAt).toBeUndefined()
    expect(services.openSession).not.toHaveBeenCalled()
    fireEvent.click(within(detail).getByRole('button', { name: en.confirmReminder }))
    await waitFor(async () => expect((await ctx.automation.list()).tasks[0]!.runs[0]!.viewedAt).toBeTypeOf('number'))
  })
})

describe('catalog request lifetimes and date fields', () => {
  it('drops a poll that resolves after a mutation and drops late work after disposal', async () => {
    const { services } = await harness()
    let resolve!: (value: ScheduleTasksPayload) => void
    services.automation.list = () => new Promise(done => { resolve = done })
    const catalog = new AutomationCatalog(services.automation)
    const listener = vi.fn(); catalog.subscribe(listener)
    const read = catalog.refresh()
    await catalog.refresh() // A second timer tick joins the pending read instead of starving it.
    const fresh = { ...empty, status: { ...empty.status, jobs: 2 } }
    await catalog.mutate(async () => fresh)
    resolve(empty); await read
    expect(catalog.getSnapshot().catalog).toEqual(fresh)
    const later = catalog.refresh(); catalog.dispose(); const count = listener.mock.calls.length
    resolve(empty); await later
    expect(listener).toHaveBeenCalledTimes(count)
  })
  it('uses the latest run when the transport array is not sorted', async () => {
    const { ctx } = await harness()
    const task = (await ctx.automation.create(draft({ frequency: 'once', at: '2031-01-01T00:00:00Z' }))).tasks[0]!
    const older = { status: 'completed', viewedAt: 1, startedAt: 1 }
    const latest = { status: 'error', viewedAt: 3, startedAt: 2 }
    expect(isArchivedOneTimeTask({ ...task, status: 'completed', runs: [older, latest] as typeof task.runs })).toBe(false)
  })
  it('converts selected timezone wall time, rejects a DST gap and preserves the once default', () => {
    expect(newDraft().schedule.frequency).toBe('once')
    expect(wallTime('2031-01-01T00:00:00Z', 'Asia/Shanghai')).toBe('2031-01-01T08:00')
    expect(wallTimeInstant('2031-01-01T08:00', 'Asia/Shanghai')).toBe('2031-01-01T00:00:00.000Z')
    expect(() => wallTimeInstant('2026-03-08T02:30', 'America/New_York')).toThrow()
    expect(wallTimeInstant('2026-10-25T02:30', 'Europe/Berlin')).toBe('2026-10-25T00:30:00.000Z')
  })
})
