/**
 * Background extraction after a completed turn, following ZCode's policy: skip turns that already wrote
 * memory or carry no real user prose, keep one running and one latest-pending run, and stop on dispose.
 * Unlike ZCode's five-turn tool loop, one model call returns the whole change as JSON.
 */
import { MEMORY_TYPES, type MemoryInput, type MemoryType } from './store.ts'
import type { TranscriptMessage } from './prompt.ts'

const MESSAGE_LIMIT = 40
const MESSAGE_CHARS = 4_000
const CHANGE_LIMIT = 5

/** Conversation text collected since the last extraction of one session. */
export class TranscriptBuffer {
  private messages: TranscriptMessage[] = []
  /** Set when the model wrote memory itself during the current stretch. */
  directWrite = false

  push(role: TranscriptMessage['role'], text: string): void {
    const trimmed = text.trim()
    if (trimmed === '') return
    this.messages.push({ role, text: trimmed.length > MESSAGE_CHARS ? `${trimmed.slice(0, MESSAGE_CHARS)}…` : trimmed })
    if (this.messages.length > MESSAGE_LIMIT) this.messages.splice(0, this.messages.length - MESSAGE_LIMIT)
  }

  /**
   * Take the collected stretch for one completed turn and reset the buffer.
   * @returns the messages to extract from, or why the stretch is skipped.
   */
  take(): { decision: 'run'; messages: TranscriptMessage[] } | { decision: 'skip'; reason: 'direct-memory-write' | 'no-user-prose' } {
    const messages = this.messages
    const directWrite = this.directWrite
    this.messages = []
    this.directWrite = false
    if (directWrite) return { decision: 'skip', reason: 'direct-memory-write' }
    // ZCode runs only when one user message has at least three words; CJK text has no spaces, so count characters.
    const prose = messages.some(message => message.role === 'user' && (
      message.text.split(/\s+/).filter(Boolean).length >= 3 || /[぀-ヿ㐀-鿿가-힯]{3}/u.test(message.text)
    ))
    return prose ? { decision: 'run', messages } : { decision: 'skip', reason: 'no-user-prose' }
  }
}

/** A validated extraction result. */
export interface ExtractionChange {
  readonly save: MemoryInput[]
  readonly delete: string[]
}

/**
 * Parse the extraction reply, tolerating a Markdown code fence or surrounding prose around one JSON
 * object. Invalid entries are dropped; at most five saves and five deletes apply.
 * @param text - assembled model text.
 * @returns the change, or undefined when the reply holds no JSON object.
 */
export function parseExtraction(text: string): ExtractionChange | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let value: unknown
  try { value = JSON.parse(text.slice(start, end + 1)) } catch { return undefined }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as { save?: unknown; delete?: unknown }
  const save = (Array.isArray(record.save) ? record.save : []).flatMap((entry): MemoryInput[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const { name, description, type, body } = entry as Record<string, unknown>
    if (typeof name !== 'string' || typeof description !== 'string' || typeof body !== 'string') return []
    if (typeof type !== 'string' || !(MEMORY_TYPES as readonly string[]).includes(type)) return []
    return [{ name, description, type: type as MemoryType, body }]
  }).slice(0, CHANGE_LIMIT)
  const remove = (Array.isArray(record.delete) ? record.delete : [])
    .filter((name): name is string => typeof name === 'string').slice(0, CHANGE_LIMIT)
  return { save, delete: remove }
}

/**
 * One running and one latest-pending extraction per session. A newer request replaces the pending one;
 * shutdown drops pending work and aborts the running call.
 */
export class ExtractionScheduler<T> {
  private running: Promise<void> | undefined
  private pending: T | undefined
  private readonly controller = new AbortController()

  constructor(private readonly run: (input: T, signal: AbortSignal) => Promise<void>) {}

  schedule(input: T): void {
    if (this.controller.signal.aborted) return
    if (this.running !== undefined) {
      this.pending = input
      return
    }
    this.running = this.loop(input)
  }

  private async loop(first: T): Promise<void> {
    let input: T | undefined = first
    try {
      while (input !== undefined && !this.controller.signal.aborted) {
        try { await this.run(input, this.controller.signal) } catch { /* the runner reports its own failures */ }
        input = this.pending
        this.pending = undefined
      }
    } finally {
      this.running = undefined
    }
  }

  /** Wait until no run is active; used by tests and orderly disposal. */
  async drain(): Promise<void> {
    while (this.running !== undefined) await this.running
  }

  shutdown(): void {
    this.pending = undefined
    this.controller.abort(new Error('memory extraction stopped'))
  }
}
