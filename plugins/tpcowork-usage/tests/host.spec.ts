import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Usage from '../src/host.ts'

const contexts: Context[] = []
let home: string | undefined
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  if (home) await rm(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

const reply = (seq: number, time: number, tokens: number) => ({ type: 'assistant/message', seq, time, data: { usage: { totalTokens: tokens }, message: { source: { model: 'm' } } } })
const tick = () => new Promise(resolve => setTimeout(resolve, 10))

/** A session history service that records reads; `hang` makes every read wait forever, like a huge or stuck log. */
async function start({ hang = false } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('typert', { register: () => () => {} } as never)
  const reads: string[] = []
  const never = new Promise<never>(() => {})
  ctx.provide('sessionQuery', {
    listSessions: async () => { reads.push('list'); if (hang) await never; return [{ header: { id: 'old' }, live: false, persisted: true }] },
    readSession: async (id: string) => { reads.push(id); if (hang) await never; return { session: { id }, inheritedEventCount: 0, events: [reply(0, Date.now(), 99)] } },
  } as never)
  await ctx.plugin(Usage)
  const usage = (ctx as unknown as { usage: { get(request: object): Promise<{ summary: { totalTokens: number; totalSessions: number } }> } }).usage
  const summary = async () => (await usage.get({ range: 'all', timeZone: 'UTC' })).summary
  const emit = (id: string, event: object) => ctx.emit('session/event' as never, { id } as never, event as never)
  return { ctx, summary, emit, reads }
}

it('records live events and keeps rows across a restart, never reading session history', async () => {
  home = await mkdtemp(join(tmpdir(), 'usage-host-'))
  process.env.DSH_HOME = home
  const now = Date.now()
  const first = await start()
  expect(await first.summary()).toMatchObject({ totalTokens: 0, totalSessions: 0 })

  // A session seen for the first time starts counting from its first event; only sessions with a turn count as sessions.
  first.emit('a', { type: 'turn/start', seq: 6, time: now, data: { turn: 1 } })
  first.emit('a', reply(7, now, 20))
  first.emit('a', reply(8, now, 5))
  // A repeated event (same seq) is not counted twice; unrelated events are ignored.
  first.emit('a', reply(8, now, 5))
  first.emit('a', { type: 'user/message', seq: 9, time: now, data: {} })
  first.emit('b', reply(0, now, 1))
  await tick()
  expect(await first.summary()).toMatchObject({ totalTokens: 26, totalSessions: 1 })

  await first.ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(first.ctx), 1)
  await tick()
  const second = await start()
  expect(await second.summary()).toMatchObject({ totalTokens: 26, totalSessions: 1 })
  second.emit('a', reply(9, now, 4))
  await tick()
  expect((await second.summary()).totalTokens).toBe(30)
  // Like ZCode, statistics come only from rows recorded as usage happens; session logs are never listed or read.
  expect([...first.reads, ...second.reads]).toEqual([])
})

it('opens the page at once even when session history would take forever to read', async () => {
  home = await mkdtemp(join(tmpdir(), 'usage-host-'))
  process.env.DSH_HOME = home
  const usage = await start({ hang: true })
  usage.emit('a', reply(0, Date.now(), 3))
  await tick()
  const answered = await Promise.race([usage.summary(), new Promise(resolve => setTimeout(() => resolve('timeout'), 1_000))])
  expect(answered).toMatchObject({ totalTokens: 3 })
})
