import { describe, expect, it, vi } from 'vitest'
import { ToolboxWatch } from '../src/client/watch.ts'

describe('toolbox invalidation stream ownership', () => {
  it('refreshes on ready/change, replaces a reset stream, and releases each stream on unload', async () => {
    const subscriptions: Array<{ push(value: object): void; dispose: ReturnType<typeof vi.fn> }> = []
    const model = { interrupted: vi.fn(), live: vi.fn(), refresh: vi.fn(async () => {}), dispose: vi.fn() }
    const remote = { $stream: vi.fn(() => {
      let stopped = false
      let pending: ((value: IteratorResult<object>) => void) | undefined
      const queue: object[] = []
      const dispose = vi.fn(async () => { stopped = true; pending?.({ done: true, value: undefined }); pending = undefined })
      subscriptions.push({ push(value) { const frame = { value, accept: vi.fn() }; if (pending) { const next = pending; pending = undefined; next({ done: false, value: frame }) } else queue.push(frame) }, dispose })
      return { dispose, [Symbol.asyncIterator]() { return { next() { if (queue.length) return Promise.resolve({ done: false, value: queue.shift() }); if (stopped) return Promise.resolve({ done: true, value: undefined }); return new Promise(resolve => { pending = resolve }) } } } }
    }), toolboxChanges: {} }
    const watch = new ToolboxWatch(remote as ConstructorParameters<typeof ToolboxWatch>[0], model as ConstructorParameters<typeof ToolboxWatch>[1])
    await vi.waitFor(() => expect(subscriptions).toHaveLength(1))
    subscriptions[0]!.push({ type: 'ready' })
    await vi.waitFor(() => expect(model.refresh).toHaveBeenCalledWith('modules'))
    subscriptions[0]!.push({ type: 'changed', change: { domain: 'skills', revision: 1 } })
    await vi.waitFor(() => expect(model.refresh).toHaveBeenCalledWith('skills'))
    watch.reconnect()
    await vi.waitFor(() => expect(subscriptions).toHaveLength(2))
    expect(subscriptions[0]!.dispose).toHaveBeenCalledOnce()
    await watch.dispose()
    expect(subscriptions[1]!.dispose).toHaveBeenCalledOnce()
    expect(model.dispose).toHaveBeenCalledOnce()
    watch.reconnect(); await Promise.resolve()
    expect(subscriptions).toHaveLength(2)
  })

  const lossFixture = () => {
    const streams: Array<{ fail(): void; ready(): void; dispose: ReturnType<typeof vi.fn> }> = []
    const model = { interrupted: vi.fn(), live: vi.fn(), refresh: vi.fn(async () => {}), dispose: vi.fn() }
    const remote = { toolboxChanges: {}, $stream: vi.fn(() => {
      let settle: { resolve(value: IteratorResult<object>): void; reject(error: Error): void } | undefined
      const dispose = vi.fn(async () => { settle?.resolve({ done: true, value: undefined }); settle = undefined })
      streams.push({ dispose, fail() { settle?.reject(new Error('toolbox changes ended')); settle = undefined },
        ready() { const next = settle; settle = undefined; next?.resolve({ done: false, value: { value: { type: 'ready' }, accept: vi.fn() } }) } })
      return { dispose, [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<object>>((resolve, reject) => { settle = { resolve, reject } }) } } }
    }) }
    const watch = new ToolboxWatch(remote as ConstructorParameters<typeof ToolboxWatch>[0], model as ConstructorParameters<typeof ToolboxWatch>[1])
    return { streams, model, watch }
  }

  it('reopens a lost stream with a growing delay that resets once connected', async () => {
    vi.useFakeTimers()
    try {
      const { streams, model, watch } = lossFixture()
      await vi.advanceTimersByTimeAsync(0)
      streams[0]!.fail()
      await vi.advanceTimersByTimeAsync(999)
      expect(streams).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(streams).toHaveLength(2)
      streams[1]!.fail()
      await vi.advanceTimersByTimeAsync(1999)
      expect(streams).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(streams).toHaveLength(3)
      streams[2]!.ready()
      await vi.advanceTimersByTimeAsync(0)
      expect(model.live).toHaveBeenCalledOnce()
      expect(model.refresh).toHaveBeenCalledWith('modules')
      streams[2]!.fail()
      await vi.advanceTimersByTimeAsync(1000)
      expect(streams).toHaveLength(4)
      await watch.dispose()
    } finally { vi.useRealTimers() }
  })

  it('does not retry after a deliberate reconnect or unload', async () => {
    vi.useFakeTimers()
    try {
      const { streams, watch } = lossFixture()
      await vi.advanceTimersByTimeAsync(0)
      watch.reconnect()
      await vi.advanceTimersByTimeAsync(60000)
      expect(streams).toHaveLength(2)
      streams[1]!.fail()
      await watch.dispose()
      await vi.advanceTimersByTimeAsync(60000)
      expect(streams).toHaveLength(2)
    } finally { vi.useRealTimers() }
  })
})
