/** Durable usage rows per session, so a restart does not re-read session logs that can no longer change. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { UsageLog } from './aggregate.ts'

/** Bump when the row shape or its extraction changes; older files are discarded and rebuilt. */
const VERSION = 3
const FLUSH_DELAY_MS = 2_000

export type StoredSession = UsageLog

export class UsageStore {
  private readonly file: string
  private readonly sessions = new Map<string, StoredSession>()
  private loaded: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private writing: Promise<void> = Promise.resolve()

  constructor(home: string, private readonly onError: (message: string) => void) {
    this.file = join(home, 'usage', `records.v${VERSION}.json`)
  }

  /** An unreadable or corrupt file only costs a rebuild; it must not fail the page. */
  load(): Promise<void> {
    return this.loaded ??= this.read()
  }

  private async read(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as { version?: number; sessions?: Record<string, StoredSession> }
      if (parsed.version !== VERSION || !parsed.sessions) return
      for (const [id, value] of Object.entries(parsed.sessions)) if (Array.isArray(value.records) && Array.isArray(value.turns) && Array.isArray(value.tools) && Array.isArray(value.open) && typeof value.seq === 'number') this.sessions.set(id, value)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.onError(`读取用量缓存失败，将重新统计：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  get(id: string): StoredSession | undefined { return this.sessions.get(id) }
  values(): IterableIterator<StoredSession> { return this.sessions.values() }
  get size(): number { return this.sessions.size }

  set(id: string, value: StoredSession): void { this.sessions.set(id, value); this.schedule() }
  /** A stored log changed in place (a live event was folded into it). */
  touch(): void { this.schedule() }


  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, FLUSH_DELAY_MS)
    this.timer.unref?.()
  }

  /** Write via a temp file so a crash never leaves a half-written store; writes are serialised. */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    this.writing = this.writing.then(async () => {
      const temp = `${this.file}.${process.pid}.tmp`
      try {
        await mkdir(dirname(this.file), { recursive: true })
        await writeFile(temp, JSON.stringify({ version: VERSION, sessions: Object.fromEntries(this.sessions) }))
        await rename(temp, this.file)
      } catch (error) { this.onError(`写入用量缓存失败：${error instanceof Error ? error.message : String(error)}`) }
    })
    return this.writing
  }
}
