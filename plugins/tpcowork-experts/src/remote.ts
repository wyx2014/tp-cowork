/** Browser-safe codecs for replayable progress and explicit run actions. */
import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, RemoteStreamHandle, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import type { TeamRunEvent } from '../../tpcowork-toolbox/src/contracts/teams.ts'
import { eventSchema, snapshotSchema } from './schema.ts'
const pkg = '@tpcowork/dsh-experts'
const id = z.string().min(1)
const descriptors: InvocationDescriptor[] = []
function endpoint(method: string, input: z.ZodType, output: z.ZodType, stream = false, cancellation = false) {
  descriptors.push({ id: `${pkg}#experts/${method}`, service: 'experts', namespace: 'experts', method, invocation: { kind: 'direct' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: `${pkg}#${method}-request`, create: () => input } }],
    ...(stream ? { mode: 'stream' as const } : {}), ...(stream || cancellation ? { cancellation: { parameter: 'signal' } } : {}),
    result: { mode: 'strict', typeSymbol: `${pkg}#${method}-result`, create: () => output } })
}
endpoint('snapshot', z.object({ sessionId: id }).strict(), snapshotSchema)
endpoint('cancel', z.object({ runId: id }).strict(), z.void())
endpoint('rerun', z.object({ sessionId: id }).strict(), z.void(), false, true)
endpoint('watch', z.object({ runId: id, afterSequence: z.number().int().nonnegative().optional() }).strict(), eventSchema, true)
export const remoteContribution: TypertRemoteContribution = { package: pkg, descriptors }
export const hostContribution: TypertContribution = { package: pkg, face: 'host', invocations: descriptors, schemas: [], model: { services: [], events: [], objects: [] } }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertClientRemote {
    experts: {
      snapshot(request: { sessionId: string }): Promise<RemoteResult<z.infer<typeof snapshotSchema>>>
      cancel(request: { runId: string }): Promise<RemoteResult<void>>
      rerun(request: { sessionId: string }, signal: AbortSignal): Promise<RemoteResult<void>>
      watch(request: { runId: string; afterSequence?: number }, signal: AbortSignal): RemoteStreamHandle<TeamRunEvent, never>
    }
  }
}
