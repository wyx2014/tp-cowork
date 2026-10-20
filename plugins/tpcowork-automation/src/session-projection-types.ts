/** Client-safe declaration of the durable automation Session identity projection. */
import type {} from '@deepseek-ai/dsh-session-projection/types'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { tpcoworkAutomation: boolean }
  interface SessionProjectionStateMap { tpcoworkAutomation: { sessionId: string; owned: boolean } }
}
