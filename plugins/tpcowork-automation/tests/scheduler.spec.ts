import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../deepseek-harness/packages/storage/storage-domain/tests/helpers/memory-backend.ts'
import Host, { AutomationService, AutomationScheduler } from '../src/host.ts'
import type { AutomationClock, AutomationExecutor, AutomationRunOutcome, ScheduleConfig, ScheduledTask } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())); vi.restoreAllMocks() })
class Clock implements AutomationClock {
  time = Date.parse('2026-01-30T09:10:00Z')
  sequence = 0
  timers = new Map<number, { at: number; callback: () => void }>()
  now = () => this.time
  setTimeout(callback: () => void, delayMs: number) { const id = ++this.sequence; this.timers.set(id, { at: this.time + delayMs, callback }); return id }
  clearTimeout(handle: unknown) { this.timers.delete(handle as number) }
  fireAt(time: number) {
    this.time = time
    for (const [id, timer] of [...this.timers]) if (timer.at <= time) { this.timers.delete(id); timer.callback() }
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const completed: AutomationRunOutcome = { status: 'completed', resultType: 'none', conversationAvailable: false }
const executor = (execute: AutomationExecutor['execute'] = async () => completed): AutomationExecutor => ({ execute, recover: async () => undefined })
async function harness(clock = new Clock(), pool = new MemoryMediaPool(), fullHost = false) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(TypertRegistry)
  const backend = new MemoryStorageBackend(pool)
  ctx.effect(() => ctx.storage.backend.register('fixture', backend))
  const facility = new DomainFacility(ctx, { backend: 'fixture' })
  ctx.provide('storageDomain', facility)
  ctx.effect(() => async () => { await facility.closeAll(); await backend.close() })
  const fiber = await ctx.plugin(fullHost ? Host : AutomationService, { clock })
  const service = ctx.automation
  const scheduler = fullHost ? undefined : new AutomationScheduler(ctx, service, clock)
  if (scheduler) { await scheduler.start(); ctx.effect(() => () => scheduler.unload()) }
  const create = async (schedule: ScheduleConfig = { frequency: 'manual' }, name = '任务') => {
    const before = new Set((await service.list()).tasks.map(task => task.id))
    return (await service.create({ name, prompt: '执行报告', schedule: { ...schedule, timezone: 'UTC' } })).tasks.find(task => !before.has(task.id))!
  }
  const get = async (task: ScheduledTask) => (await service.list()).tasks.find(value => value.id === task.id)!
  return { ctx, service, scheduler: scheduler!, clock, pool, fiber, create, get }
}

describe('Host scheduler', () => {
  it('installs one scheduler in the real package, reports unavailable without an executor, and unloads cleanly', async () => {
    const h = await harness(undefined, undefined, true)
    const task = await h.create({ frequency: 'daily' })
    expect(task.nextRunAt).toBe(Date.parse('2026-01-31T09:00:00Z'))
    expect((await h.service.list()).status.enabled).toBe(false)
    await expect(h.service.runNow({ id: task.id })).rejects.toMatchObject({ code: 'automation/runtime_unavailable' })
    expect(h.clock.timers.size).toBe(0)
    const detach = await h.service.attachExecutor(executor())
    await vi.waitFor(() => expect(h.clock.timers.size).toBe(1))
    expect((await h.service.list()).status.enabled).toBe(true)
    expect(() => h.service.attachRuntime(h.scheduler)).toThrow()
    await detach()
    expect(h.clock.timers.size).toBe(0)
    expect((await h.service.list()).status.enabled).toBe(false)
    await h.fiber.dispose()
    expect(h.ctx.typert.local.list()).toEqual([])
    expect(h.clock.timers.size).toBe(0)
  })

  it('durably admits paused manual runs promptly, prevents concurrent starts, and retains 20 actual executions', async () => {
    const h = await harness()
    const terminal = deferred<AutomationRunOutcome>()
    const execute = vi.fn<AutomationExecutor['execute']>().mockImplementationOnce(() => terminal.promise).mockResolvedValue(completed)
    await h.service.attachExecutor(executor(execute))
    const task = await h.create()
    const admissions = await Promise.allSettled([h.service.runNow({ id: task.id }), h.service.runNow({ id: task.id })])
    expect(admissions.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(await h.get(task)).toMatchObject({ status: 'paused', runs: [{ status: 'running', startedAt: h.clock.time }] })
    expect(execute).toHaveBeenCalledTimes(1)
    terminal.resolve(completed)
    await vi.waitFor(async () => expect((await h.get(task)).runs[0]!.status).toBe('completed'))
    for (let index = 0; index < 21; index++) {
      await h.service.runNow({ id: task.id })
      await vi.waitFor(async () => expect((await h.get(task)).runs[0]!.status).toBe('completed'))
    }
    expect((await h.get(task)).runs).toHaveLength(20)
    expect(execute).toHaveBeenCalledTimes(22)
  })

  it('processes current due tasks in time order, awaits each run, and rechecks paused/deleted/edited tasks', async () => {
    const h = await harness()
    const terminal = deferred<AutomationRunOutcome>()
    const order: string[] = []
    await h.service.attachExecutor(executor(async ({ task }) => {
      order.push(task.name)
      if (task.name === 'first') return terminal.promise
      return completed
    }))
    const second = await h.create({ frequency: 'custom', everyMs: 2000 }, 'second')
    const first = await h.create({ frequency: 'custom', everyMs: 1000 }, 'first')
    const paused = await h.create({ frequency: 'custom', everyMs: 3000 }, 'paused')
    const edited = await h.create({ frequency: 'custom', everyMs: 4000 }, 'edited')
    const deleted = await h.create({ frequency: 'custom', everyMs: 4500 }, 'deleted')
    h.clock.time += 5000
    const wake = h.scheduler.wake()
    expect(h.scheduler.wake()).toBe(wake)
    await vi.waitFor(() => expect(order).toEqual(['first']))
    await h.service.pause({ id: paused.id })
    await h.service.update({ id: edited.id, data: { name: 'edited', prompt: 'new', schedule: { frequency: 'daily', timezone: 'UTC' } } })
    await h.service.delete({ id: deleted.id })
    await h.service.pause({ id: first.id })
    terminal.resolve(completed)
    await wake
    expect(order).toEqual(['first', 'second'])
    expect((await h.get(first)).nextRunAt).toBeUndefined()
    expect((await h.get(second)).nextRunAt).toBe(h.clock.time + 2000)
    expect((await h.get(paused)).runs).toEqual([])
    expect((await h.get(edited)).runs).toEqual([])
  })

  it('allows manual admission while another due run is still executing', async () => {
    const h = await harness()
    const terminal = deferred<AutomationRunOutcome>()
    const execute = vi.fn<AutomationExecutor['execute']>().mockImplementationOnce(() => terminal.promise).mockResolvedValue(completed)
    await h.service.attachExecutor(executor(execute))
    const scheduled = await h.create({ frequency: 'custom', everyMs: 1000 })
    const manual = await h.create()
    h.clock.time += 1000
    const wake = h.scheduler.wake()
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    await h.service.runNow({ id: manual.id })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    await expect(h.service.runNow({ id: scheduled.id })).rejects.toMatchObject({ code: 'automation/task_running' })
    terminal.resolve(completed)
    await wake
  })

  it('does not fire while paused, resumes from the current clock, and never schedules manual tasks', async () => {
    const h = await harness()
    const execute = vi.fn<AutomationExecutor['execute']>().mockResolvedValue(completed)
    await h.service.attachExecutor(executor(execute))
    const task = await h.create({ frequency: 'custom', everyMs: 1000 })
    const manual = await h.create()
    await h.service.pause({ id: task.id })
    h.clock.time += 10_000
    await h.scheduler.wake()
    expect(execute).not.toHaveBeenCalled()
    await h.service.resume({ id: task.id })
    await h.service.resume({ id: manual.id })
    expect((await h.get(task)).nextRunAt).toBe(h.clock.time + 1000)
    expect((await h.get(manual)).nextRunAt).toBeUndefined()
    h.clock.time += 1000
    await h.scheduler.wake()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('wakes through the injected timer, handles late wake once, and uses updated rules at settlement', async () => {
    const h = await harness()
    const terminal = deferred<AutomationRunOutcome>()
    const execute = vi.fn<AutomationExecutor['execute']>().mockImplementation(() => terminal.promise)
    await h.service.attachExecutor(executor(execute))
    const task = await h.create({ frequency: 'custom', everyMs: 1000 })
    await vi.waitFor(() => expect([...h.clock.timers.values()][0]!.at).toBe(h.clock.time + 1000))
    h.clock.fireAt(h.clock.time + 20_000)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    await h.service.update({ id: task.id, data: { name: '新规则', prompt: 'new', schedule: { frequency: 'custom', everyMs: 4000, timezone: 'UTC' } } })
    terminal.resolve(completed)
    await vi.waitFor(async () => expect((await h.get(task)).runs[0]!.status).toBe('completed'))
    expect((await h.get(task)).nextRunAt).toBe(h.clock.time + 4000)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('schedules future cycles after errors without immediately retrying, and caps long timer delays', async () => {
    const h = await harness()
    const execute = vi.fn<AutomationExecutor['execute']>().mockRejectedValue(new Error('failure'))
    await h.service.attachExecutor(executor(execute))
    await h.create({ frequency: 'daily' })
    await vi.waitFor(() => expect([...h.clock.timers.values()][0]!.at).toBe(h.clock.time + 300_000))
    const task = await h.create({ frequency: 'custom', everyMs: 1000 })
    h.clock.time += 1000
    await h.scheduler.wake()
    await h.scheduler.wake()
    expect(execute).toHaveBeenCalledTimes(1)
    expect((await h.get(task)).nextRunAt).toBe(h.clock.time + 1000)
    h.clock.time += 1000
    await h.scheduler.wake()
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('keeps completed once history and never automatically retries failures or skips', async () => {
    const h = await harness()
    const execute = vi.fn<AutomationExecutor['execute']>().mockRejectedValueOnce(new Error('private upstream text'))
      .mockResolvedValueOnce({ ...completed, status: 'skipped', skippedReason: 'permission denied' }).mockResolvedValue(completed)
    await h.service.attachExecutor(executor(execute))
    const task = await h.create({ frequency: 'once', at: new Date(h.clock.time + 1000).toISOString() })
    h.clock.time += 1000
    await h.scheduler.wake()
    expect(await h.get(task)).toMatchObject({ status: 'completed', runs: [{ status: 'error', errorCode: 'execution_failed', error: '自动化执行失败。' }] })
    h.clock.time += 50_000
    await h.scheduler.wake()
    await h.service.resume({ id: task.id })
    await h.scheduler.wake()
    expect(execute).toHaveBeenCalledTimes(1)
    await h.service.runNow({ id: task.id })
    await vi.waitFor(async () => expect((await h.get(task)).runs[0]!.status).toBe('completed'))
    expect((await h.get(task)).runs[0]!.skippedReason).toBe('permission denied')
    expect((await h.get(task)).runs).toHaveLength(2)
  })

  it('restarts from now without replaying missed cycles or past once tasks', async () => {
    const first = await harness()
    await first.create({ frequency: 'custom', everyMs: 1000 })
    await first.create({ frequency: 'once', at: new Date(first.clock.time + 5000).toISOString() })
    await first.ctx.fiber.dispose()
    first.clock.time += 30_000
    const second = await harness(first.clock, first.pool)
    const execute = vi.fn<AutomationExecutor['execute']>().mockResolvedValue(completed)
    await second.service.attachExecutor(executor(execute))
    const tasks = (await second.service.list()).tasks
    expect(tasks.find(task => task.schedule.frequency === 'custom')!.nextRunAt).toBe(first.clock.time + 1000)
    expect(tasks.find(task => task.schedule.frequency === 'once')!.nextRunAt).toBeUndefined()
    await second.scheduler.wake()
    expect(execute).not.toHaveBeenCalled()
    second.clock.time += 1000
    await second.scheduler.wake()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('repairs running records from explicit Session/Turn evidence, marks >24h interruptions, and never replays', async () => {
    const first = await harness()
    const old = await first.create({ frequency: 'custom', everyMs: 1000 }, 'stale')
    await first.service.beginRun({ taskId: old.id, trigger: 'manual' })
    const recovered = await first.create({ frequency: 'once', at: new Date(first.clock.time + 1000).toISOString() }, 'recovered')
    const run = await first.service.beginRun({ taskId: recovered.id, trigger: 'manual' })
    await first.service.bindRun({ taskId: recovered.id, runId: run.id, sessionId: SessionId('evidence'), turnId: 4, ownsSession: true })
    await first.ctx.fiber.dispose()
    first.clock.time += 24 * 60 * 60 * 1000 + 1
    const second = await harness(first.clock, first.pool)
    const execute = vi.fn<AutomationExecutor['execute']>().mockResolvedValue(completed)
    const recover = vi.fn<AutomationExecutor['recover']>().mockImplementation(async ({ run }) => run.sessionId === 'evidence'
      ? { status: 'completed', completedAt: run.startedAt + 500, resultType: 'conversation', conversationAvailable: true } : undefined)
    await second.service.attachExecutor({ execute, recover })
    expect(await second.get(old)).toMatchObject({ runs: [{ status: 'error', errorCode: 'run_interrupted' }] })
    expect(await second.get(recovered)).toMatchObject({ status: 'completed', runs: [{ status: 'completed', turnId: 4, conversationAvailable: true, completedAt: run.startedAt + 500 }] })
    expect(execute).not.toHaveBeenCalled()
    expect(recover).toHaveBeenCalledTimes(2)
    await second.scheduler.wake()
    expect(execute).not.toHaveBeenCalled()
  })

  it('leaves recent unknown runs locked; recovery lookup failure does not misreport interruption or success', async () => {
    const h = await harness()
    const task = await h.create()
    const run = await h.service.beginRun({ taskId: task.id, trigger: 'manual' })
    const execute = vi.fn<AutomationExecutor['execute']>().mockResolvedValue(completed)
    const detach = await h.service.attachExecutor(executor(execute))
    expect((await h.get(task)).runs[0]!.status).toBe('running')
    await expect(h.service.runNow({ id: task.id })).rejects.toMatchObject({ code: 'automation/task_running' })
    await detach()
    h.clock.time += 25 * 60 * 60 * 1000
    await expect(h.service.attachExecutor({ execute, recover: async () => { throw new Error('unavailable') } })).rejects.toThrow('unavailable')
    expect((await h.get(task)).runs[0]).toMatchObject({ id: run.id, status: 'running' })
    expect((await h.service.list()).status.enabled).toBe(false)
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not execute when start persistence fails, and retains uncertain terminal writes for recovery', async () => {
    const h = await harness()
    const terminal = deferred<AutomationRunOutcome>()
    const execute = vi.fn<AutomationExecutor['execute']>().mockImplementation(() => terminal.promise)
    await h.service.attachExecutor(executor(execute))
    const task = await h.create()
    h.pool.failNextWrites = 1
    await expect(h.service.runNow({ id: task.id })).rejects.toMatchObject({ code: 'automation/storage_failure' })
    expect(execute).not.toHaveBeenCalled()
    expect((await h.get(task)).runs).toEqual([])
    await h.service.runNow({ id: task.id })
    h.pool.failNextWrites = 1
    const warn = vi.spyOn(h.ctx.logger, 'warn').mockImplementation(() => {})
    terminal.resolve(completed)
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect((await h.get(task)).runs[0]!.status).toBe('running')
    await h.scheduler.wake()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('cancels owned execution and timers on executor detach, permits replacement only after quiescence', async () => {
    const h = await harness()
    const aborted = deferred<void>()
    const release = deferred<AutomationRunOutcome>()
    const dispose = vi.fn(async () => {})
    const detach = await h.service.attachExecutor({ ...executor(async ({ signal }) => {
      signal.addEventListener('abort', () => aborted.resolve())
      return release.promise
    }), dispose })
    const task = await h.create({ frequency: 'custom', everyMs: 1000 })
    await h.service.runNow({ id: task.id })
    const stopping = detach()
    await aborted.promise
    await expect(h.service.attachExecutor(executor())).rejects.toMatchObject({ code: 'automation/invalid_input' })
    release.reject(new Error('cancelled'))
    await stopping
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(h.clock.timers.size).toBe(0)
    expect((await h.get(task)).runs[0]).toMatchObject({ status: 'error', errorCode: 'run_interrupted' })
    await h.service.attachExecutor(executor())
    expect((await h.service.list()).status.enabled).toBe(true)
    await h.scheduler.unload()
    expect(h.clock.timers.size).toBe(0)
  })

  it('Host teardown persists cancellation before closing storage and never starts another due run', async () => {
    const h = await harness(undefined, undefined, true)
    const execute = vi.fn<AutomationExecutor['execute']>().mockImplementation(async ({ signal }) => {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      throw new Error('stopped')
    })
    await h.service.attachExecutor(executor(execute))
    const task = await h.create({ frequency: 'custom', everyMs: 1000 })
    await h.service.runNow({ id: task.id })
    await h.fiber.dispose()
    expect(h.clock.timers.size).toBe(0)
    h.clock.fireAt(h.clock.time + 10_000)
    expect(execute).toHaveBeenCalledTimes(1)
    const restarted = await harness(h.clock, h.pool)
    expect((await restarted.get(task)).runs[0]).toMatchObject({ status: 'error', errorCode: 'run_interrupted' })
  })

  it('waits for an already detaching scheduler before closing the Host store', async () => {
    const h = await harness()
    const aborted = deferred<void>()
    const release = deferred<AutomationRunOutcome>()
    await h.service.attachExecutor(executor(async ({ signal }) => {
      signal.addEventListener('abort', () => aborted.resolve(), { once: true })
      return release.promise
    }))
    const task = await h.create()
    await h.service.runNow({ id: task.id })
    const detach = h.scheduler.unload()
    await aborted.promise
    const hostStopping = h.fiber.dispose()
    release.reject(new Error('cancelled'))
    await Promise.all([detach, hostStopping])
    const restarted = await harness(h.clock, h.pool)
    expect((await restarted.get(task)).runs[0]).toMatchObject({ status: 'error', errorCode: 'run_interrupted' })
  })

  it('withdraws runtime registration when startup schedule persistence fails', async () => {
    const h = await harness()
    await h.scheduler.unload()
    await h.create({ frequency: 'daily' })
    h.pool.failNextWrites = 1
    const replacement = new AutomationScheduler(h.ctx, h.service, h.clock)
    await expect(replacement.start()).rejects.toMatchObject({ code: 'automation/storage_failure' })
    const detach = h.service.attachRuntime({ nextRunAt: () => undefined, runNow: async () => {}, dispose: async () => {} })
    await detach()
    expect(h.clock.timers.size).toBe(0)
  })
})
