/** Read-only invalidations carried by the existing Gateway stream, without another catalog or scheduler. */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { InvocationDescriptor, RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol'
import type { AutomationChanged } from './types.ts'
import { taskIdSchema, runIdSchema } from './schemas.ts'

export const changeFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('changed'), change: z.object({
    revision: z.number().int().positive(), taskId: taskIdSchema, runId: runIdSchema.optional(),
    reason: z.enum(['created', 'updated', 'deleted', 'paused', 'resumed', 'run_started', 'run_bound', 'run_finished', 'run_viewed', 'run_deleted', 'rearmed']),
  }) }),
])
export type ChangeFrame = { type: 'ready' } | { type: 'changed'; change: AutomationChanged }

declare module '@deepseek-ai/cordis' {
  interface Context { automationChanges: { watch(signal: AbortSignal): AsyncIterable<ChangeFrame> } }
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertClientRemote { automationChanges: { watch(signal: AbortSignal): RemoteStreamHandle<ChangeFrame, never> } }
}

/** Cancellation removes the Host listener, even while an idle consumer is awaiting its next invalidation. */
export function watchChanges(ctx: Context, signal: AbortSignal): AsyncIterable<ChangeFrame> {
  return (async function* () {
    const lifetime = new AbortController()
    const release = ctx.effect(() => () => lifetime.abort())
    const active = AbortSignal.any([signal, lifetime.signal])
    let latest: AutomationChanged | undefined
    let wake: (() => void) | undefined
    // Invalidations can coalesce: the consumer always rereads the authoritative catalog.
    const dispose = ctx.on('automation/changed', change => { latest = change; wake?.() })
    const abort = () => { wake?.() }
    active.addEventListener('abort', abort, { once: true })
    try {
      if (active.aborted) return
      yield { type: 'ready' }
      while (!active.aborted) {
        if (latest) { const change = latest; latest = undefined; yield { type: 'changed', change }; continue }
        await new Promise<void>(resolve => { wake = resolve })
        wake = undefined
      }
    } finally { active.removeEventListener('abort', abort); dispose(); await release() }
  })()
}

/** Additional read-only stream; the nine management endpoints retain their existing signatures. */
export const changesDescriptor: InvocationDescriptor = {
  id: '@tpcowork/dsh-automation#automationChanges/watch', service: 'automationChanges', namespace: 'automationChanges', method: 'watch',
  mode: 'stream', invocation: { kind: 'direct' }, parameters: [], cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: '@tpcowork/dsh-automation/changes#ChangeFrame', create: () => changeFrameSchema },
}
