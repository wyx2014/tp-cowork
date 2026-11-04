/**
 * Computer Use for TP Cowork on Windows, macOS and Linux X11, after ZCode's Computer Use: the model gets DSH's app/window
 * object API (`@deepseek-ai/dsh-cua`: getApp → getAXState → click/setValue by element index, per-app consent), and this
 * plugin supplies the native side — a helper process per Agent that answers dsh-cua's protocol with Cua Driver (MIT),
 * the cross-platform accessibility/input library already installed in the DSH runtime.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { CuaConfig, installCua } from '@deepseek-ai/dsh-cua'
import type { NativeChannel, NativeChannelFactory } from '@deepseek-ai/dsh-cua/native-client'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '@deepseek-ai/dsh-computer-use'
import { DESCRIPTION, guidance } from './guidance.ts'
import { statusContribution, type ComputerUseStatus } from './remote.ts'
import { computerUseSupport } from './support.ts'

export const name = 'tpcowork-computer-use'
/** dsh-cua's executor: the exclusive provider slot, the model tool and prompt, and Agent-owned connections. */
export const inject = ['computerUse', 'tools', 'systemPrompt', 'agents']

export type Config = CuaConfig & {
  /**
   * The Settings switch, off by default as in ZCode because it lets the model operate desktop apps. Changing it reloads
   * this plugin, which mounts or removes the provider; dsh-cua saves "Always allow" grants through this same entry.
   */
  enabled: boolean
  /** Cua Driver entry (absolute path or file URL) instead of the installed `@trycua/cua-driver`; for diagnosis and tests. */
  driverPath?: string
}
// One object schema: the live allowedApps field must keep a fixed path, which an intersection would hide.
export const Config: Schema<Record<string, unknown>, Config> = Schema.object({
  enabled: Schema.boolean().default(false).description('Let the agent read and operate desktop applications.'),
  driverPath: Schema.string().description('Cua Driver entry to use instead of the installed package.'),
  ...(CuaConfig as unknown as { dict: Record<string, Schema> }).dict,
}) as unknown as Schema<Record<string, unknown>, Config>

/** The helper bundled next to the built Host (`lib/helper.mjs`); running from source uses the built copy. */
const helperPath = (): string => {
  const beside = fileURLToPath(new URL('./helper.mjs', import.meta.url))
  return existsSync(beside) ? beside : fileURLToPath(new URL('../lib/helper.mjs', import.meta.url))
}

/** Cua Driver's entry as the Host resolves it; the helper process has no access to the Host's resolver. */
export function resolveDriver(override?: string): string | undefined {
  if (override) return override.startsWith('file:') ? override : pathToFileURL(override).href
  try { return import.meta.resolve('@trycua/cua-driver') } catch { /* fall through */ }
  try { return pathToFileURL(createRequire(import.meta.url).resolve('@trycua/cua-driver')).href } catch { return undefined }
}

/** Node for the helper: the Host's own runtime (Electron with ELECTRON_RUN_AS_NODE in the desktop app). */
const helperEnvironment = (): NodeJS.ProcessEnv => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1' })

/** One helper process per Agent connection, speaking dsh-cua's JSONL protocol on stdio. */
export function helperChannel(driver: string): NativeChannelFactory {
  return (_owner, config): NativeChannel => {
    const child = spawn(process.execPath, [config.helperPath, driver], {
      cwd: config.cwd, env: helperEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4096) })
    const exited = new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (code === 0 || signal === 'SIGTERM') resolve()
        else reject(Object.assign(new Error(`Computer Use helper exited (${String(code ?? signal)})${stderr ? `: ${stderr.trim()}` : ''}`), { code: 'NATIVE_EXITED' }))
      })
    })
    void exited.catch(() => {})
    let killer: ReturnType<typeof setTimeout> | undefined
    return {
      stdin: child.stdin, stdout: child.stdout, done: exited,
      close() {
        if (child.exitCode !== null || killer) return
        child.stdin.end()
        killer = setTimeout(() => { child.kill() }, config.graceMs)
      },
      async waitForClose() {
        try { await exited } catch { /* reported through done */ } finally { clearTimeout(killer) }
      },
    }
  }
}

/** Settings readiness: supported here, and what the driver reports about permissions. */
export class ComputerUseStatusService extends TypertRemoteService {
  static inject = ['typert']
  constructor(ctx: Context, private readonly driverPath?: string) {
    super(ctx, 'computerUseStatus')
    ctx.typert.register(statusContribution)
  }

  get(): Promise<ComputerUseStatus> {
    const support = computerUseSupport()
    if (!support.supported) return Promise.resolve({ supported: false, platform: support.platform, reason: support.reason })
    const driver = resolveDriver(this.driverPath)
    if (driver === undefined) return Promise.resolve({ supported: false, platform: support.platform, reason: 'driver-missing' })
    return new Promise(resolve => {
      execFile(process.execPath, [helperPath(), driver, '--status'], { env: helperEnvironment(), timeout: 15_000, windowsHide: true }, (error, stdout) => {
        try {
          const report = JSON.parse(stdout.trim().split('\n').pop() ?? '') as { ok: boolean; permissions?: Record<string, unknown>; detail?: string; error?: string }
          if (report.ok) resolve({ supported: true, platform: support.platform, checks: report.permissions as ComputerUseStatus['checks'], ...report.detail ? { detail: report.detail } : {} })
          else resolve({ supported: false, platform: support.platform, reason: 'driver-failed', ...report.error ? { detail: report.error } : {} })
        } catch {
          resolve({ supported: false, platform: support.platform, reason: 'driver-failed', detail: error instanceof Error ? error.message : 'No readiness report' })
        }
      })
    })
  }
}

export function apply(ctx: Context, config: Config): void {
  ctx.inject(['typert'], scope => { scope.plugin(ComputerUseStatusService, config.driverPath) })
  const support = computerUseSupport()
  if (!support.supported) {
    ctx.logger('tpcowork-computer-use').info('电脑控制在此环境不可用：%s', support.reason)
    return
  }
  const driver = resolveDriver(config.driverPath)
  if (driver === undefined) {
    ctx.logger('tpcowork-computer-use').warn('电脑控制不可用：找不到 @trycua/cua-driver')
    return
  }
  if (!config.enabled) return
  installCua(ctx, config, { helperPath: helperPath(), createChannel: helperChannel(driver), guidance: guidance(support.platform), description: DESCRIPTION })
}
