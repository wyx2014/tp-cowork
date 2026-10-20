/** Client facade delegates every mutation to the Host; it owns no data files, execution loop or timers. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { remoteContribution } from './remote.ts'
import { payloadSchema } from './schemas.ts'
import type { AutomationRemoteApi, AutomationServiceApi, ScheduleTasksPayload } from './types.ts'
import { bindingsRemote } from './bindings-remote.ts'
import { registerAutomationUi, uiDependencies } from './ui.tsx'
export type * from './types.ts'
export type { ChangeFrame } from './changes.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { automation: AutomationServiceApi }
}
export const name = 'tpcowork-automation-client'
export const inject = ['remote']

/** Build a thin facade suitable for form stores and transport tests. */
export function createClient(remote: AutomationRemoteApi): AutomationServiceApi {
  let generation = 0
  let mutations: Promise<unknown> = Promise.resolve()
  async function unwrap(call: Promise<RemoteResult<ScheduleTasksPayload>>): Promise<ScheduleTasksPayload> {
    const result = await call
    if (!result.ok) throw result.error
    return payloadSchema.parse(result.value)
  }
  function mutate(call: () => Promise<RemoteResult<ScheduleTasksPayload>>): Promise<ScheduleTasksPayload> {
    generation++
    const result = mutations.catch(() => {}).then(() => unwrap(call()))
    mutations = result
    return result
  }
  async function list(): Promise<ScheduleTasksPayload> {
    for (;;) {
      const observed = generation
      await mutations.catch(() => {})
      const catalog = await unwrap(remote.list())
      // An acknowledgement/delete raced this poll. Refresh after the durable write before exposing a catalog.
      if (observed === generation) return catalog
    }
  }
  return {
    list, create: request => mutate(() => remote.create(request)),
    update: request => mutate(() => remote.update(request)), delete: request => mutate(() => remote.delete(request)),
    pause: request => mutate(() => remote.pause(request)), resume: request => mutate(() => remote.resume(request)),
    runNow: request => mutate(() => remote.runNow(request)), markRunViewed: request => mutate(() => remote.markRunViewed(request)),
    deleteRun: request => mutate(() => remote.deleteRun(request)),
  }
}

/** Namespace/service registrations are withdrawn with the Client plugin fiber. */
export async function apply(ctx: Context): Promise<void> {
  const dispose = await ctx.remote.$mount(remoteContribution)
  ctx.effect(() => dispose)
  const disposeBindings = await ctx.remote.$mount(bindingsRemote)
  ctx.effect(() => disposeBindings)
  const fiber = ctx.inject(['remote.automation'], clientCtx => {
    clientCtx.provide('automation', createClient(clientCtx.remote.automation))
  })
  await fiber
  ctx.inject(uiDependencies, uiCtx => { registerAutomationUi(uiCtx, uiCtx.remote) })
}
