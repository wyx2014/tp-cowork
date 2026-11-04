/**
 * Host half of diagnostics, after dsh-desktop's file logging: every `ctx.logger` record of this Host is written to daily
 * files under `$DSH_HOME/logs/host` with secrets masked, so a packaged app keeps evidence that otherwise only reaches a
 * terminal. Host stderr (plugin `console.error`, fatal reports) is copied into the same files, because the desktop shell
 * keeps only a short tail of it in memory. Export is the desktop main process's job (see desktop.ts).
 */
import type { Context, Message } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FileExporter, localTimestamp } from './file-exporter.ts'
import { LogFileSink } from './log-files.ts'
import type { LogLevel } from './log-level.ts'
import { hostLogsDir, LOG_LIMITS, LOG_RETENTION_DAYS } from './paths.ts'

export const name = 'tpcowork-diagnostics'

export interface Config {
  /** Lowest severity written to the files; warnings and errors also go to the `.error.log` file. */
  logLevel: LogLevel
  /** Log directory; defaults to `$DSH_HOME/logs/host`, where the desktop export looks for it. */
  directory?: string
}

export const Config: z<Config> = z.object({
  logLevel: z.union(['debug', 'info', 'warn', 'error'] as const).default('info'),
  directory: z.string(),
})

/** Longest stderr line kept, so one runaway write cannot fill a file. */
const MAX_STDERR_LINE = 16 * 1024

/** Copy whole stderr lines into the sink while leaving stderr itself untouched. */
export function tapStderr(stream: NodeJS.WriteStream, record: (line: string) => void): () => void {
  const original = stream.write
  let pending = ''
  const consume = (text: string): void => {
    const parts = (pending + text).split('\n')
    pending = parts.pop()!.slice(0, MAX_STDERR_LINE)
    for (const part of parts) if (part.trim()) record(part.slice(0, MAX_STDERR_LINE))
  }
  stream.write = function (this: NodeJS.WriteStream, chunk: unknown, ...rest: unknown[]) {
    try { consume(typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf8') : '') }
    catch { /* recording is best-effort */ }
    return (original as (...args: unknown[]) => boolean).call(this, chunk, ...rest)
  } as typeof stream.write
  return () => {
    if (pending.trim()) record(pending)
    stream.write = original
  }
}

export function apply(ctx: Context, config: Config): void {
  let sink: LogFileSink
  try {
    sink = new LogFileSink(config.directory ?? hostLogsDir(), LOG_LIMITS)
    sink.purgeOlderThan(LOG_RETENTION_DAYS)
    sink.writeHeader(`--- TP Cowork Host pid ${String(process.pid)} ${process.platform}-${process.arch} node ${process.version} started ${new Date().toISOString()} ---`)
  } catch (error) {
    // As dsh-desktop: a log directory that cannot be used never blocks the application.
    ctx.logger('tpcowork-diagnostics').warn('诊断日志不可用：%s', error instanceof Error ? error.message : String(error))
    return
  }
  const exporter = new FileExporter(sink, config.logLevel)
  // Plugins load after DSH has logged its start-up, which dsh-desktop catches by installing its exporter at bootstrap.
  // Cordis keeps the latest records in `ctx.logger.buffer`, so write those first, then follow live records.
  const service = ctx.logger as unknown as { buffer?: readonly Message[]; _snMessage?: number }
  const replayUpTo = service._snMessage ?? 0
  ctx.effect(() => ctx.logger.exporter(exporter), 'tpcowork-diagnostics: log files')
  for (const message of service.buffer ?? []) if (message.sn <= replayUpTo) exporter.export(message)
  ctx.effect(() => tapStderr(process.stderr, line => {
    try { sink.write('warn', `${localTimestamp(Date.now())} [W] [stderr] ${line}`) } catch { /* best-effort */ }
  }), 'tpcowork-diagnostics: host stderr')
  ctx.effect(() => () => { sink.close() })
}
