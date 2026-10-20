/** Explicit Typert contribution for an out-of-tree plugin; shared schemas avoid generated-source drift. */
import type { InvocationDescriptor, TypertCodec, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import type { ZodType } from 'zod'
import { z } from 'zod'
import { parseInput } from './errors.ts'
import { createSchema, payloadSchema, runRequestSchema, taskRequestSchema, updateSchema } from './schemas.ts'
import type { AutomationServiceApi } from './types.ts'
import { changesDescriptor } from './changes.ts'
export type { ChangeFrame } from './changes.ts'

const packageName = '@tpcowork/dsh-automation'
function codec(name: string, schema: ZodType, input = false): TypertCodec {
  return { mode: 'strict', typeSymbol: `${packageName}/types#${name}`,
    create: () => input ? { parse: value => parseInput(schema, value) } : schema }
}
const methods: Array<[keyof AutomationServiceApi, ZodType | undefined]> = [
  ['list', undefined], ['create', createSchema], ['update', updateSchema], ['delete', taskRequestSchema],
  ['pause', taskRequestSchema], ['resume', taskRequestSchema], ['runNow', taskRequestSchema],
  ['markRunViewed', runRequestSchema], ['deleteRun', runRequestSchema],
]
/** Both Host and Client mount these nine validated endpoints on the existing Gateway carrier. */
export const descriptors: readonly InvocationDescriptor[] = methods.map(([method, schema]) => ({
  id: `${packageName}#automation/${method}`, service: 'automation', namespace: 'automation', method,
  invocation: { kind: 'direct' },
  parameters: schema ? [{ name: 'request', wire: 'request', source: 'json', codec: codec(`${method}Request`, schema, true) }] : [],
  result: codec('ScheduleTasksPayload', payloadSchema),
}))
const migrationDescriptor: InvocationDescriptor = {
  id: `${packageName}#automationMigration/migrate`, service: 'automationMigration', namespace: 'automationMigration', method: 'migrate',
  invocation: { kind: 'direct' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: codec('MigrationConfirmation', z.object({ confirm: z.literal(true) }).strict()) }],
  result: codec('ScheduleTasksPayload', payloadSchema),
}
export const remoteContribution: TypertRemoteContribution = { package: packageName, descriptors: [...descriptors, changesDescriptor, migrationDescriptor] }
/** Registered by the service itself; no ./typert export means the loader cannot register it a second time. */
export const hostContribution: TypertContribution = {
  // Gateway checks JSON safety, then the Host method parses the shared schema itself.
  // This preserves specific domain error codes that Gateway codec failures would replace.
  package: packageName, face: 'host', invocations: [...descriptors.map(descriptor => ({ ...descriptor,
    parameters: descriptor.parameters.map(parameter => ({ ...parameter, codec: codec('AutomationRequestJson', z.unknown()) })),
  })), changesDescriptor, migrationDescriptor],
  schemas: [{ name: 'ScheduleTasksPayload', create: () => payloadSchema },
    ...methods.flatMap(([method, schema]) => schema ? [{ name: `${method}Request`, create: () => schema }] : []),
  ],
  model: { services: [], events: [], objects: [] },
}
export default remoteContribution
