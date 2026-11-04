/** One invalidation stream per connection generation, owned by the plugin fiber. */
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import { changeFrameSchema } from '../remote.ts'
import type { ToolboxModel } from './model.ts'

const RETRY_FIRST_MS = 1000
const RETRY_LONGEST_MS = 30000

export class ToolboxWatch {
  private stream: ReturnType<ClientRemote['$stream']> | undefined
  private pumping: Promise<void> | undefined
  private replacement: Promise<void> = Promise.resolve()
  private stopped = false
  private retry: ReturnType<typeof setTimeout> | undefined
  private retryDelay = RETRY_FIRST_MS
  constructor(private readonly remote: Pick<ClientRemote, '$stream' | 'toolboxChanges'>, private readonly model: ToolboxModel) { this.reconnect() }
  reconnect(): void {
    clearTimeout(this.retry)
    this.model.interrupted()
    this.replacement = this.replacement.then(async () => {
      // Clear first: a stream closed on purpose must not count as a lost one.
      const previous = this.stream
      this.stream = undefined
      await previous?.dispose(); await this.pumping
      if (this.stopped) return
      const stream = this.remote.$stream({ name: 'toolbox changes', open: signal => this.remote.toolboxChanges.watch(signal), ended: () => new Error('toolbox changes ended') })
      this.stream = stream; this.pumping = this.pump(stream)
    }).catch(error => { void error; if (!this.stopped) this.model.interrupted() })
  }
  private async pump(stream: NonNullable<ToolboxWatch['stream']>): Promise<void> {
    try {
      for await (const frame of stream) {
        const value = changeFrameSchema.parse(frame.value)
        if (this.stopped || this.stream !== stream) return
        frame.accept(); this.model.live(); this.retryDelay = RETRY_FIRST_MS
        await this.model.refresh(value.type === 'ready' ? 'modules' : value.change.domain)
      }
    } catch (error) { void error }
    this.lost(stream)
  }
  /** The Host can restart this module without a connection reset, so a lost stream reopens itself. */
  private lost(stream: NonNullable<ToolboxWatch['stream']>): void {
    if (this.stopped || this.stream !== stream) return
    this.model.interrupted()
    this.retry = setTimeout(() => { this.reconnect() }, this.retryDelay)
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_LONGEST_MS)
  }
  async dispose(): Promise<void> {
    this.stopped = true
    clearTimeout(this.retry)
    this.model.dispose()
    await this.replacement
    await this.stream?.dispose(); await this.pumping
  }
}
