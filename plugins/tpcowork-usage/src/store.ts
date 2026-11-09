/**
 * Durable usage rows per session, recorded as usage happens (the only copy, as in ZCode). An unreadable file is set
 * aside rather than overwritten, so the file is never replaced while its contents are unknown.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { UsageLog } from './aggregate.ts'

/** Bump when the row shape or its extraction changes; older files are set aside and counting starts afresh. */
const VERSION = 3
const FLUSH_DELAY_MS = 2_000
/** Windows security software can hold a just-written file briefly; such reads are retried before giving up. */
const READ_RETRIES = 5
const READ_RETRY_DELAY_MS = 200
const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES', 'EAGAIN', 'EMFILE', 'ENFILE'])

/** Writes still in flight per file, shared by every store in the process: a reloaded plugin reads only after the
 * previous instance's final write has landed, so it never loads an older file and later overwrites the newer one. */
const pendingWrites = new Map<string, Promise<void>>()

export type StoredSession = UsageLog

export class UsageStore {
  private readonly file: string
  private readonly sessions = new Map<string, StoredSession>()
  private loaded: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private writing: Promise<void> = Promise.resolve()
  /** Set when an existing file could neither be read nor moved aside: writing would destroy it. */
  private frozen = false

  constructor(home: string, private readonly onError: (message: string) => void) {
    this.file = join(home, 'usage', `records.v${VERSION}.json`)
  }

  /** An unreadable file must not fail the page; it is preserved under a dated name. */
  load(): Promise<void> {
    return this.loaded ??= this.read()
  }

  private async read(): Promise<void> {
    await pendingWrites.get(this.file)
    let text: string | undefined
    for (let attempt = 0; ; attempt++) {
      try { text = await readFile(this.file, 'utf8'); break }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') return
        if (code !== undefined && TRANSIENT.has(code) && attempt < READ_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, READ_RETRY_DELAY_MS * (attempt + 1)))
          continue
        }
        return this.setAside(`读取用量记录失败（${code ?? String(error)}）`)
      }
    }
    let parsed: { version?: number; sessions?: Record<string, StoredSession> }
    try { parsed = JSON.parse(text) as typeof parsed }
    catch { return this.setAside('用量记录文件已损坏') }
    if (parsed.version !== VERSION || !parsed.sessions) return this.setAside('用量记录文件版本不兼容')
    for (const [id, value] of Object.entries(parsed.sessions)) {
      if (Array.isArray(value.records) && Array.isArray(value.turns) && Array.isArray(value.tools) && Array.isArray(value.open) && typeof value.seq === 'number') this.sessions.set(id, value)
    }
  }

  /** Keep the unreadable file under a dated name, so nothing is lost and a fresh file can be written. */
  private async setAside(reason: string): Promise<void> {
    const kept = this.file.replace(/\.json$/u, `.unreadable-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`)
    try {
      await rename(this.file, kept)
      this.onError(`${reason}，已保留为 ${kept}，统计从空记录重新开始`)
    } catch (error) {
      this.frozen = true
      this.onError(`${reason}，且无法另存（${error instanceof Error ? error.message : String(error)}）；为避免覆盖原文件，本次运行不保存用量记录`)
    }
  }

  get(id: string): StoredSession | undefined { return this.sessions.get(id) }
  has(id: string): boolean { return this.sessions.has(id) }
  values(): IterableIterator<StoredSession> { return this.sessions.values() }
  get size(): number { return this.sessions.size }

  set(id: string, value: StoredSession): void { this.sessions.set(id, value); this.schedule() }
  /** A stored log changed in place (a live event was folded into it). */
  touch(): void { this.schedule() }

  private schedule(): void {
    if (this.timer || this.frozen) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, FLUSH_DELAY_MS)
    this.timer.unref?.()
  }

  /** Write via a temp file so a crash never leaves a half-written store; writes are serialised. */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    // Nothing loaded means nothing known: writing would replace the file with an empty one.
    if (this.frozen || this.loaded === undefined) return this.writing
    this.writing = this.writing.then(() => this.loaded).then(async () => {
      if (this.frozen) return
      const temp = `${this.file}.${process.pid}.tmp`
      try {
        await mkdir(dirname(this.file), { recursive: true })
        await writeFile(temp, JSON.stringify({ version: VERSION, sessions: Object.fromEntries(this.sessions) }))
        await rename(temp, this.file)
      } catch (error) { this.onError(`写入用量缓存失败：${error instanceof Error ? error.message : String(error)}`) }
    })
    const writing = this.writing
    pendingWrites.set(this.file, writing)
    void writing.finally(() => { if (pendingWrites.get(this.file) === writing) pendingWrites.delete(this.file) })
    return writing
  }
}
