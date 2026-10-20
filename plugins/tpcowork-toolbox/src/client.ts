import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { ToolboxApi } from './contracts/index.ts'
import { descriptionSchema, remoteContribution } from './remote.ts'
import { registerToolboxUi, uiDependencies } from './ui/index.tsx'
import { managementContribution, skillsContribution } from './client/remote.ts'
export type * from './contracts/index.ts'
declare module '@deepseek-ai/cordis' { interface Context { toolbox: ToolboxApi } }
export const name = 'tpcowork-toolbox-client'
export const inject = ['remote']
export function createClient(remote: TypertClientRemote['toolbox']): ToolboxApi {
  return { async describe() {
    const result = await remote.describe()
    if (!result.ok) throw result.error
    return descriptionSchema.parse(result.value)
  } }
}
export async function apply(ctx: Context): Promise<void> {
  const dispose = await ctx.remote.$mount(remoteContribution)
  ctx.effect(() => dispose)
  for (const contribution of [skillsContribution, managementContribution]) {
    const release = await ctx.remote.$mount(contribution)
    ctx.effect(() => release)
  }
  await ctx.inject(['remote.toolbox'], inner => { inner.provide('toolbox', createClient(inner.remote.toolbox)) })
  ctx.inject(uiDependencies, registerToolboxUi)
}
