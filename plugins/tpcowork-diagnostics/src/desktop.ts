/**
 * Desktop main-process half of diagnostics, after dsh-desktop's `exportDiagnostics()`: confirm the privacy notice in a
 * native dialog, build the archive off the UI thread, publish it to `<userData>/diagnostics` and reveal it in the file
 * manager. It also records the desktop's own process failures (renderer and child processes gone) to daily files in
 * `app.getPath('logs')`, next to the shell's crash reports.
 *
 * The browser plugin's desktop payload is the product's only plugin seam into the main process, so it carries this
 * module and forwards `request('diagnostics', …)` here, as it does for interface zoom.
 */
import { app, dialog, shell, type BrowserWindow, type MessageBoxOptions } from 'electron'
import { join } from 'node:path'
import { createDiagnosticsArchive } from './archive.ts'
import { localTimestamp } from './file-exporter.ts'
import { LogFileSink } from './log-files.ts'
import { maskSecrets } from './mask-secrets.ts'
import { hostLogsDir, LOG_LIMITS, LOG_RETENTION_DAYS } from './paths.ts'

export type DiagnosticsLocale = 'zh' | 'en'

/** dsh-desktop's privacy confirmation, naming what this product's archive holds. */
export const PRIVACY_COPY: Record<DiagnosticsLocale, { title: string; message: string; detail: string; confirm: string; cancel: string; failed: string }> = {
  zh: {
    title: '导出诊断信息',
    message: '分享诊断包前请先检查其中的内容。',
    detail: '诊断包包含最近的应用日志、崩溃报告、本地崩溃转储和系统信息。日志可能包含本地路径、工作区 ID 和会话 ID，崩溃转储可能包含进程内存片段。系统会对日志中可识别的认证凭据进行脱敏，但公开上传前仍应检查诊断包。',
    confirm: '导出',
    cancel: '取消',
    failed: '无法导出诊断信息',
  },
  en: {
    title: 'Export Diagnostics',
    message: 'Review the diagnostic archive before sharing it.',
    detail: 'The archive contains recent application logs, crash reports, local crash dumps, and system information. Logs may contain local paths, workspace IDs, and session IDs. Crash dumps may contain fragments of process memory. Authentication credentials are masked in logs when recognized, but you should still review the archive before uploading it publicly.',
    confirm: 'Export',
    cancel: 'Cancel',
    failed: 'Could not export diagnostics',
  },
}

export type DiagnosticsResult =
  | { readonly status: 'exported'; readonly path: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly message: string }

export interface DesktopDiagnosticsOptions {
  readonly window: () => BrowserWindow | undefined
  readonly userData: string
}

/** Electron surfaces used here; tests pass fakes. */
export interface DesktopDiagnosticsRuntime {
  readonly logsDir: string
  readonly crashDumpsDir: string
  readonly appName: string
  readonly appVersion: string
  showMessageBox(window: BrowserWindow | undefined, options: MessageBoxOptions): Promise<{ response: number }>
  showError(title: string, content: string): void
  reveal(path: string): void
  on(event: string, listener: (...args: unknown[]) => void): void
  off(event: string, listener: (...args: unknown[]) => void): void
}

function electronRuntime(): DesktopDiagnosticsRuntime {
  // Getters: Electron is read when used, so loading this module never fails on its own.
  return {
    get logsDir() { return app.getPath('logs') },
    get crashDumpsDir() { return app.getPath('crashDumps') },
    get appName() { return app.getName() },
    get appVersion() { return app.getVersion() },
    showMessageBox: (window, options) => window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options),
    showError: (title, content) => { dialog.showErrorBox(title, content) },
    reveal: path => { shell.showItemInFolder(path) },
    on: (event, listener) => { app.on(event as 'quit', listener) },
    off: (event, listener) => { app.off(event as 'quit', listener) },
  }
}

const exitCode = (code: number): string => `${String(code)} / 0x${(code >>> 0).toString(16).padStart(8, '0')}`

export function createDesktopDiagnostics(options: DesktopDiagnosticsOptions, runtime: DesktopDiagnosticsRuntime = electronRuntime()) {
  let sink: LogFileSink | undefined
  try {
    sink = new LogFileSink(runtime.logsDir, LOG_LIMITS)
    sink.purgeOlderThan(LOG_RETENTION_DAYS)
    sink.writeHeader(`--- ${runtime.appName} ${runtime.appVersion} desktop ${process.platform}-${process.arch} electron ${process.versions.electron ?? '?'} pid ${String(process.pid)} ${new Date().toISOString()} ---`)
  } catch (error) {
    sink = undefined
    process.stderr.write(`tpcowork-diagnostics: desktop log unavailable: ${error instanceof Error ? error.message : String(error)}\n`)
  }
  const log = (type: 'error' | 'warn' | 'info', message: string): void => {
    try { sink?.write(type, `${localTimestamp(Date.now())} [${type.charAt(0).toUpperCase()}] [desktop] ${maskSecrets(message)}`) }
    catch { /* best-effort */ }
  }
  // The Chromium-level record of a failure is often the only evidence of why the window went blank or the Host died.
  const childGone = (_event: unknown, details: unknown): void => {
    const row = details as { type?: string; reason?: string; exitCode?: number; name?: string; serviceName?: string }
    log('error', `child process gone (type: ${row.type ?? '?'}, name: ${row.name ?? row.serviceName ?? 'unnamed'}, reason: ${row.reason ?? '?'}, exitCode: ${exitCode(row.exitCode ?? 0)})`)
  }
  const rendererGone = (_event: unknown, _contents: unknown, details: unknown): void => {
    const row = details as { reason?: string; exitCode?: number }
    log('error', `renderer process gone (reason: ${row.reason ?? '?'}, exitCode: ${exitCode(row.exitCode ?? 0)})`)
  }
  try {
    runtime.on('child-process-gone', childGone as (...args: unknown[]) => void)
    runtime.on('render-process-gone', rendererGone as (...args: unknown[]) => void)
  } catch { /* no process events to watch (tests, or an Electron without them) */ }

  let running: Promise<DiagnosticsResult> | undefined
  const exportDiagnostics = async (locale: DiagnosticsLocale): Promise<DiagnosticsResult> => {
    const copy = PRIVACY_COPY[locale]
    try {
      const confirmation = await runtime.showMessageBox(options.window(), {
        type: 'warning', title: copy.title, message: copy.message, detail: copy.detail,
        buttons: [copy.confirm, copy.cancel], defaultId: 1, cancelId: 1, noLink: true,
      })
      if (confirmation.response !== 0) return { status: 'cancelled' }
      const path = await createDiagnosticsArchive({
        outDir: join(options.userData, 'diagnostics'),
        mainLogsDir: runtime.logsDir,
        hostLogsDir: hostLogsDir(),
        crashDumpsDir: runtime.crashDumpsDir,
        appName: runtime.appName,
        appVersion: runtime.appVersion,
      })
      log('info', `diagnostics exported (${path})`)
      runtime.reveal(path)
      return { status: 'exported', path }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log('error', `diagnostics export failed: ${message}`)
      runtime.showError(copy.failed, message)
      return { status: 'failed', message }
    }
  }
  return {
    /** `{ action: 'export', locale }`: concurrent requests share one prompt and one archive. */
    request(payload: unknown): Promise<DiagnosticsResult> {
      const request = (payload ?? {}) as { action?: unknown; locale?: unknown }
      if (request.action !== 'export') return Promise.reject(new Error('tpcowork-diagnostics: unknown action'))
      running ??= exportDiagnostics(request.locale === 'en' ? 'en' : 'zh').finally(() => { running = undefined })
      return running
    },
    dispose(): void {
      try {
        runtime.off('child-process-gone', childGone as (...args: unknown[]) => void)
        runtime.off('render-process-gone', rendererGone as (...args: unknown[]) => void)
      } catch { /* never subscribed */ }
      sink?.close()
    },
  }
}
