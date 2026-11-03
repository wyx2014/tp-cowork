import { describe, expect, it } from 'vitest'
import { ExtractionScheduler, parseExtraction, TranscriptBuffer } from '../src/extraction.ts'
import { extractionInput } from '../src/prompt.ts'

describe('transcript buffer', () => {
  it('runs on real user prose and resets after each completed turn', () => {
    const buffer = new TranscriptBuffer()
    buffer.push('user', 'please always reply in Chinese')
    buffer.push('assistant', 'OK')
    expect(buffer.take()).toEqual({ decision: 'run', messages: [{ role: 'user', text: 'please always reply in Chinese' }, { role: 'assistant', text: 'OK' }] })
    expect(buffer.take()).toEqual({ decision: 'skip', reason: 'no-user-prose' })
  })

  it('counts CJK characters as prose and skips one-word prompts', () => {
    const buffer = new TranscriptBuffer()
    buffer.push('user', 'ok')
    expect(buffer.take().decision).toBe('skip')
    buffer.push('user', '以后都用中文回答')
    expect(buffer.take().decision).toBe('run')
  })

  it('skips a stretch in which the model wrote memory itself', () => {
    const buffer = new TranscriptBuffer()
    buffer.push('user', 'remember that the report is due Friday')
    buffer.directWrite = true
    expect(buffer.take()).toEqual({ decision: 'skip', reason: 'direct-memory-write' })
    expect(buffer.directWrite).toBe(false)
  })

  it('keeps the latest 40 bounded messages', () => {
    const buffer = new TranscriptBuffer()
    for (let i = 0; i < 45; i++) buffer.push('user', `message number ${i} ${'x'.repeat(i === 44 ? 5_000 : 0)}`)
    const taken = buffer.take()
    if (taken.decision !== 'run') throw new Error('expected a run')
    expect(taken.messages).toHaveLength(40)
    expect(taken.messages[0]!.text).toBe('message number 5')
    expect(taken.messages[39]!.text.length).toBe(4_001)
  })
})

describe('extraction reply', () => {
  it('accepts fenced JSON and drops invalid entries', () => {
    const reply = 'Here:\n```json\n' + JSON.stringify({
      save: [
        { name: 'reply-language', description: 'Chinese replies', type: 'feedback', body: 'Reply in Chinese.' },
        { name: 'bad-type', description: 'x', type: 'secret', body: 'x' },
        { name: 'missing-body', description: 'x', type: 'user' },
      ],
      delete: ['old-fact', 3],
    }) + '\n```'
    expect(parseExtraction(reply)).toEqual({
      save: [{ name: 'reply-language', description: 'Chinese replies', type: 'feedback', body: 'Reply in Chinese.' }],
      delete: ['old-fact'],
    })
  })

  it('treats a reply without a JSON object as nothing to apply', () => {
    expect(parseExtraction('Nothing to save.')).toBeUndefined()
    expect(parseExtraction('{not json}')).toBeUndefined()
    expect(parseExtraction('{"save":[],"delete":[]}')).toEqual({ save: [], delete: [] })
  })

  it('applies at most five saves and five deletes', () => {
    const many = { save: Array.from({ length: 8 }, (_, i) => ({ name: `f-${i}`, description: 'd', type: 'user', body: 'b' })), delete: Array.from({ length: 8 }, (_, i) => `d-${i}`) }
    const change = parseExtraction(JSON.stringify(many))!
    expect([change.save.length, change.delete.length]).toEqual([5, 5])
  })

  it('lists existing memories before the excerpt', () => {
    expect(extractionInput([{ name: 'a', description: 'A', type: 'user', mtimeMs: 0 }], [{ role: 'user', text: 'hi there friend' }]))
      .toBe('## Existing memories\n\n- a [user]: A\n\n## Conversation excerpt\n\nUser: hi there friend')
  })
})

describe('extraction scheduler', () => {
  it('runs one at a time and keeps only the latest pending request', async () => {
    const started: number[] = []
    let release!: () => void
    const scheduler = new ExtractionScheduler<number>(async (value) => {
      started.push(value)
      if (value === 1) await new Promise<void>(resolve => { release = resolve })
    })
    scheduler.schedule(1)
    scheduler.schedule(2)
    scheduler.schedule(3)
    release()
    await scheduler.drain()
    expect(started).toEqual([1, 3])
  })

  it('aborts the running call and drops pending work on shutdown', async () => {
    const started: number[] = []
    let observed: AbortSignal | undefined
    const scheduler = new ExtractionScheduler<number>(async (value, signal) => {
      started.push(value)
      observed = signal
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    })
    scheduler.schedule(1)
    scheduler.schedule(2)
    scheduler.shutdown()
    await scheduler.drain()
    scheduler.schedule(3)
    expect(started).toEqual([1])
    expect(observed?.aborted).toBe(true)
  })

  it('continues after a failed run', async () => {
    const started: number[] = []
    let release!: () => void
    const scheduler = new ExtractionScheduler<number>(async (value) => {
      started.push(value)
      if (value === 1) {
        await new Promise<void>(resolve => { release = resolve })
        throw new Error('model failed')
      }
    })
    scheduler.schedule(1)
    scheduler.schedule(2)
    release()
    await scheduler.drain()
    expect(started).toEqual([1, 2])
  })
})
