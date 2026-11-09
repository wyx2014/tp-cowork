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

/** Session logs by id; a fork lists how many leading events it inherited from its parent. */
type Logs = Record<string, { events: object[]; inherited?: number }>

async function start(logs: Logs = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('typert', { register: () => () => {} } as never)
  const reads: string[] = []
  ctx.provide('sessionQuery', {
    listSessions: async () => Object.keys(logs).map(id => ({ header: { id }, live: false, persisted: true })),
    readSession: async (id: string) => {
      reads.push(id)
      const log = logs[id]
      if (!log) throw new Error(`no session ${id}`)
      return { session: { id }, inheritedEventCount: log.inherited ?? 0, events: log.events }
    },
  } as never)
  await ctx.plugin(Usage)
  const usage = (ctx as unknown as { usage: { get(request: object): Promise<{ summary: { totalTokens: number; totalSessions: number } }> } }).usage
  const summary = async () => (await usage.get({ range: 'all', timeZone: 'UTC' })).summary
  const emit = (id: string, event: object) => ctx.emit('session/event' as never, { id } as never, event as never)
  return { ctx, summary, emit, reads }
}

it('records live events and keeps rows across a restart without re-reading stored sessions', async () => {
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
  // Sessions already in the stored rows are never read again.
  expect(second.reads.filter(id => id === 'a')).toEqual([])
  second.emit('a', reply(9, now, 4))
  await tick()
  expect((await second.summary()).totalTokens).toBe(30)
})

it('rebuilds statistics from session logs after the stored rows are lost, as after a reinstall', async () => {
  home = await mkdtemp(join(tmpdir(), 'usage-host-'))
  process.env.DSH_HOME = home
  const now = Date.now()
  const logs: Logs = { a: { events: [{ type: 'turn/start', seq: 0, time: now, data: { turn: 1 } }, reply(1, now, 20), reply(2, now, 5)] } }
  const first = await start(logs)
  expect(await first.summary()).toMatchObject({ totalTokens: 25, totalSessions: 1 })
  await first.ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(first.ctx), 1)
  await rm(join(home, 'usage'), { recursive: true, force: true })

  const second = await start(logs)
  expect(await second.summary()).toMatchObject({ totalTokens: 25, totalSessions: 1 })
})

it('counts a session first seen live once, including its history, and skips events a fork inherited', async () => {
  home = await mkdtemp(join(tmpdir(), 'usage-host-'))
  process.env.DSH_HOME = home
  const now = Date.now()
  const turn = { type: 'turn/start', seq: 0, time: now, data: { turn: 1 } }
  const logs: Logs = {
    old: { events: [turn, reply(1, now, 10), reply(2, now, 7)] },
    // The fork carries its parent's first two events; only its own reply counts.
    fork: { events: [turn, reply(1, now, 10), { ...turn, seq: 2, data: { turn: 2 } }, reply(3, now, 3)], inherited: 2 },
  }
  const usage = await start(logs)
  // The live event already in the log is not counted twice.
  usage.emit('old', reply(2, now, 7))
  await tick()
  usage.emit('old', reply(3, now, 1))
  await tick()
  expect(await usage.summary()).toMatchObject({ totalTokens: 21, totalSessions: 2 })
})

it('keeps counting live events for a session whose log cannot be read', async () => {
  home = await mkdtemp(join(tmpdir(), 'usage-host-'))
  process.env.DSH_HOME = home
  const now = Date.now()
  const usage = await start()
  usage.emit('gone', { type: 'turn/start', seq: 4, time: now, data: { turn: 1 } })
  usage.emit('gone', reply(5, now, 9))
  await tick()
  expect(await usage.summary()).toMatchObject({ totalTokens: 9, totalSessions: 1 })
})
