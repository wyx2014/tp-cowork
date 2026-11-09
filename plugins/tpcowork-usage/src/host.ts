/**
 * Host service for Usage Stats. Every appended session event is folded into that session's stored rows, and opening the
 * page sums rows already on disk. The stored rows are a cache: a session missing from them (history from before the
 * plugin ran, while it was disabled, or after the file was lost or set aside) is rebuilt once from its own session log,
 * so statistics survive reinstalls and restarts as long as the sessions do.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { aggregate, applyEvent, emptyLog, recordsOf, type UsageEvent } from './aggregate.ts'
import { UsageStore } from './store.ts'
import { hostContribution } from './remote.ts'
import { usageRequestSchema, type UsageServiceApi, type UsageSnapshot, type UsageRequest } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { usage: UsageServiceApi }
}
/** Only these events change usage. */
const COUNTED = new Set(['request/header', 'turn/start', 'turn/end', 'tool/call', 'assistant/message'])
/** Session logs read at once while rebuilding missing sessions. */
const REBUILD_CONCURRENCY = 4

export class UsageService extends TypertRemoteService implements UsageServiceApi {
  private readonly store: UsageStore
  /** One rebuild per session id, shared by live events and the startup pass. */
  private readonly rebuilding = new Map<string, Promise<void>>()
  private rebuilt: Promise<void> | undefined

  constructor(ctx: Context) {
    super(ctx, 'usage')
    this.store = new UsageStore(resolveDshHome(), message => ctx.logger.warn('用量统计：%s', message))
    ctx.effect(() => ctx.typert.register(hostContribution))
    ctx.on('session/event', (session, event) => { void this.record(session.id, event) })
    // The final write must land before the Host exits or a reloaded instance reads the file.
    ctx.effect(() => () => this.store.flush(), 'tpcowork-usage.store')
  }

  /** Fold one live event into its session's rows; a session seen for the first time is first rebuilt from its log. */
  private async record(id: string, event: UsageEvent): Promise<void> {
    if (!COUNTED.has(event.type)) return
    await this.store.load()
    await this.rebuild(id)
    const stored = this.store.get(id)
    // The rebuilt log may already contain this event; its seq makes the fold a no-op then.
    if (stored) { applyEvent(stored, event); this.store.touch(); return }
    const log = emptyLog()
    applyEvent(log, event)
    this.store.set(id, log)
  }

  /** Rebuild one session missing from the stored rows from its own log, skipping events a fork inherited. */
  private rebuild(id: string): Promise<void> {
    if (this.store.has(id)) return Promise.resolve()
    let pending = this.rebuilding.get(id)
    if (pending === undefined) {
      pending = (async () => {
        const query = this.ctx.get('sessionQuery')
        if (query === undefined) return
        try {
          const snapshot = await query.readSession(id as SessionId)
          if (this.store.has(id)) return
          const log = recordsOf(snapshot.events as unknown as UsageEvent[], Number(snapshot.inheritedEventCount))
          this.store.set(id, log)
        } catch (error) {
          // A session that cannot be read (deleted, needs migration) keeps counting from live events only.
          this.ctx.logger.debug('用量统计：无法从会话记录重建 %s：%s', id, error instanceof Error ? error.message : String(error))
        }
      })().finally(() => { this.rebuilding.delete(id) })
      this.rebuilding.set(id, pending)
    }
    return pending
  }

  /** Once per Host run, rebuild every listed session missing from the stored rows. */
  private rebuildAll(): Promise<void> {
    return this.rebuilt ??= (async () => {
      const query = this.ctx.get('sessionQuery')
      if (query === undefined) return
      let ids: string[]
      try { ids = (await query.listSessions()).map(record => record.header.id).filter(id => !this.store.has(id)) }
      catch (error) { this.ctx.logger.warn('用量统计：无法列出会话，跳过重建：%s', error instanceof Error ? error.message : String(error)); return }
      for (let index = 0; index < ids.length; index += REBUILD_CONCURRENCY) {
        await Promise.all(ids.slice(index, index + REBUILD_CONCURRENCY).map(id => this.rebuild(id)))
      }
    })()
  }

  async get(input: UsageRequest): Promise<UsageSnapshot> {
    const request = usageRequestSchema.parse(input)
    await this.store.load()
    await this.rebuildAll()
    const timeZone = request.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    return aggregate([...this.store.values()], request.range, timeZone, Date.now())
  }
}

/** Mount the service once the typert registry exists. */
export default {
  name: 'tpcowork-usage-host', inject: ['typert'],
  async apply(ctx: Context): Promise<void> { await ctx.plugin(UsageService) },
}
