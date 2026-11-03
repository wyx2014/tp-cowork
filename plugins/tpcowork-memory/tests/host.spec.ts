// The plugin against a hand-built Context: registration, index injection and one extraction round.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/host.ts'
import { memoryRoot } from '../src/store.ts'

type Handler = (...args: any[]) => any

let home: string
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'tpcm-host-')); process.env.DSH_HOME = home })
afterEach(async () => { delete process.env.DSH_HOME; await rm(home, { recursive: true, force: true }) })

type Options = { enabled?: boolean; extraction?: boolean }
function mount(options: Options = {}, reply = '{"save":[],"delete":[]}') {
  let enabled = options.enabled ?? true
  const tools = new Map<string, any>()
  const sections: any[] = []
  const handlers = new Map<string, Handler[]>()
  const disposers: (() => void)[] = []
  const calls: any[] = []
  const ctx = {
    tools: { register: (tool: any) => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
    systemPrompt: { section: (section: any) => { sections.push(section); return () => sections.splice(sections.indexOf(section), 1) } },
    llm: {
      prepareCall: async (callConfig: any) => ({
        config: callConfig,
        async* stream(options: any) {
          calls.push(options)
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: reply }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }),
    },
    on: (name: string, handler: Handler) => { handlers.set(name, [...handlers.get(name) ?? [], handler]) },
    effect: (setup: () => () => void) => { disposers.push(setup()) },
    // The catalog Remote needs Typert, which this unit fake does not provide.
    inject: () => {},
    logger: { warn: () => {}, debug: () => {} },
  }
  // The Settings switch is a live volatile reference; the loader announces each change.
  apply(ctx as never, { enabled: { get: () => enabled } as never, extraction: options.extraction ?? true, extractionMaxTokens: 2048, extractionTimeoutMs: 60_000 })
  const emit = (name: string, ...args: unknown[]) => Promise.all((handlers.get(name) ?? []).map(handler => handler(...args)))
  const setEnabled = (value: boolean) => { enabled = value; return emit('loader/volatile-update') }
  return { tools, sections, handlers, calls, emit, setEnabled, dispose: () => disposers.forEach(dispose => dispose()) }
}

function session(cwd = '/work/app', origin?: 'subagent') {
  const events: any[] = []
  return {
    id: 'sess-1',
    header: { cwd, ...origin === undefined ? {} : { origin } },
    surface: { nodes: [] as number[] },
    eventAt: (seq: number) => events[seq],
    requestHeader: () => ({ config: { provider: 'deepseek', model: 'chat' } }),
    events,
  }
}

const userText = (text: string) => ({ type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind: 'user' } } })
const assistantText = (text: string) => ({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } })
const completed = { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }
const exec = (s: unknown) => ({ agent: { session: s } })

async function settle() { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)) }

describe('memory plugin', () => {
  it('offers memory only while the Settings switch is on, following live changes', async () => {
    const mounted = mount({ enabled: false })
    expect([mounted.tools.size, mounted.sections.length]).toEqual([0, 0])
    const s = session()
    const prompt = { id: 'u1' }
    const preStep = mounted.handlers.get('agent/pre-step')![0]!
    const step = () => preStep({ agent: { session: s }, messages: [prompt], step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [prompt] }))
    expect((await step()).messages).toHaveLength(1)
    await mounted.emit('session/event', s, userText('the weekly report is due every Friday'))
    await mounted.emit('session/event', s, completed)
    await mounted.setEnabled(true)
    expect([...mounted.tools.keys()]).toEqual(['memory_save', 'memory_delete', 'memory_read'])
    expect(mounted.sections).toHaveLength(1)
    await mounted.setEnabled(false)
    expect([mounted.tools.size, mounted.sections.length, mounted.calls.length]).toEqual([0, 0, 0])
  })

  it('adds the memory section and tools that write the workspace store', async () => {
    const mounted = mount()
    expect(mounted.sections[0]).toMatchObject({ name: 'tpcowork-memory', text: expect.stringContaining('# Memory') })
    expect([...mounted.tools.keys()]).toEqual(['memory_save', 'memory_delete', 'memory_read'])
    const s = session()
    await mounted.tools.get('memory_save').execute({ name: 'reply-language', description: 'Prefers Chinese', type: 'feedback', body: 'Use Chinese.' }, exec(s))
    const root = memoryRoot(home, '/work/app')
    expect(await readFile(join(root, 'MEMORY.md'), 'utf8')).toBe('- [reply-language](reply-language.md) — Prefers Chinese\n')
    await expect(mounted.tools.get('memory_save').execute({ name: 'x-y', description: 'x', type: 'user', body: 'x' }, exec(session('/work/app', 'subagent'))))
      .rejects.toThrow('main conversation')
  })

  it('injects the index once per conversation after the claimed prompt', async () => {
    const mounted = mount()
    const s = session()
    await mounted.tools.get('memory_save').execute({ name: 'a-fact', description: 'A fact', type: 'user', body: 'A.' }, exec(s))
    const prompt = { id: 'u1' }
    const preStep = mounted.handlers.get('agent/pre-step')![0]!
    const first = await preStep({ agent: { session: s }, messages: [prompt], step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [prompt] }))
    expect(first.messages).toHaveLength(2)
    expect(first.messages[0]).toBe(prompt)
    expect(first.messages[1].source).toEqual({ kind: 'tpcowork-memory', form: 'instructions' })
    expect(first.messages[1].content[0].text).toContain('- [a-fact](a-fact.md) — A fact')
    const second = await preStep({ agent: { session: s }, messages: [prompt], step: 2, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [prompt] }))
    expect(second.messages).toHaveLength(1)
  })

  it('extracts after a completed turn with user prose and saves the returned facts', async () => {
    const reply = JSON.stringify({ save: [{ name: 'report-day', description: 'Weekly report is due Friday', type: 'project', body: 'Due Friday.' }], delete: [] })
    const mounted = mount({}, reply)
    const s = session()
    await mounted.emit('session/event', s, userText('the weekly report is due every Friday'))
    await mounted.emit('session/event', s, assistantText('Noted.'))
    await mounted.emit('session/event', s, completed)
    await settle()
    expect(mounted.calls).toHaveLength(1)
    expect(mounted.calls[0].messages[0].content[0].text).toContain('User: the weekly report is due every Friday')
    const root = memoryRoot(home, '/work/app')
    // Extraction is fire-and-forget; wait for its write instead of a fixed number of ticks.
    await vi.waitFor(async () => expect(await readFile(join(root, 'report-day.md'), 'utf8')).toContain('originSessionId: sess-1'))
    expect(await readFile(join(root, 'MEMORY.md'), 'utf8')).toContain('— Weekly report is due Friday')
    mounted.dispose()
  })

  it('skips extraction after a direct memory write, for subagents, and while turned off', async () => {
    const mounted = mount()
    const s = session()
    await mounted.emit('session/event', s, userText('remember I prefer short answers'))
    await mounted.tools.get('memory_save').execute({ name: 'short-answers', description: 'Short answers', type: 'feedback', body: 'Be brief.' }, exec(s))
    await mounted.emit('session/event', s, completed)
    const child = session('/work/app', 'subagent')
    await mounted.emit('session/event', child, userText('some long enough request here'))
    await mounted.emit('session/event', child, completed)
    await settle()
    expect(mounted.calls).toHaveLength(0)
    const off = mount({ extraction: false })
    await off.emit('session/event', s, userText('another request that is long enough'))
    await off.emit('session/event', s, completed)
    await settle()
    expect(off.calls).toHaveLength(0)
  })
})
