/** T4 mounts this contribution on the existing Gateway Client. */
import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import type { McpApi } from '../../contracts/mcp.ts'
import { definitionSchema, idSchema, editorEntrySchema, importRequestSchema, draftProbeSchema } from './schema.ts'

const readiness = z.object({ state: z.enum(['unknown', 'checking', 'ready', 'blocked', 'error']), checkedAt: z.number().optional(), reasons: z.array(z.object({ code: z.string(), message: z.string() }).strict()) }).strict()
export const itemSchema = z.object({
  id: idSchema, label: z.string(), origin: z.enum(['bundled', 'custom']), configRevision: z.number().int().positive(), installed: z.boolean(), enabled: z.boolean(), readiness,
  connection: z.enum(['unknown', 'disconnected', 'connecting', 'connected', 'reconnecting', 'error']), generation: z.number().int().nonnegative(), toolCount: z.number().int().nonnegative(), observedAt: z.number().optional(),
  credentials: z.array(z.object({ ref: z.string(), configured: z.boolean(), writable: z.boolean() }).strict()),
}).strict()
const catalog = z.object({ revision: z.number().int().nonnegative(), complete: z.boolean(), items: z.array(itemSchema) }).strict()
const packageName = '@tpcowork/dsh-toolbox-mcp'
const idRequest = z.object({ id: idSchema }).strict()
const revision = { expectedRevision: z.number().int().nonnegative() }
function descriptor(method: string, input: z.ZodType | undefined, output: z.ZodType, cancel = false): InvocationDescriptor {
  return { id: `${packageName}#toolboxMcp/${method}`, service: 'toolboxMcp', namespace: 'toolboxMcp', method, invocation: { kind: 'direct' },
    parameters: input ? [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: `${packageName}#${method}-request`, create: () => input } }] : [],
    ...(cancel ? { cancellation: { parameter: 'signal' } } : {}),
    result: { mode: 'strict', typeSymbol: `${packageName}#${method}-result`, create: () => output },
  }
}
export const descriptors = [
  descriptor('inventory', undefined, catalog), descriptor('definition', idRequest, definitionSchema),
  ...['create', 'update'].map(method => descriptor(method, editorEntrySchema.extend(revision), itemSchema)),
  descriptor('importDefinitions', importRequestSchema, catalog),
  descriptor('probeDraft', editorEntrySchema, draftProbeSchema, true),
  descriptor('remove', idRequest.extend(revision), z.void()),
  descriptor('setEnabled', idRequest.extend({ ...revision, enabled: z.boolean() }), itemSchema),
  descriptor('probe', idRequest, itemSchema, true),
]
export const remoteContribution: TypertRemoteContribution = { package: packageName, descriptors }
export const hostContribution: TypertContribution = { package: packageName, face: 'host', invocations: descriptors, schemas: [], model: { services: [], objects: [], events: [] } }
type RemoteApi<T> = { [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => Promise<RemoteResult<R>> : never }
declare module '@deepseek-ai/dsh-typert-protocol' { interface TypertClientRemote { toolboxMcp: RemoteApi<McpApi> } }
