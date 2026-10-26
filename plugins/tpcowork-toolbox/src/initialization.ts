import type { Context } from '@deepseek-ai/cordis'
import type { InitializationIssue, ToolboxInitialization } from './contracts/index.ts'
import { SkillError } from './host/installer/errors.ts'

/** Keep OS failure codes useful without returning paths, error messages or secret values. */
export function initializationCode(error: unknown): string {
  if (error instanceof SkillError) return error.code
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    && ['EACCES', 'EPERM', 'EBUSY', 'ENOENT', 'ENOSPC', 'ENOTDIR', 'EIO', 'EROFS'].includes(error.code)) return `filesystem/${error.code}`
  return 'toolbox/initialization-failed'
}

declare module '@deepseek-ai/cordis' { interface Context { toolboxInitialization: DefaultInitialization } }

/** One in-flight attempt per dependency scope; teardown cancels and joins owned work. */
export class DefaultInitialization {
  private value: ToolboxInitialization = { state: 'pending', issues: [] }
  private pending: Promise<void> | undefined
  private revision = 0
  private readonly lifetime = new AbortController()
  constructor(private readonly ctx: Context, private readonly work: (signal: AbortSignal) => Promise<InitializationIssue[]>) {
    ctx.effect(() => async () => { this.lifetime.abort(); await this.pending })
  }
  describe(): ToolboxInitialization { return structuredClone(this.value) }
  private publish(value: ToolboxInitialization): void {
    if (this.lifetime.signal.aborted) return
    this.value = value
    this.ctx.emit('toolbox/changed', { domain: 'modules', revision: ++this.revision })
  }
  retry(): Promise<void> {
    if (this.lifetime.signal.aborted) return Promise.reject(new Error('toolbox/initialization-disposed'))
    if (this.pending) return this.pending
    this.publish({ state: 'running', issues: [] })
    this.pending = Promise.resolve().then(async () => {
      try {
        const issues = await this.work(this.lifetime.signal)
        this.publish({ state: issues.length ? 'failed' : 'ready', issues })
      } catch (error) {
        this.publish({ state: 'failed', issues: [{ kind: 'settings', resourceId: 'defaults', code: initializationCode(error) }] })
      }
    }).finally(() => { this.pending = undefined })
    return this.pending
  }
}
