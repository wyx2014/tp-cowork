/** Team presentation uses DSH's native workflow, tasks and child navigation. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import { remoteContribution } from '../../tpcowork-experts/src/remote.ts'

export const name = 'tpcowork-experts-client'
export const inject = ['remote']
export async function apply(ctx: Context): Promise<void> {
  const dispose = await ctx.remote.$mount(remoteContribution)
  ctx.effect(() => dispose)
}
