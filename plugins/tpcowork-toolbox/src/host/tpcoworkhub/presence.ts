export const HEARTBEAT_PATH = '/tpcoworkapi/client/heartbeat'
export const OFFLINE_PATH = '/tpcoworkapi/client/offline'
export const DEFAULT_HEARTBEAT_INTERVAL_SEC = 60
export const MIN_HEARTBEAT_INTERVAL_SEC = 10
export const MAX_HEARTBEAT_INTERVAL_SEC = 300
export const HEARTBEAT_JITTER_MS = 5_000
export const HEARTBEAT_TIMEOUT_MS = 10_000
export const OFFLINE_TIMEOUT_MS = 2_000

export interface PresenceSession {
  readonly endpoint: string
  readonly token: string
  readonly userId?: string
}

export interface PresenceControllerOptions {
  sendHeartbeat(session: PresenceSession, signal: AbortSignal): Promise<unknown>
  sendOffline(session: PresenceSession, signal: AbortSignal): Promise<void>
  isAuthExpiredError?: (error: unknown) => boolean
  random?: () => number
  heartbeatTimeoutMs?: number
  offlineTimeoutMs?: number
  log?: (level: 'warn' | 'debug', message: string) => void
}

/** Parse and clamp `nextIntervalSec` returned by the SkillHub heartbeat endpoint. */
export function parseHeartbeatIntervalSec(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const raw = (payload as { nextIntervalSec?: unknown }).nextIntervalSec
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined
  return Math.min(MAX_HEARTBEAT_INTERVAL_SEC, Math.max(MIN_HEARTBEAT_INTERVAL_SEC, Math.round(raw)))
}

/** Compute the next heartbeat delay in milliseconds with symmetric ±5s jitter. */
export function nextHeartbeatDelayMs(
  intervalSec: number = DEFAULT_HEARTBEAT_INTERVAL_SEC,
  random: () => number = Math.random,
): number {
  const baseSec = Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : DEFAULT_HEARTBEAT_INTERVAL_SEC
  const clampedSec = Math.min(MAX_HEARTBEAT_INTERVAL_SEC, Math.max(MIN_HEARTBEAT_INTERVAL_SEC, baseSec))
  const sample = random()
  const unit = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.5
  const jitterMs = Math.round((unit * 2 - 1) * HEARTBEAT_JITTER_MS)
  return Math.max(1_000, clampedSec * 1_000 + jitterMs)
}

function safeErrorSummary(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  if (error instanceof Error && error.name) return error.name
  return 'unknown-error'
}

/** Manages immediate/periodic SkillHub presence heartbeats and best-effort offline notifications. */
export class PresenceController {
  private current: PresenceSession | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlightHeartbeat: { controller: AbortController; promise: Promise<void> } | undefined
  private readonly pendingOffline = new Set<Promise<void>>()
  private generation = 0
  private intervalSec = DEFAULT_HEARTBEAT_INTERVAL_SEC
  private consecutiveFailures = 0
  private disposed = false

  constructor(private readonly options: PresenceControllerOptions) {}

  activeSession(): PresenceSession | undefined {
    return this.current
  }

  /** Synchronize heartbeat tracking with the active session; sends `/offline` only on account or endpoint switches. */
  sync(next: PresenceSession | undefined): void {
    if (this.disposed) return
    if (!next) {
      this.stop()
      return
    }
    if (this.current
      && this.current.endpoint === next.endpoint
      && this.current.token === next.token
      && this.current.userId === next.userId) {
      return
    }
    const prev = this.current
    const switched = prev !== undefined && (prev.endpoint !== next.endpoint || prev.userId !== next.userId)
    this.stop()
    if (switched) void this.dispatchOffline(prev)
    this.current = next
    this.intervalSec = DEFAULT_HEARTBEAT_INTERVAL_SEC
    this.consecutiveFailures = 0
    const gen = ++this.generation
    void this.beat(next, gen)
  }

  /** Stop timers and abort any in-flight heartbeat without sending `/offline`. */
  stop(): void {
    this.generation++
    this.current = undefined
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.inFlightHeartbeat !== undefined) {
      this.inFlightHeartbeat.controller.abort()
      this.inFlightHeartbeat = undefined
    }
  }

  /** Stop heartbeats and send a best-effort short-timeout `/offline` notification. */
  async goOffline(explicitSession?: PresenceSession): Promise<void> {
    const target = explicitSession ?? this.current
    const prevBeat = this.inFlightHeartbeat?.promise
    this.stop()
    const tasks: Promise<void>[] = [...this.pendingOffline]
    if (prevBeat) tasks.push(prevBeat)
    if (target) tasks.push(this.dispatchOffline(target))
    await Promise.allSettled(tasks)
  }

  /** Dispose the controller and wait for best-effort offline reporting to settle. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.goOffline()
  }

  private schedule(session: PresenceSession, gen: number): void {
    if (this.disposed || gen !== this.generation) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    const delayMs = nextHeartbeatDelayMs(this.intervalSec, this.options.random)
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.disposed || gen !== this.generation) return
      void this.beat(session, gen)
    }, delayMs)
    this.timer.unref?.()
  }

  private async beat(session: PresenceSession, gen: number): Promise<void> {
    if (this.disposed || gen !== this.generation) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS)])
    const promise = (async () => {
      try {
        const result = await this.options.sendHeartbeat(session, signal)
        if (this.disposed || gen !== this.generation || controller.signal.aborted) return
        this.consecutiveFailures = 0
        const nextInterval = parseHeartbeatIntervalSec(result)
        if (nextInterval !== undefined) this.intervalSec = nextInterval
        this.schedule(session, gen)
      } catch (error) {
        if (this.disposed || gen !== this.generation || controller.signal.aborted) return
        if (this.options.isAuthExpiredError?.(error)) {
          this.options.log?.('debug', 'TP Cowork Hub heartbeat stopped after session expiration.')
          this.stop()
          return
        }
        this.consecutiveFailures++
        const level = this.consecutiveFailures === 1 ? 'warn' : 'debug'
        this.options.log?.(level, `TP Cowork Hub heartbeat failed (${safeErrorSummary(error)}); retrying on schedule.`)
        this.schedule(session, gen)
      }
    })().finally(() => {
      if (this.inFlightHeartbeat?.controller === controller) this.inFlightHeartbeat = undefined
    })
    this.inFlightHeartbeat = { controller, promise }
    await promise
  }

  private dispatchOffline(session: PresenceSession): Promise<void> {
    const signal = AbortSignal.timeout(this.options.offlineTimeoutMs ?? OFFLINE_TIMEOUT_MS)
    const pending = (async () => {
      try {
        await this.options.sendOffline(session, signal)
      } catch (error) {
        this.options.log?.('debug', `TP Cowork Hub offline notification failed (${safeErrorSummary(error)}).`)
      }
    })().finally(() => {
      this.pendingOffline.delete(pending)
    })
    this.pendingOffline.add(pending)
    return pending
  }
}
