/** Private Host seam between account ownership and model routing; it has no Remote descriptor. */
import type {} from '@deepseek-ai/cordis'

export interface ModelGateway {
  readonly status: string
  clear(status?: string): void
  configure(value: unknown, expiresAt?: number): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context { tpcoworkGateway: ModelGateway }
}
