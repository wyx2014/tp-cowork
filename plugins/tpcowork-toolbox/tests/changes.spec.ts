import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { watchChanges } from '../src/changes.ts'
import type { Change } from '../src/contracts/index.ts'

it.each([
  ['modules', 'skills', 'modules'],
  ['mcp', 'modules', 'modules'],
  ['skills', 'mcp', 'modules'],
  ['skills', 'skills', 'skills'],
] as const)('refreshes %s and %s after a slow consumer resumes', async (first, second, expected) => {
  const ctx = new Context()
  const controller = new AbortController()
  const stream = watchChanges(ctx, controller.signal)[Symbol.asyncIterator]()
  try {
    expect((await stream.next()).value).toEqual({ type: 'ready' })
    // The client is still reading its initial catalogs when these notifications arrive.
    ctx.emit('toolbox/changed', { revision: 1, domain: first, id: 'first' })
    ctx.emit('toolbox/changed', { revision: 2, domain: second, id: 'second' })
    expect((await stream.next()).value).toMatchObject({ type: 'changed', change: { domain: expected } })
    const later: Change = { revision: 3, domain: 'teams', id: 'later' }
    ctx.emit('toolbox/changed', later)
    expect((await stream.next()).value).toEqual({ type: 'changed', change: later })
    const pending = stream.next()
    controller.abort()
    expect((await pending).done).toBe(true)
  } finally {
    controller.abort()
    await stream.return?.()
    await ctx.fiber.dispose()
  }
})
