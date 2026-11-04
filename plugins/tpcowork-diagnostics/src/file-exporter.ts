/** Cordis exporter writing formatted log records to the log files. Adapted from dsh-desktop (dsh-plugin-desktop/src/file-exporter.ts). */
import { Logger, type Exporter, type Message } from '@deepseek-ai/cordis'
import { shouldEmit, type LogLevel } from './log-level.ts'
import type { LogFileSink } from './log-files.ts'

/** `2026-11-03 10:13:08.123`, in local time like the file names. */
export function localTimestamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/** Cordis exporter that forwards formatted messages to a `LogFileSink`. */
export class FileExporter implements Exporter {
  formatters = {}
  maxLength = 10240
  // Cordis filters by `levels` before calling `export` (default INFO=1 would drop warn and debug).
  // Pass everything through and let `shouldEmit` own the threshold.
  levels = { default: 3 }

  constructor(private readonly sink: LogFileSink, private threshold: LogLevel = 'info') {}

  /** Update the verbosity threshold in place on a setting change. */
  setThreshold(level: LogLevel): void {
    this.threshold = level
  }

  export(message: Message): void {
    if (!shouldEmit(message.type, this.threshold)) return
    try { this.sink.write(message.type, this.render(message)) }
    catch { /* Persistent logs are best-effort; logging must never fail the caller. */ }
  }

  private render(message: Message): string {
    const level = message.type.charAt(0).toUpperCase()
    return `${localTimestamp(message.ts)} [${level}] [${message.name}] ${Logger.format(this, message)}`
  }
}
