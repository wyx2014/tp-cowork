/** One invalidation stream per connection generation, owned by the plugin fiber. */
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import { changeFrameSchema } from '../remote.ts'
import type { ToolboxModel } from './model.ts'

export class ToolboxWatch {
  private stream: ReturnType<ClientRemote['$stream']> | undefined
  private pumping: Promise<void> | undefined
  private replacement: Promise<void> = Promise.resolve()
  private stopped = false
  constructor(private readonly remote: Pick<ClientRemote, '$stream' | 'toolboxChanges'>, private readonly model: ToolboxModel) { this.reconnect() }
  reconnect(): void {
    this.model.interrupted()
    this.replacement = this.replacement.then(async () => {
      await this.stream?.dispose(); await this.pumping
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
        frame.accept(); this.model.live()
        await this.model.refresh(value.type === 'ready' ? 'modules' : value.change.domain)
      }
    } catch (error) { if (!this.stopped) this.model.interrupted() }
  }
  async dispose(): Promise<void> {
    this.stopped = true
    this.model.dispose()
    await this.replacement
    await this.stream?.dispose(); await this.pumping
  }
}
