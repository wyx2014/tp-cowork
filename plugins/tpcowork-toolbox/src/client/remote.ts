/** Browser-only endpoint contributions; API signatures remain owned by contracts. */
import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { McpApi, TpcoworkHubApi, SkillsApi, TaskSubmissionApi, TeamsApi, SkillItem } from '../contracts/index.ts'
import { remoteContribution as skillsContribution } from '../host/skills/remote.ts'
import type { InstallerModuleApi } from '../host/skills/remote.ts'
// Pure public schema: Host permits incomplete stored definitions for editing.
import { definitionSchema as definition, editorEntrySchema, importRequestSchema, draftProbeSchema } from '../host/mcp/schema.ts'
import { descriptors as hubDescriptors } from '../host/tpcoworkhub/remote.ts'

export { skillsContribution }
export type SkillsClientApi = SkillsApi & { detail(request: { id: string; sessionId?: string }): Promise<{ item: SkillItem; content: string }> }
export type InstallerClientApi = InstallerModuleApi
type RemoteApi<T> = { [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => Promise<RemoteResult<R>> : never }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertClientRemote {
    toolboxMcp: RemoteApi<McpApi>
    toolboxTeams: RemoteApi<TeamsApi>
    toolboxTpcoworkHub: RemoteApi<TpcoworkHubApi>
    toolboxTasks: RemoteApi<TaskSubmissionApi>
  }
}
const id = z.string().min(1)
const revision = z.number().int().nonnegative()
const readiness = z.object({ state: z.enum(['unknown', 'checking', 'ready', 'blocked', 'error']), checkedAt: z.number().optional(), reasons: z.array(z.object({ code: z.string(), message: z.string() })) })
const mcp = z.object({ id, label: z.string(), origin: z.enum(['bundled', 'custom']), configRevision: revision, installed: z.boolean(), enabled: z.boolean(), readiness, connection: z.enum(['unknown', 'disconnected', 'connecting', 'connected', 'reconnecting', 'error']), generation: revision, toolCount: revision, observedAt: z.number().optional(), credentials: z.array(z.object({ ref: id, configured: z.boolean(), writable: z.boolean() })) })
const teamRef = z.object({ id, version: id, workflowId: id }).strict()
const team = teamRef.extend({ name: z.string(), enabled: z.boolean(), members: z.array(z.object({ id, name: z.string(), phase: z.string().optional(), goal: z.string().optional() })), requiredSkillIds: z.array(id), optionalMcpIds: z.array(id), readiness })
const skill = z.object({ id, name: z.string(), description: z.string(), origin: z.enum(['bundled', 'user', 'project', 'tpcoworkhub']), provider: z.string(), version: z.string(), fingerprint: z.string(), installed: z.boolean(), enabled: z.boolean(), invocation: z.object({ modelInvocable: z.boolean(), userInvocable: z.boolean() }), readiness, resources: z.array(z.string()), path: z.string().optional(), managed: z.boolean().optional() })
const catalog = <T extends z.ZodType>(item: T) => z.object({ revision, complete: z.boolean(), items: z.array(item) }).strict()
const context = z.object({ schemaVersion: z.literal(1), taskId: id, sessionId: id, submittedAt: z.number(), catalogRevision: revision, team: teamRef.nullable(), skills: z.array(z.object({ id, version: z.string(), fingerprint: z.string() })), mcp: z.array(z.object({ id, configRevision: revision })) }).strict()
const selection = z.object({ expectedRevision: revision, team: teamRef.nullable(), skillIds: z.array(id), mcpIds: z.array(id) }).strict()
const itemRequest = z.object({ id }).strict()
const descriptors: InvocationDescriptor[] = []
function endpoint(service: string, method: string, input: z.ZodType | null, output: z.ZodType, cancellable = false) {
  descriptors.push({ id: `@tpcowork/dsh-toolbox-client#${service}/${method}`, service, namespace: service, method, invocation: { kind: 'direct' },
    parameters: input ? [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: `toolbox-client#${service}-${method}-request`, create: () => input } }] : [],
    ...(cancellable ? { cancellation: { parameter: 'signal' } } : {}),
    result: { mode: 'strict', typeSymbol: `toolbox-client#${service}-${method}-result`, create: () => output },
  })
}
endpoint('toolboxMcp', 'inventory', null, catalog(mcp))
endpoint('toolboxMcp', 'definition', itemRequest, definition)
for (const method of ['create', 'update']) endpoint('toolboxMcp', method, editorEntrySchema.extend({ expectedRevision: revision }), mcp)
endpoint('toolboxMcp', 'importDefinitions', importRequestSchema, catalog(mcp))
endpoint('toolboxMcp', 'probeDraft', editorEntrySchema, draftProbeSchema, true)
endpoint('toolboxMcp', 'remove', itemRequest.extend({ expectedRevision: revision }), z.void())
endpoint('toolboxMcp', 'setEnabled', itemRequest.extend({ expectedRevision: revision, enabled: z.boolean() }), mcp)
endpoint('toolboxMcp', 'probe', itemRequest, mcp, true)
endpoint('toolboxTeams', 'inventory', null, catalog(team))
endpoint('toolboxTasks', 'selection', z.object({ sessionId: id }).strict(), z.object({ revision, skills: catalog(skill), mcp: catalog(mcp), teams: catalog(team) }).strict())
endpoint('toolboxTasks', 'context', z.object({ sessionId: id, taskId: id }).strict(), context.nullable())
// The native request's content is validated by the DSH Host attachment intake.
endpoint('toolboxTasks', 'submit', z.object({ message: z.object({ requestId: id, sessionId: id, mode: z.enum(['queue', 'steer']), content: z.array(z.unknown()), clientTimeZone: z.string().optional() }).strict(), selection }).strict(), z.object({ accepted: z.literal(true), context, runId: id.optional() }).strict(), true)
// T5 owns these codecs; mount them once with the existing management facade.
descriptors.push(...hubDescriptors)
export const managementContribution: TypertRemoteContribution = { package: '@tpcowork/dsh-toolbox-client', descriptors }

/** Preserve structured failures; rendering maps codes to localized text without echoing Host exceptions. */
export async function unwrap<T>(call: Promise<RemoteResult<T>>): Promise<T> {
  const result = await call
  if (!result.ok) throw result.error
  return result.value
}
