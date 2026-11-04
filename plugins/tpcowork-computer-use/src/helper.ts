/**
 * Helper process: one per Agent connection. Speaks dsh-cua's JSONL protocol on stdin/stdout and answers it with Cua
 * Driver running in this process, so a native crash ends this helper rather than the Host. Started as
 * `node helper.js <cua-driver entry URL>` (Electron with ELECTRON_RUN_AS_NODE in the desktop app).
 *   request:  {"id","method","params"}      reply: {"id","result"} | {"id","error":{"code","message"}}
 *   cancel:   {"type":"cancel","id"}        the running request answers NATIVE_CANCELLED
 *   `--status` prints one JSON line with the platform's readiness instead, for the Settings page.
 */
import { execFile } from 'node:child_process'
import { readlink } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { BridgeError, CuaDriverBridge, type DriverCall, type DriverReply } from './bridge.ts'

const run = promisify(execFile)

/** The running executable, for "Always allow" consent bound to the real program. */
export async function executableOf(pid: number, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  if (platform === 'linux') return readlink(`/proc/${String(pid)}/exe`)
  if (platform === 'win32') {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${String(pid)}).Path`], { timeout: 5000, windowsHide: true })
    return stdout.trim() || undefined
  }
  if (platform === 'darwin') {
    const { stdout } = await run('/bin/ps', ['-o', 'comm=', '-p', String(pid)], { timeout: 5000 })
    const path = stdout.trim()
    // The app bundle is the identity users recognise and grant: /Applications/Notes.app/Contents/MacOS/Notes → Notes.app.
    return /\.app\//u.exec(path) ? path.slice(0, path.indexOf('.app/') + 4) : path || undefined
  }
  return undefined
}

interface NativeDriver {
  callTool(name: string, json: string, options?: { signal?: AbortSignal }): Promise<{ rawJson: string }>
  shutdown(): Promise<void>
  uniffiDestroy(): void
}

async function openDriver(entry: string): Promise<NativeDriver> {
  const { CuaDriver } = await import(entry) as { CuaDriver: { create(options: undefined): NativeDriver } }
  return CuaDriver.create(undefined)
}

const toDriverCall = (driver: NativeDriver): DriverCall => async (tool, args, signal) => {
  const result = await driver.callTool(tool, JSON.stringify(args), signal ? { signal } : undefined)
  return JSON.parse(result.rawJson) as DriverReply
}

/** One-shot readiness for Settings: platform, permissions and what is missing. */
async function status(entry: string): Promise<void> {
  let driver: NativeDriver | undefined
  try {
    driver = await openDriver(entry)
    const reply = await toDriverCall(driver)('check_permissions', {})
    process.stdout.write(`${JSON.stringify({ ok: true, platform: process.platform, permissions: reply.structuredContent ?? {}, detail: (reply.content ?? []).map(block => block.text ?? '').join('\n') })}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, platform: process.platform, error: error instanceof Error ? error.message : String(error) })}\n`)
  } finally {
    await driver?.shutdown().catch(() => {})
    driver?.uniffiDestroy()
  }
}

async function serve(entry: string): Promise<void> {
  const driver = await openDriver(entry)
  const bridge = new CuaDriverBridge(toDriverCall(driver), process.platform, pid => executableOf(pid))
  const running = new Map<string, AbortController>()
  const reply = (frame: object): void => { process.stdout.write(`${JSON.stringify(frame)}\n`) }
  // The Host sends one request at a time (it awaits each reply); cancellations may arrive while one runs.
  let queue = Promise.resolve()
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  lines.on('line', line => {
    let frame: { id?: unknown; method?: unknown; params?: unknown; type?: unknown }
    try { frame = JSON.parse(line) as typeof frame } catch { return }
    if (frame.type === 'cancel' && typeof frame.id === 'string') { running.get(frame.id)?.abort(); return }
    if (typeof frame.id !== 'string' || typeof frame.method !== 'string') return
    const id = frame.id, method = frame.method
    const params = (frame.params && typeof frame.params === 'object' ? frame.params : {}) as Record<string, unknown>
    const controller = new AbortController()
    running.set(id, controller)
    queue = queue.then(async () => {
      try {
        if (controller.signal.aborted) throw new BridgeError('NATIVE_CANCELLED', 'Operation cancelled before dispatch')
        reply({ id, result: await bridge.handle(method, params, controller.signal) })
      } catch (error) {
        const code = controller.signal.aborted ? 'NATIVE_CANCELLED' : error instanceof BridgeError ? error.code : 'ACTION_FAILED'
        reply({ id, error: { code, message: error instanceof Error ? error.message : String(error) } })
      } finally {
        running.delete(id)
      }
    })
  })
  await new Promise<void>(resolve => { lines.on('close', resolve) })
  await queue
  await driver.shutdown().catch(() => {})
  driver.uniffiDestroy()
}

const [entry, flag] = process.argv.slice(2)
if (entry) {
  void (flag === '--status' ? status(entry) : serve(entry)).then(() => { process.exit(0) }, error => {
    process.stderr.write(`tpcowork-computer-use helper: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exit(1)
  })
}
