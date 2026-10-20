/** Loader composition and real domain/runtime ownership; only Session restoration is a controlled fixture. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { scheduleDomain, ScheduleId, createAtScheduleRecord, createEveryScheduleRecord } from '@deepseek-ai/dsh-schedule'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../deepseek-harness/packages/storage/storage-domain/tests/helpers/memory-backend.ts'
import { gatedScheduleBackend, agentFor } from '../../../../deepseek-harness/packages/schedule/schedule/tests/harness.ts'
import { AutomationService } from '../src/host.ts'
import { NativeScheduleTransfer, nativeAutomationId, nativeSchedule } from '../src/native-transfer.ts'
import { AutomationScheduler } from '../src/scheduler.ts'
import type { AutomationClock } from '../src/types.ts'

const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => { for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose(); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); vi.restoreAllMocks() })
const now = Date.now()
async function harness(options: { pool?: MemoryMediaPool; count?: number; failNative?: () => boolean } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Sessions)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(Storage)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(Loader)
  const pool = options.pool ?? new MemoryMediaPool()
  const backend = options.failNative ? gatedScheduleBackend(pool, { putRecord: async () => { if (options.failNative!()) throw new Error('write failed') } }) : new MemoryStorageBackend(pool)
  ctx.effect(() => ctx.storage.backend.register('test', backend))
  const facility = new DomainFacility(ctx, { backend: 'test' })
  ctx.provide('storageDomain', facility)
  ctx.effect(() => async () => { await facility.closeAll(); await backend.close() })
  ctx.provide('sessionPersistence', {} as never)
  const resolve = vi.fn<Context['sessionController']['resolveAgent']>(async () => { throw new Error('missing Session') })
  ctx.provide('sessionController', { resolveAgent: resolve } as never)
  ctx.on('session/flush', async () => {})
  if (options.count) {
    const native = await facility.open(scheduleDomain)
    for (let i = 0; i < options.count; i++) {
      const record = createEveryScheduleRecord(ScheduleId(`native-${i}`), 'Keep my reminder', 3600, now, `Reminder ${i}`)
      await native.table('tasks').put(record.id, { record, sessionId: SessionId('original'), status: 'active' })
    }
    await native.close()
  }
  const clock: AutomationClock = { now: () => now, setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() }
  const execute = vi.fn(async () => ({ status: 'completed' as const, resultType: 'none' as const, conversationAvailable: false }))
  let scheduler: AutomationScheduler
  ctx.loader.builtins.transfer = {
    name: 'transfer-fixture',
    inject: ['storageDomain', 'typert'],
    async apply(host: Context) {
      await host.plugin(AutomationService, { clock })
      await host.inject(['automation'], async host => {
      const transfer = new NativeScheduleTransfer(host, host.automation, async () => {
        scheduler = new AutomationScheduler(host, host.automation, clock)
        await scheduler.start()
        host.effect(() => () => scheduler.unload())
        await host.effect(async () => host.automation.attachExecutor({ execute, recover: async () => undefined }))
      })
      await transfer.start()
      })
    },
  }
  ctx.loader.builtins.include = Include
  const root = await mkdtemp(join(tmpdir(), 'automation-transfer-'))
  directories.push(root)
  const config = join(root, 'cordis.yml')
  await writeFile(config, '- name: cordis:transfer\n')
  const entry = await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  const fiber = ctx.loader.resolve(entry).fiber!
  await fiber
  if (!ctx.get('automation')) throw new Error([...ctx.loader.entries()].map(entry => `${entry.options.name}: ${String(entry.fiber?._error)}`).join('; '))
  async function nativeRows() {
    const domain = await facility.open(scheduleDomain)
    try { return [...domain.table('tasks').entries()].map(([, task]) => task) }
    finally { await domain.close() }
  }
  return { ctx, fiber, pool, facility, nativeRows, clock, execute, resolve, wake: () => scheduler.wake() }
}

describe('explicit native Schedule ownership transfer', () => {
  it('starts automation directly with no old reminders and removes its timer on unload', async () => {
    const h = await harness()
    expect((await h.ctx.automation.list()).status).toMatchObject({ enabled: true, migration: { phase: 'complete' } })
    expect(h.ctx.get('schedule')).toBeUndefined()
    await h.fiber.dispose()
    expect(h.clock.clearTimeout).toHaveBeenCalled()
  })

  it('keeps native delivery as sole owner until explicit confirmation, then retains native records and stable origin', async () => {
    const h = await harness({ count: 2 })
    expect((await h.ctx.automation.list()).status).toMatchObject({ enabled: false, migration: { phase: 'waiting', pending: 2 } })
    expect(h.ctx.get('schedule')).toBeDefined()
    await expect(h.ctx.automationMigration.migrate({ confirm: false } as never)).rejects.toMatchObject({ code: 'automation/invalid_input' })
    const result = await h.ctx.automationMigration.migrate({ confirm: true })
    expect(result.status.enabled).toBe(true)
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks.every(task => task.originSessionId === 'original' && task.status === 'active' && task.runs.length === 0)).toBe(true)
    expect(h.ctx.get('schedule')).toBeUndefined()
    expect((await h.nativeRows()).map(task => task.status)).toEqual(['inactive', 'inactive'])
    expect(await h.ctx.automationMigration.migrate({ confirm: true })).toEqual(result)
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('does not stop native delivery when a destination write fails', async () => {
    const h = await harness({ count: 1 })
    const write = vi.spyOn(h.ctx.automation, 'stageNativeTask').mockRejectedValueOnce(new Error('disk full'))
    await expect(h.ctx.automationMigration.migrate({ confirm: true })).rejects.toThrow('disk full')
    expect(h.ctx.get('schedule')).toBeDefined()
    expect((await h.ctx.schedule.catalog())[0]!.status).toBe('active')
    write.mockRestore()
    expect((await h.ctx.automationMigration.migrate({ confirm: true })).status.enabled).toBe(true)
  })

  it('holds both schedulers after partial retirement and resumes the checkpoint after restart without duplicate definitions', async () => {
    let writes = 0
    let fail = false
    const first = await harness({ count: 2, failNative: () => fail && ++writes === 2 })
    fail = true
    await expect(first.ctx.automationMigration.migrate({ confirm: true })).rejects.toThrow('write failed')
    expect(first.ctx.get('schedule')).toBeUndefined()
    expect((await first.ctx.automation.list()).status.enabled).toBe(false)
    await expect(first.ctx.automation.resume({ id: nativeAutomationId('native-0') })).rejects.toMatchObject({ code: 'automation/runtime_unavailable' })
    await first.ctx.fiber.dispose()
    const second = await harness({ pool: first.pool })
    expect(second.ctx.get('schedule')).toBeUndefined()
    expect((await second.ctx.automation.list()).status).toMatchObject({ enabled: false, migration: { phase: 'interrupted' } })
    const result = await second.ctx.automationMigration.migrate({ confirm: true })
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks.every(task => task.status === 'active')).toBe(true)
    expect((await second.nativeRows()).every(task => task.status === 'inactive')).toBe(true)
    await second.ctx.fiber.dispose()
    const third = await harness({ pool: first.pool })
    expect((await third.ctx.automation.list()).status.enabled).toBe(true)
    expect(third.ctx.get('schedule')).toBeUndefined()
    expect((await third.ctx.automation.list()).tasks).toHaveLength(2)
  })

  it('keeps overdue one-shots paused and visible instead of replaying them', async () => {
    const h = await harness()
    await h.fiber.dispose()
    const native = await h.facility.open(scheduleDomain)
    const record = createAtScheduleRecord(ScheduleId('overdue'), 'Needs review', new Date(now + 1000).toISOString(), now, 'Past reminder')
    await native.table('tasks').put(record.id, { record: { ...record, scheduledAt: new Date(now - 1000).toISOString() }, sessionId: SessionId('source'), status: 'active' })
    await native.close()
    const restarted = await harness({ pool: h.pool })
    const result = await restarted.ctx.automationMigration.migrate({ confirm: true })
    expect(result.tasks[0]).toMatchObject({ status: 'paused', schedule: { at: new Date(now - 1000).toISOString() } })
    expect(result.status.migration?.pausedOverdue).toEqual([nativeAutomationId('overdue')])
    expect(restarted.execute).not.toHaveBeenCalled()
  })

  it('reconciles a native task removed while paused copies are being prepared', async () => {
    const h = await harness({ count: 1 })
    const agent = agentFor(h.ctx)
    h.resolve.mockResolvedValue({ agent })
    const original = h.ctx.automation.stageNativeTask.bind(h.ctx.automation)
    vi.spyOn(h.ctx.automation, 'stageNativeTask').mockImplementation(async task => {
      await original(task)
      if (h.ctx.get('schedule')) await h.ctx.schedule.delete({ id: ScheduleId('native-0'), sessionId: SessionId('original') })
    })
    const result = await h.ctx.automationMigration.migrate({ confirm: true })
    expect(result.tasks[0]?.status).toBe('completed')
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('drains an in-flight native one-shot and retains its receipt without activating a second delivery', async () => {
    const h = await harness({ count: 1 })
    const agent = agentFor(h.ctx)
    h.resolve.mockResolvedValue({ agent })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    h.ctx.on('session/flush', async () => { entered.resolve(); await release.promise })
    const record = await h.ctx.schedule.create(SessionId('original'), {
      title: 'In-flight reminder', prompt: 'Deliver once', at: new Date(Date.now() + 50).toISOString(),
    })
    await entered.promise
    const staged = Promise.withResolvers<void>()
    const original = h.ctx.automation.stageNativeTask.bind(h.ctx.automation)
    vi.spyOn(h.ctx.automation, 'stageNativeTask').mockImplementation(async task => { await original(task); staged.resolve() })
    const migration = h.ctx.automationMigration.migrate({ confirm: true })
    await staged.promise
    expect((await h.ctx.automation.list()).status.enabled).toBe(false)
    release.resolve()
    const result = await migration
    expect(result.tasks.find(task => task.id === nativeAutomationId(record.id))?.status).toBe('completed')
    const retained = (await h.nativeRows()).find(task => task.record.id === record.id)!
    expect(retained.status).toBe('inactive')
    expect(retained.deliveryHistory?.records).toHaveLength(1)
    expect(agent.followup).toHaveBeenCalledTimes(1)
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('refuses fractional calendar seconds without stopping or altering the old reminder', async () => {
    expect(() => nativeSchedule({ id: ScheduleId('fractional'), title: 'Daily', prompt: 'Reminder', status: 'active', sessionId: SessionId('original'),
      kind: 'daily', time: '09:30:00.123', timeZone: 'UTC', scheduledAt: new Date(now + 1000).toISOString() })).toThrow('毫秒')
  })
})
