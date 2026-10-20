import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../deepseek-harness/packages/storage/storage-domain/tests/helpers/memory-backend.ts'
import { AutomationService } from '../src/host.ts'
import { descriptors } from '../src/remote.ts'
import { scheduleSchema, taskSchema, createSchema, updateSchema } from '../src/schemas.ts'
import { parseInput } from '../src/errors.ts'
import type { AutomationTaskId, ScheduleTaskDraft, AutomationRuntime, ScheduleConfig } from '../src/types.ts'

const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
  vi.restoreAllMocks()
})
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'tpcowork-automation-'))
  directories.push(root)
  return root
}
async function harness(root?: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(TypertRegistry)
  const pool = new MemoryMediaPool()
  const backend = root ? new JsonStorageBackend(root) : new MemoryStorageBackend(pool)
  ctx.effect(() => ctx.storage.backend.register('fixture', backend))
  const facility = new DomainFacility(ctx, { backend: 'fixture' })
  ctx.provide('storageDomain', facility)
  ctx.effect(() => async () => { await facility.closeAll(); await backend.close() })
  const fiber = await ctx.plugin(AutomationService)
  return { ctx, service: ctx.automation, fiber, pool }
}
const draft = (schedule: ScheduleConfig = { frequency: 'manual' }): ScheduleTaskDraft => ({
  name: '报告', description: '生成报告', prompt: '分析项目并输出报告', schedule,
})
async function create(service: AutomationService, data = draft()) {
  return (await service.create(data)).tasks[0]!
}
async function complete(service: AutomationService, taskId: AutomationTaskId) {
  const run = await service.beginRun({ taskId, trigger: 'manual' })
  await service.finishRun({ taskId, runId: run.id, status: 'completed', resultType: 'none', conversationAvailable: false })
  return run
}

describe('durable automation service', () => {
  it('preserves omitted execution choices and clears explicit JSON null across a storage reopen', async () => {
    const root = await directory()
    const first = await harness(root)
    const choices = { modelSelection: { provider: 'custom', model: 'reasoner', reasoningEffort: 'high' }, permissionPreset: 'workspace-write' }
    const task = await create(first.service, { ...draft(), ...choices })
    await first.service.update(JSON.parse(JSON.stringify({ id: task.id, data: { ...draft(), name: 'Renamed' } })))
    expect((await first.service.list()).tasks[0]).toMatchObject(choices)
    await first.fiber.dispose()
    const second = await harness(root)
    expect((await second.service.list()).tasks[0]).toMatchObject(choices)
    await second.service.update(JSON.parse(JSON.stringify({ id: task.id, data: { ...draft(), modelSelection: null, permissionPreset: null } })))
    const saved = JSON.parse(await readFile(join(root, 'tpcowork_automation.json'), 'utf8')).tables.tasks[task.id]
    expect(saved).not.toHaveProperty('modelSelection')
    expect(saved).not.toHaveProperty('permissionPreset')
    await second.fiber.dispose()
    const third = await harness(root)
    expect((await third.service.list()).tasks[0]!.modelSelection).toBeUndefined()
    expect((await third.service.list()).tasks[0]!.permissionPreset).toBeUndefined()
  })

  it('is discoverable with all nine endpoints and preserves tasks/read state on unload and restart', async () => {
    const root = await directory()
    const first = await harness(root)
    expect(first.ctx.automation.name).toBe('automation')
    expect(first.ctx.typert.local.list().filter(value => value.namespace === 'automation').map(value => value.method)).toEqual(descriptors.map(value => value.method))
    expect(first.ctx.typert.local.list().find(value => value.namespace === 'automationChanges')).toMatchObject({ method: 'watch', mode: 'stream' })
    const task = (await first.service.create({ ...draft(), projectId: WorkspaceId('project'), originSessionId: SessionId('creation'),
      workspacePath: '/workspace/report', skillName: 'report', mcpPresets: [{ name: 'docs', display_name: '文档' }],
    })).tasks[0]!
    const run = await complete(first.service, task.id)
    await first.service.markRunViewed({ taskId: task.id, runId: run.id })
    const saved = await first.service.list()
    const bytes = await readFile(join(root, 'tpcowork_automation.json'), 'utf8')
    await first.fiber.dispose()
    expect(first.ctx.typert.local.list()).toEqual([])
    expect(await readFile(join(root, 'tpcowork_automation.json'), 'utf8')).toBe(bytes)
    await expect(first.service.list()).rejects.toMatchObject({ code: 'automation/service_stopping' })
    const second = await harness(root)
    expect(await second.service.list()).toEqual(saved)
    expect(saved.tasks[0]).toMatchObject({ originSessionId: 'creation', projectId: 'project', runs: [{ viewedAt: expect.any(Number) }] })
  })

  it('supports the source defaults, manual pause and all frequency definitions without a scheduler timer', async () => {
    const { service } = await harness()
    const schedules: ScheduleConfig[] = [
      { frequency: 'once', at: new Date(Date.now() + 60_000).toISOString() }, { frequency: 'hourly' },
      { frequency: 'daily' }, { frequency: 'weekly' }, { frequency: 'monthly' }, { frequency: 'weekdays' },
      { frequency: 'custom', everyMs: 5000 }, { frequency: 'custom', cronExpression: '*/5 * * * MON-FRI' }, { frequency: 'manual' },
    ]
    for (const schedule of schedules) await create(service, draft(schedule))
    const catalog = await service.list()
    expect(catalog.tasks).toHaveLength(9)
    expect(catalog.status).toEqual({ enabled: false, jobs: 9, next_wake_at_ms: null })
    expect(catalog.tasks.find(task => task.schedule.frequency === 'weekly')?.schedule).toMatchObject({ dayOfWeek: 1, time: { hour: 9, minute: 0 } })
    expect(catalog.tasks.find(task => task.schedule.frequency === 'manual')?.status).toBe('paused')
    await expect(service.runNow({ id: catalog.tasks[0]!.id })).rejects.toMatchObject({ code: 'automation/runtime_unavailable' })
  })

  it('matches edit reactivation and removes an acknowledged one-time pure reminder', async () => {
    const { service } = await harness()
    const task = await create(service, draft({ frequency: 'daily' }))
    await service.pause({ id: task.id })
    expect((await service.list()).tasks[0]!.status).toBe('paused')
    await service.update({ id: task.id, data: draft({ frequency: 'daily' }) })
    expect((await service.list()).tasks[0]!.status).toBe('active')
    const reminder = (await service.create({ ...draft({ frequency: 'once', at: new Date(Date.now() + 60_000).toISOString() }), executionMode: 'reminder' })).tasks.find(value => value.executionMode === 'reminder')!
    const run = await complete(service, reminder.id)
    expect((await service.list()).tasks.find(value => value.id === reminder.id)!.status).toBe('completed')
    await service.markRunViewed({ taskId: reminder.id, runId: run.id })
    expect((await service.list()).tasks.some(value => value.id === reminder.id)).toBe(false)
  })

  it('keeps historical conversations when a task changes to reminder mode', async () => {
    const { service } = await harness()
    const task = await create(service)
    const run = await service.beginRun({ taskId: task.id, trigger: 'manual' })
    await service.bindRun({ taskId: task.id, runId: run.id, sessionId: SessionId('prior'), ownsSession: true })
    await service.finishRun({ taskId: task.id, runId: run.id, status: 'completed', resultType: 'conversation', conversationAvailable: true })
    await service.update({ id: task.id, data: { ...draft(), executionMode: 'reminder' } })
    expect((await service.list()).tasks[0]).toMatchObject({ executionMode: 'reminder', runs: [{ executionMode: 'agent', conversationAvailable: true }] })
  })

  it('prevents a replacement runtime from starting before old teardown has reached quiescence', async () => {
    const { service } = await harness()
    let release!: () => void
    const stopping = new Promise<void>(resolve => { release = resolve })
    const runtime = { nextRunAt: () => undefined, runNow: async () => {}, dispose: () => stopping }
    const detach = service.attachRuntime(runtime)
    const pending = detach()
    expect(() => service.attachRuntime(runtime)).toThrow(expect.objectContaining({ code: 'automation/invalid_input' }))
    release()
    await pending
    const replacement = { ...runtime, dispose: async () => {} }
    const finish = service.attachRuntime(replacement)
    await finish()
  })

  it('updates bindings without changing creation Session and returns isolated snapshots', async () => {
    const { service } = await harness()
    const task = (await service.create({ ...draft(), originSessionId: SessionId('creation'), skillName: 'original' })).tasks[0]!
    const payload = await service.update({ id: task.id, data: { ...draft(), name: '更新', mcpPresets: [] } })
    expect(payload.tasks[0]).toMatchObject({ name: '更新', originSessionId: 'creation', skillName: '', mcpPresets: [] })
    payload.tasks[0]!.name = 'mutated externally'
    expect((await service.list()).tasks[0]!.name).toBe('更新')
    await service.delete({ id: task.id })
    expect((await service.list()).tasks).toEqual([])
  })

  it('preserves an omitted project and durably clears JSON null independently of the working directory', async () => {
    const root = await directory()
    const first = await harness(root)
    const data = { ...draft(), projectId: WorkspaceId('missing-project'), workspacePath: '/explicit/override' }
    const task = await create(first.service, data)
    const retained = await first.service.update(JSON.parse(JSON.stringify({ id: task.id, data: {
      ...draft(), name: 'Renamed', workspacePath: data.workspacePath,
    } })))
    expect(retained.tasks[0]).toMatchObject({ name: 'Renamed', projectId: 'missing-project', workspacePath: data.workspacePath })
    const cleared = await first.service.update(JSON.parse(JSON.stringify({ id: task.id, data: { ...data, projectId: null } })))
    expect(cleared.tasks[0]!.projectId).toBeUndefined()
    expect(cleared.tasks[0]!.workspacePath).toBe(data.workspacePath)
    const persisted = JSON.parse(await readFile(join(root, 'tpcowork_automation.json'), 'utf8'))
    expect(persisted.tables.tasks[task.id]).not.toHaveProperty('projectId')
    await first.fiber.dispose()
    const second = await harness(root)
    expect((await second.service.list()).tasks[0]).toMatchObject({ workspacePath: data.workspacePath })
    expect((await second.service.list()).tasks[0]!.projectId).toBeUndefined()
  })

  it('retains explicit undefined clearing for direct Host callers and accepts a replacement project', async () => {
    const { service } = await harness()
    const task = await create(service, { ...draft(), projectId: WorkspaceId('alpha') })
    const replaced = await service.update({ id: task.id, data: { ...draft(), projectId: WorkspaceId('beta') } })
    expect(replaced.tasks[0]!.projectId).toBe('beta')
    const cleared = await service.update({ id: task.id, data: { ...draft(), projectId: undefined } })
    expect(cleared.tasks[0]!.projectId).toBeUndefined()
  })

  it('persists before notifying and leaves reads/notifications unchanged after a failed write', async () => {
    const { service, pool, ctx } = await harness()
    const changed = vi.fn()
    ctx.on('automation/changed', changed)
    const task = await create(service)
    const before = await service.list()
    pool.failNextWrites = 1
    await expect(service.update({ id: task.id, data: { ...draft(), name: '未保存' } })).rejects.toMatchObject({ code: 'automation/storage_failure' })
    expect(await service.list()).toEqual(before)
    expect(changed).toHaveBeenCalledTimes(1)
    await service.update({ id: task.id, data: { ...draft(), name: '保存成功' } })
    expect(changed).toHaveBeenCalledTimes(2)
    pool.failNextWrites = 1
    await expect(service.delete({ id: task.id })).rejects.toMatchObject({ code: 'automation/storage_failure' })
    expect((await service.list()).tasks[0]!.name).toBe('保存成功')
  })

  it('contains a throwing notification listener and still delivers to the next listener', async () => {
    const { service, ctx } = await harness()
    vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.on('automation/changed', () => { throw new Error('observer') })
    const observer = vi.fn()
    ctx.on('automation/changed', observer)
    await create(service)
    expect(observer).toHaveBeenCalledTimes(1)
    expect((await service.list()).tasks).toHaveLength(1)
  })

  it('persists admission once, guards running deletes, and returns runNow before settlement', async () => {
    const { service, ctx } = await harness()
    const task = await create(service)
    const dispose = vi.fn(async () => {})
    const runtime: AutomationRuntime = {
      nextRunAt: (_rule, now) => now + 60_000,
      runNow: async id => { await service.beginRun({ taskId: id, trigger: 'manual' }) }, dispose,
    }
    ctx.effect(() => service.attachRuntime(runtime))
    const result = await service.runNow({ id: task.id })
    const run = result.tasks[0]!.runs[0]!
    expect(run.status).toBe('running')
    await expect(service.runNow({ id: task.id })).rejects.toMatchObject({ code: 'automation/task_running' })
    await expect(service.delete({ id: task.id })).rejects.toMatchObject({ code: 'automation/task_running' })
    await expect(service.deleteRun({ taskId: task.id, runId: run.id })).rejects.toMatchObject({ code: 'automation/run_running' })
    await expect(service.markRunViewed({ taskId: task.id, runId: run.id })).rejects.toMatchObject({ code: 'automation/run_running' })
    await service.finishRun({ taskId: task.id, runId: run.id, status: 'skipped', skippedReason: 'permission denied', resultType: 'none', conversationAvailable: false })
    expect((await service.list()).tasks[0]!.runs[0]).toMatchObject({ status: 'completed', skippedReason: 'permission denied', conversationAvailable: false })
    await ctx.fiber.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('serializes competing admissions and retains only the newest 20 records', async () => {
    const { service } = await harness()
    const task = await create(service)
    const admitted = await Promise.allSettled([
      service.beginRun({ taskId: task.id, trigger: 'manual' }), service.beginRun({ taskId: task.id, trigger: 'manual' }),
    ])
    expect(admitted.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    const first = (await service.list()).tasks[0]!.runs[0]!
    await service.finishRun({ taskId: task.id, runId: first.id, status: 'error', error: 'failed', resultType: 'none', conversationAvailable: false })
    for (let index = 0; index < 21; index++) await complete(service, task.id)
    const stored = (await service.list()).tasks[0]!
    expect(stored.runs).toHaveLength(20)
    expect(stored.totalRuns).toBe(20)
    expect(stored.runs.some(run => run.id === first.id)).toBe(false)
  })

  it('links Session/Turn explicitly, retains unread unavailable results and preserves viewedAt monotonically', async () => {
    const { service } = await harness()
    const task = (await service.create({ ...draft(), originSessionId: SessionId('creation') })).tasks[0]!
    const run = await service.beginRun({ taskId: task.id, trigger: 'manual' })
    await expect(service.bindRun({ taskId: task.id, runId: run.id, sessionId: SessionId('creation'), ownsSession: true })).rejects.toMatchObject({ code: 'automation/invalid_input' })
    await service.bindRun({ taskId: task.id, runId: run.id, sessionId: SessionId('independent'), turnId: 3, ownsSession: true })
    expect((await service.list()).tasks[0]!.runs[0]).toMatchObject({ sessionId: 'independent', turnId: 3, resultType: 'none', conversationAvailable: false })
    await service.finishRun({ taskId: task.id, runId: run.id, status: 'completed', resultType: 'conversation', conversationAvailable: true })
    await service.markRunViewed({ taskId: task.id, runId: run.id })
    const before = (await service.list()).tasks[0]!.runs[0]!
    expect(before).toMatchObject({ conversationId: 'independent', conversationAvailable: true })
    await service.markRunViewed({ taskId: task.id, runId: run.id })
    await service.finishRun({ taskId: task.id, runId: run.id, status: 'error', resultType: 'none', conversationAvailable: false })
    expect((await service.list()).tasks[0]!.runs[0]).toEqual(before)
  })

  it('does not claim a conversation solely from SessionId and refuses inconsistent availability', async () => {
    const { service } = await harness()
    const task = await create(service)
    const run = await service.beginRun({ taskId: task.id, trigger: 'manual' })
    await expect(service.finishRun({ taskId: task.id, runId: run.id, status: 'completed', resultType: 'conversation', conversationAvailable: true })).rejects.toMatchObject({ code: 'automation/invalid_persistence' })
    expect((await service.list()).tasks[0]!.runs[0]!.status).toBe('running')
    await service.bindRun({ taskId: task.id, runId: run.id, sessionId: SessionId('linked'), ownsSession: false })
    await service.finishRun({ taskId: task.id, runId: run.id, status: 'completed', resultType: 'none', conversationAvailable: false, unavailableReason: 'missing' })
    expect((await service.list()).tasks[0]!.runs[0]).toMatchObject({ sessionId: 'linked', resultType: 'none', conversationAvailable: false, unavailableReason: 'missing' })
  })

  it('publishes running conversations only through explicit durable binding and rejects changing the owned Turn', async () => {
    const { service, pool } = await harness()
    const task = await create(service)
    const run = await service.beginRun({ taskId: task.id, trigger: 'manual' })
    const binding = { taskId: task.id, runId: run.id, sessionId: SessionId('live'), turnId: 1, ownsSession: true }
    await service.bindRun(binding)
    pool.failNextWrites = 1
    await expect(service.bindRun({ ...binding, conversationAvailable: true })).rejects.toMatchObject({ code: 'automation/storage_failure' })
    expect((await service.list()).tasks[0]!.runs[0]).toMatchObject({ resultType: 'none', conversationAvailable: false })
    await service.bindRun({ ...binding, conversationAvailable: true })
    expect((await service.list()).tasks[0]!.runs[0]).toMatchObject({ status: 'running', resultType: 'conversation',
      conversationAvailable: true, sessionId: 'live', sessionKey: 'live', conversationId: 'live', turnId: 1 })
    await expect(service.bindRun({ ...binding, turnId: 2 })).rejects.toMatchObject({ code: 'automation/invalid_input' })
    const reminder = await create(service, { ...draft(), executionMode: 'reminder' })
    const reminderRun = await service.beginRun({ taskId: reminder.id, trigger: 'manual' })
    await expect(service.bindRun({ taskId: reminder.id, runId: reminderRun.id, sessionId: SessionId('reminder'),
      ownsSession: true, conversationAvailable: true })).rejects.toMatchObject({ code: 'automation/invalid_input' })
  })

  it('deletes unowned runs locally and retains owned history until idempotent Session cleanup succeeds', async () => {
    const { service, ctx } = await harness()
    const task = await create(service)
    const local = await complete(service, task.id)
    await service.deleteRun({ taskId: task.id, runId: local.id })
    const run = await service.beginRun({ taskId: task.id, trigger: 'manual' })
    await service.bindRun({ taskId: task.id, runId: run.id, sessionId: SessionId('dedicated'), ownsSession: true })
    await service.finishRun({ taskId: task.id, runId: run.id, status: 'completed', resultType: 'conversation', conversationAvailable: true })
    await expect(service.deleteRun({ taskId: task.id, runId: run.id })).rejects.toMatchObject({ code: 'automation/runtime_unavailable' })
    const deleteRunSession = vi.fn().mockRejectedValueOnce(new Error('cleanup failed')).mockResolvedValue(undefined)
    ctx.effect(() => service.attachSessionCleanup({ deleteRunSession }))
    await expect(service.deleteRun({ taskId: task.id, runId: run.id })).rejects.toMatchObject({ code: 'automation/session_cleanup_failed' })
    expect((await service.list()).tasks[0]!.runs).toHaveLength(1)
    await service.deleteRun({ taskId: task.id, runId: run.id })
    const remaining = (await service.list()).tasks[0]!
    expect(remaining).toMatchObject({ runs: [], totalRuns: 0 })
    expect(remaining.lastRunAt).toBeUndefined()
  })

  it('waits for cleanup teardown before replacement and closes storage even when cleanup disposal fails', async () => {
    const root = await directory()
    const { service, fiber } = await harness(root)
    const task = await create(service)
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const detach = service.attachSessionCleanup({ deleteRunSession: async () => {}, dispose: () => barrier })
    const closing = detach()
    expect(() => service.attachSessionCleanup({ deleteRunSession: async () => {} })).toThrow()
    release()
    await closing
    service.attachSessionCleanup({ deleteRunSession: async () => {}, dispose: async () => { throw new Error('cleanup teardown failed') } })
    await fiber.dispose()
    const next = await harness(root)
    expect((await next.service.list()).tasks[0]!.id).toBe(task.id)
  })

  it('preserves in-flight read mutations on unload and closes the store even when runtime disposal rejects', async () => {
    const root = await directory()
    const first = await harness(root)
    const task = await create(first.service)
    const run = await complete(first.service, task.id)
    first.service.attachRuntime({ nextRunAt: () => undefined, runNow: async () => {}, dispose: async () => { throw new Error('teardown') } })
    const mutation = first.service.markRunViewed({ taskId: task.id, runId: run.id })
    await first.fiber.dispose()
    await mutation
    const second = await harness(root)
    expect((await second.service.list()).tasks[0]!.runs[0]!.viewedAt).toBeDefined()
  })
})

describe('parser and corrupt-medium refusal', () => {
  it('accepts the null project clear marker only in update requests', () => {
    const request = { id: 'task', data: { ...draft(), projectId: null } }
    expect(updateSchema.parse(request).data.projectId).toBeNull()
    expect(createSchema.safeParse(request.data).success).toBe(false)
    for (const projectId of ['', 42, false, {}]) {
      expect(updateSchema.safeParse({ ...request, data: { ...draft(), projectId } }).success).toBe(false)
    }
    expect(taskSchema.safeParse({ ...draft(), projectId: null, id: 'task', executionMode: 'agent',
      status: 'paused', createdAt: 0, updatedAt: 0, runs: [], totalRuns: 0 }).success).toBe(false)
  })

  it.each([
    { frequency: 'daily', timezone: 'Not/AZone' }, { frequency: 'weekly', dayOfWeek: 7 },
    { frequency: 'monthly', dayOfMonth: 0 }, { frequency: 'daily', time: { hour: 24, minute: 1 } },
    { frequency: 'custom', everyMs: -1 }, { frequency: 'custom', cronExpression: '99 * * * *' },
    { frequency: 'custom', cronExpression: 'nonsense' }, { frequency: 'custom', everyMs: 1000, cronExpression: '* * * * *' },
    { frequency: 'once' }, { frequency: 'daily', at: '2027-01-01T00:00:00Z' },
  ])('rejects invalid timing input %j', (schedule) => {
    expect(scheduleSchema.safeParse(schedule).success).toBe(false)
  })

  it('returns typed input errors from shared schemas and rejects raw credential fields', () => {
    expect(() => parseInput(createSchema, { ...draft(), schedule: { frequency: 'daily', timezone: 'Not/AZone' } })).toThrow(expect.objectContaining({ code: 'automation/invalid_timezone' }))
    expect(() => parseInput(createSchema, { ...draft(), apiKey: 'must-not-save' })).toThrow(expect.objectContaining({ code: 'automation/invalid_input' }))
  })

  it.each(['{broken', '{}', '[]', JSON.stringify({ unit: { name: 'tpcowork_automation', version: 9 }, global: null, tables: { tasks: {} } })])('never overwrites unreadable storage (%s)', async (bytes) => {
    const root = await directory()
    const path = join(root, 'tpcowork_automation.json')
    await writeFile(path, bytes)
    await expect(harness(root)).rejects.toMatchObject({ code: 'automation/invalid_persistence' })
    expect(await readFile(path, 'utf8')).toBe(bytes)
  })

  it.each(['key', 'status', 'unknown', 'run-owner', 'result', 'duplicate'])('refuses corrupted %s rows without dropping or rewriting them', async (corruption) => {
    const root = await directory()
    const first = await harness(root)
    const task = await create(first.service)
    await complete(first.service, task.id)
    await first.ctx.fiber.dispose()
    const path = join(root, 'tpcowork_automation.json')
    const document = JSON.parse(await readFile(path, 'utf8'))
    const stored = document.tables.tasks[task.id]
    if (corruption === 'key') { document.tables.tasks.foreign = stored; delete document.tables.tasks[task.id] }
    if (corruption === 'status') stored.status = 'bogus'
    if (corruption === 'unknown') stored.credentials = { token: 'reject' }
    if (corruption === 'run-owner') stored.runs[0].scheduledTaskId = 'another-task'
    if (corruption === 'result') stored.runs[0].conversationAvailable = true
    if (corruption === 'duplicate') { stored.runs.push(stored.runs[0]); stored.totalRuns = 2 }
    const bytes = JSON.stringify(document)
    await writeFile(path, bytes)
    await expect(harness(root)).rejects.toMatchObject({ code: 'automation/invalid_persistence' })
    expect(await readFile(path, 'utf8')).toBe(bytes)
  })

  it('validates stored fields on writes as well as reopening', async () => {
    const { service } = await harness()
    const task = await create(service)
    expect(taskSchema.safeParse({ ...task, updatedAt: task.createdAt - 1 }).success).toBe(false)
    await expect(service.setNextRunAt(task.id, NaN)).rejects.toMatchObject({ code: 'automation/invalid_persistence' })
    expect((await service.list()).tasks[0]!.nextRunAt).toBeUndefined()
  })

  it('normalizes the source API timezone override without persisting a second authority', async () => {
    const { service } = await harness()
    const task = (await service.create({ ...draft({ frequency: 'daily', timezone: 'UTC' }), timezone: 'Asia/Shanghai' })).tasks[0]!
    expect(task.schedule.timezone).toBe('Asia/Shanghai')
    expect('timezone' in task).toBe(false)
    await service.update({ id: task.id, data: { ...draft({ frequency: 'daily' }), timezone: 'UTC' } })
    expect((await service.list()).tasks[0]!.schedule.timezone).toBe('UTC')
  })
})
