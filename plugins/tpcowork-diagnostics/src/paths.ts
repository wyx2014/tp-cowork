/** Where diagnostics live. The Host and the desktop main process both resolve DSH_HOME the same way, so neither passes paths. */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** DSH's home: `$DSH_HOME`, else `~/.dsh` (as `@deepseek-ai/dsh-home-paths` resolves it). */
export function dshHome(env: Record<string, string | undefined> = process.env): string {
  const configured = env.DSH_HOME?.trim()
  return configured ? configured : join(homedir(), '.dsh')
}

/** The Host's own log files: `$DSH_HOME/logs/host`. */
export function hostLogsDir(env: Record<string, string | undefined> = process.env): string {
  return join(dshHome(env), 'logs', 'host')
}

/** Size ceilings shared by both log writers, as in dsh-desktop. */
export const LOG_LIMITS = { maxFileBytes: 10 * 1024 * 1024, maxDirectoryBytes: 200 * 1024 * 1024 } as const
/** Log files older than this are deleted at startup. */
export const LOG_RETENTION_DAYS = 7
