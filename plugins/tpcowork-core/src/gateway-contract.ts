/** Private Host seam between account ownership and model routing; it has no Remote descriptor. */
import type {} from '@deepseek-ai/cordis'

export interface GatewayModelConnection {
  readonly baseURL: string
  readonly api: string
  readonly grantId: string
}

export interface ModelGateway {
  readonly status: string
  modelConnection(): GatewayModelConnection | null
  readModelKey(grantId: string): string | undefined
  clear(status?: string): void
  configure(value: unknown, expiresAt?: number): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context { tpcoworkGateway: ModelGateway }
}
