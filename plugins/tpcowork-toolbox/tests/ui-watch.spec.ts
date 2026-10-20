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
})
