/**
 * Host service for Usage Stats. Like the reference product, usage is recorded only as it happens: every appended session
 * event is folded into that session's stored rows, and opening the page only sums rows already on disk. Session logs are
 * never read, so history from before the plugin was installed (or while it was disabled) is not counted.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { aggregate, applyEvent, emptyLog, type UsageEvent } from './aggregate.ts'
import { UsageStore } from './store.ts'
import { hostContribution } from './remote.ts'
import { usageRequestSchema, type UsageServiceApi, type UsageSnapshot, type UsageRequest } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { usage: UsageServiceApi }
}
/** Only these events change usage. */
const COUNTED = new Set(['request/header', 'turn/start', 'turn/end', 'tool/call', 'assistant/message'])

export class UsageService extends TypertRemoteService implements UsageServiceApi {
  private readonly store: UsageStore

  constructor(ctx: Context) {
    super(ctx, 'usage')
    this.store = new UsageStore(resolveDshHome(), message => ctx.logger.warn('用量统计：%s', message))
    ctx.effect(() => ctx.typert.register(hostContribution))
    ctx.on('session/event', (session, event) => { void this.record(session.id, event) })
    ctx.effect(() => () => { void this.store.flush() }, 'tpcowork-usage.store')
  }

  /** Fold one live event into its session's rows; a session seen for the first time starts empty. */
  private async record(id: string, event: UsageEvent): Promise<void> {
    if (!COUNTED.has(event.type)) return
    await this.store.load()
    const stored = this.store.get(id)
    if (stored) { applyEvent(stored, event); this.store.touch(); return }
    const log = emptyLog()
    applyEvent(log, event)
    this.store.set(id, log)
  }

  async get(input: UsageRequest): Promise<UsageSnapshot> {
    const request = usageRequestSchema.parse(input)
    await this.store.load()
    const timeZone = request.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    return aggregate([...this.store.values()], request.range, timeZone, Date.now())
  }
}

/** Mount the service once the typert registry exists. */
export default {
  name: 'tpcowork-usage-host', inject: ['typert'],
  async apply(ctx: Context): Promise<void> { await ctx.plugin(UsageService) },
}
