/**
 * Diagnostic archive construction and retention, after dsh-desktop's export worker (dsh-plugin-desktop/src/
 * diagnostic-export-worker.ts): newest evidence first under one byte budget, linked inputs and outputs refused, files that
 * vanish or are locked skipped, the archive published atomically and only the newest three kept.
 */
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDesktopLogFileName } from './log-files.ts'
import { createZip, type ZipEntry } from './zip.ts'

/** Bounds both memory and how much potentially sensitive history leaves the machine. */
export const MAX_DIAGNOSTIC_EVIDENCE_BYTES = 50 * 1024 * 1024
const DIAGNOSTIC_ARCHIVE = /^diagnostics-\d+(?:-[0-9a-f-]+)?\.zip$/u
const MAX_DIAGNOSTIC_ARCHIVES = 3
/** The desktop shell's fatal-error reports (`apps/desktop/src/crash-report.ts`). */
const CRASH_REPORT = /^crash-[\dTZ-]+-(?:host|web-boot|renderer|main)\.log$/u
const SKIPPABLE = new Set(['EACCES', 'EBUSY', 'ELOOP', 'ENOENT', 'ENOTDIR', 'EPERM'])

export interface DiagnosticArchiveOptions {
  /** Where archives are published, e.g. `<userData>/diagnostics`. */
  readonly outDir: string
  /** Desktop main-process log files and crash reports (`app.getPath('logs')`). */
  readonly mainLogsDir?: string
  /** Host log files written by the Host plugin, archived under `host/`. */
  readonly hostLogsDir?: string
  /** Crashpad directory whose local `.dmp` files are included (`app.getPath('crashDumps')`). */
  readonly crashDumpsDir?: string
  readonly appName: string
  readonly appVersion: string
  readonly maxEvidenceBytes?: number
  /** Extra `key: value` lines for system-info.txt. */
  readonly systemInfo?: Readonly<Record<string, string>>
}

interface Candidate { readonly name: string; readonly path: string; readonly kind: 'log' | 'crash-report' | 'crash-dump'; readonly size: number; readonly mtimeMs: number }

const skippable = (cause: unknown): boolean => cause instanceof Error && 'code' in cause && typeof cause.code === 'string' && SKIPPABLE.has(cause.code)

/** A directory that may be absent, but never a link: following one could archive files the user did not mean to share. */
async function ownedDirectory(directory: string | undefined, what: string): Promise<boolean> {
  if (directory === undefined) return false
  try {
    const stats = await lstat(directory)
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`tpcowork-diagnostics: refusing linked ${what} directory`)
    return true
  } catch (cause) {
    if (skippable(cause)) return false
    throw cause
  }
}

async function regularFiles(directory: string, accept: (name: string) => boolean, prefix: string, kind: Candidate['kind']): Promise<Candidate[]> {
  const found: Candidate[] = []
  for (const name of await readdir(directory)) {
    if (!accept(name)) continue
    const path = join(directory, name)
    try {
      const stats = await lstat(path)
      if (!stats.isSymbolicLink() && stats.isFile()) found.push({ name: `${prefix}${name}`, path, kind, size: stats.size, mtimeMs: stats.mtimeMs })
    } catch (cause) { if (!skippable(cause)) throw cause }
  }
  return found
}

async function crashDumps(directory: string): Promise<Candidate[]> {
  const found: Candidate[] = []
  const pending = [{ path: directory, relative: '' }]
  while (pending.length > 0) {
    const current = pending.pop()!
    let names: string[]
    try { names = await readdir(current.path) } catch (cause) { if (skippable(cause)) continue; throw cause }
    for (const name of names) {
      const path = join(current.path, name)
      const relative = current.relative === '' ? name : `${current.relative}/${name}`
      try {
        const stats = await lstat(path)
        if (stats.isSymbolicLink()) continue
        if (stats.isDirectory()) pending.push({ path, relative })
        else if (stats.isFile() && name.toLowerCase().endsWith('.dmp')) found.push({ name: `crash-dumps/${relative}`, path, kind: 'crash-dump', size: stats.size, mtimeMs: stats.mtimeMs })
      } catch (cause) { if (!skippable(cause)) throw cause }
    }
  }
  return found
}

/** Read a file only if it is still the same regular file and fits the remaining budget. */
async function readStable(candidate: Candidate, remaining: number): Promise<Buffer | undefined> {
  if (candidate.size > remaining) return undefined
  let handle
  try {
    handle = await open(candidate.path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW))
    const stats = await handle.stat()
    if (!stats.isFile() || stats.size > remaining) return undefined
    const data = await handle.readFile()
    return data.byteLength <= remaining ? data : undefined
  } catch (cause) {
    if (skippable(cause)) return undefined
    throw cause
  } finally {
    await handle?.close()
  }
}

const newestFirst = (a: Candidate, b: Candidate): number => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name, 'en')

/** Write one diagnostics ZIP and return its path. */
export async function createDiagnosticsArchive(options: DiagnosticArchiveOptions): Promise<string> {
  const budget = options.maxEvidenceBytes ?? MAX_DIAGNOSTIC_EVIDENCE_BYTES
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error('tpcowork-diagnostics: evidence byte limit must be a positive integer')
  await mkdir(options.outDir, { recursive: true })
  if (!await ownedDirectory(options.outDir, 'diagnostics')) throw new Error('tpcowork-diagnostics: diagnostics directory is unavailable')

  const reports: Candidate[] = []
  const logs: Candidate[] = []
  if (await ownedDirectory(options.mainLogsDir, 'log')) {
    reports.push(...await regularFiles(options.mainLogsDir!, name => CRASH_REPORT.test(name), 'crash-reports/', 'crash-report'))
    logs.push(...await regularFiles(options.mainLogsDir!, isDesktopLogFileName, 'main/', 'log'))
  }
  if (await ownedDirectory(options.hostLogsDir, 'Host log')) logs.push(...await regularFiles(options.hostLogsDir!, isDesktopLogFileName, 'host/', 'log'))
  const dumps = await ownedDirectory(options.crashDumpsDir, 'crash dump') ? await crashDumps(options.crashDumpsDir!) : []

  // Crash evidence first: it is the rarest and the reason most exports happen; then the newest logs.
  const ordered = [...reports.sort(newestFirst), ...dumps.sort(newestFirst), ...logs.sort(newestFirst)]
  const entries: ZipEntry[] = []
  const counts = { 'crash-report': [0, 0], 'crash-dump': [0, 0], log: [0, 0] } as Record<Candidate['kind'], [number, number]>
  let included = 0
  for (const candidate of ordered) {
    const data = await readStable(candidate, budget - included)
    if (data === undefined) { counts[candidate.kind][1]++; continue }
    entries.push({ name: candidate.name, data, modified: new Date(candidate.mtimeMs) })
    included += data.byteLength
    counts[candidate.kind][0]++
  }
  const info = [
    `app: ${options.appName}`,
    `version: ${options.appVersion}`,
    `platform: ${process.platform}`,
    `arch: ${process.arch}`,
    `node: ${process.version}`,
    `electron: ${process.versions.electron ?? 'unknown'}`,
    `chrome: ${process.versions.chrome ?? 'unknown'}`,
    ...Object.entries(options.systemInfo ?? {}).map(([key, value]) => `${key}: ${value.replace(/[\r\n]+/gu, ' ')}`),
    `exported: ${new Date().toISOString()}`,
    `included-log-files: ${String(counts.log[0])}`,
    `omitted-log-files: ${String(counts.log[1])}`,
    `included-crash-reports: ${String(counts['crash-report'][0])}`,
    `omitted-crash-reports: ${String(counts['crash-report'][1])}`,
    `included-crash-dumps: ${String(counts['crash-dump'][0])}`,
    `omitted-crash-dumps: ${String(counts['crash-dump'][1])}`,
    `included-evidence-bytes: ${String(included)}`,
    `evidence-byte-limit: ${String(budget)}`,
    'privacy: logs may contain local paths, workspace IDs and session IDs; crash dumps may contain process memory',
  ]
  entries.push({ name: 'system-info.txt', data: Buffer.from(`${info.join('\n')}\n`, 'utf8') })

  const outPath = join(options.outDir, `diagnostics-${String(Date.now())}-${randomUUID()}.zip`)
  const temporary = `${outPath}.tmp`
  try {
    await writeFile(temporary, await createZip(entries), { mode: 0o600 })
    await rename(temporary, outPath)
  } catch (cause) {
    await unlink(temporary).catch(() => undefined)
    throw cause
  }
  const archives: { path: string; mtimeMs: number }[] = []
  for (const name of await readdir(options.outDir)) {
    if (!DIAGNOSTIC_ARCHIVE.test(name)) continue
    try {
      const stats = await lstat(join(options.outDir, name))
      if (!stats.isSymbolicLink() && stats.isFile()) archives.push({ path: join(options.outDir, name), mtimeMs: stats.mtimeMs })
    } catch (cause) { if (!skippable(cause)) throw cause }
  }
  archives.sort((a, b) => b.mtimeMs - a.mtimeMs || b.path.localeCompare(a.path, 'en'))
  for (const old of archives.slice(MAX_DIAGNOSTIC_ARCHIVES)) {
    // A file manager or an upload may still hold an older archive open.
    await unlink(old.path).catch(() => undefined)
  }
  return outPath
}
