/** Typert contribution for the single `usage.get` endpoint, shared by Host and Client. */
import type { InvocationDescriptor, TypertCodec, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import type { ZodType } from 'zod'
import { usageRequestSchema, usageSnapshotSchema } from './types.ts'

const packageName = '@tpcowork/dsh-usage'
function codec(name: string, schema: ZodType): TypertCodec {
  return { mode: 'strict', typeSymbol: `${packageName}/types#${name}`, create: () => schema }
}
export const descriptor: InvocationDescriptor = {
  id: `${packageName}#usage/get`, service: 'usage', namespace: 'usage', method: 'get', invocation: { kind: 'direct' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: codec('UsageRequest', usageRequestSchema) }],
  result: codec('UsageSnapshot', usageSnapshotSchema),
}
export const remoteContribution: TypertRemoteContribution = { package: packageName, descriptors: [descriptor] }
export const hostContribution: TypertContribution = {
  package: packageName, face: 'host', invocations: [descriptor],
  schemas: [{ name: 'UsageRequest', create: () => usageRequestSchema }, { name: 'UsageSnapshot', create: () => usageSnapshotSchema }],
  model: { services: [], events: [], objects: [] },
}
export default remoteContribution
