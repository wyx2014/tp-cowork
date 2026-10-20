import type { Context } from '@deepseek-ai/cordis'
import type { ChangeFrame } from './contracts/index.ts'

/** Bounded invalidation stream. Durable team progress uses ExpertsApi.watch with sequence replay. */
export async function* watchChanges(ctx: Context, signal: AbortSignal): AsyncIterable<ChangeFrame> {
  const lifetime = new AbortController()
  const release = ctx.effect(() => () => lifetime.abort())
  const active = AbortSignal.any([signal, lifetime.signal])
  let latest: ChangeFrame | undefined
  let wake: (() => void) | undefined
  const dispose = ctx.on('toolbox/changed', change => { latest = { type: 'changed', change }; wake?.() })
  const abort = () => wake?.()
  active.addEventListener('abort', abort, { once: true })
  try {
    if (active.aborted) return
    yield { type: 'ready' }
    while (!active.aborted) {
      if (latest) { const frame = latest; latest = undefined; yield frame; continue }
      await new Promise<void>(resolve => { wake = resolve })
      wake = undefined
    }
  } finally { active.removeEventListener('abort', abort); dispose(); await release() }
}
