import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { DefaultInitialization, initializationCode } from '../src/initialization.ts'
import type { InitializationIssue } from '../src/contracts/index.ts'

it('coalesces retries, publishes completion, and cancels and joins work before disposal', async () => {
  const ctx = new Context()
  const finish = Promise.withResolvers<InitializationIssue[]>()
  const work = vi.fn((signal: AbortSignal) => { signal.addEventListener('abort', () => finish.resolve([]), { once: true }); return finish.promise })
  const events = vi.fn()
  ctx.on('toolbox/changed', events)
  const initialization = new DefaultInitialization(ctx, work)
  const first = initialization.retry()
  expect(initialization.retry()).toBe(first)
  await Promise.resolve()
  expect(work).toHaveBeenCalledTimes(1)
  expect(initialization.describe().state).toBe('running')
  await ctx.fiber.dispose()
  await first
  expect(work.mock.calls[0]![0].aborted).toBe(true)
  expect(events).toHaveBeenCalledTimes(1)
  await expect(initialization.retry()).rejects.toThrow('disposed')
})

it('reports an unexpected failure without leaking its message and permits a later retry', async () => {
  const ctx = new Context()
  try {
    const work = vi.fn<(_signal: AbortSignal) => Promise<InitializationIssue[]>>()
      .mockRejectedValueOnce(new Error('secret credential and private filesystem path'))
      .mockResolvedValueOnce([])
    const initialization = new DefaultInitialization(ctx, work)
    await initialization.retry()
    expect(initialization.describe()).toEqual({ state: 'failed', issues: [{ kind: 'settings', resourceId: 'defaults', code: 'toolbox/initialization-failed' }] })
    await initialization.retry()
    expect(initialization.describe()).toEqual({ state: 'ready', issues: [] })
    expect(initializationCode(Object.assign(new Error('private path'), { code: 'EACCES' }))).toBe('filesystem/EACCES')
    expect(initializationCode({ code: 'secret' })).toBe('toolbox/initialization-failed')
  } finally { await ctx.fiber.dispose() }
})
