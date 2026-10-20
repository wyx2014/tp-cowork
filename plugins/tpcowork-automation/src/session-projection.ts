/** Recover sidebar attribution from original ownership markers, including old runs. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from './session-projection-types.ts'
import { z } from 'zod'
import { readAutomationOwnership } from './executor.ts'

/** Register a pure projection; no Session history or task definition is rewritten. */
export function registerAutomationSessionProjection(ctx: Context): void {
  ctx.sessionProjections.register({
    key: 'tpcoworkAutomation',
    stateSchema: z.object({ sessionId: z.string(), owned: z.boolean() }),
    stateVersion: 1,
    init: header => ({ sessionId: header.id, owned: false }),
    apply: (state, event) => {
      if (state.owned) return state
      const owner = readAutomationOwnership([event])
      return owner?.sessionId === state.sessionId ? { ...state, owned: true } : state
    },
    wire: { viewSchema: z.boolean(), view: state => state.owned },
  })
}
