/** Module-owned codecs; T4 mounts this contribution on its existing Gateway client. */
import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import type { SkillsApi, InstallerApi, SkillItem } from '../../contracts/index.ts'
export const readinessSchema = z.object({ state: z.enum(['unknown', 'checking', 'ready', 'blocked', 'error']), checkedAt: z.number().optional(), reasons: z.array(z.object({ code: z.string(), message: z.string() }).strict()) }).strict()
export const skillSchema = z.object({
  id: z.string(), name: z.string(), description: z.string(), origin: z.enum(['bundled', 'user', 'project', 'prompthub']),
  provider: z.string(), version: z.string(), fingerprint: z.string(), installed: z.boolean(), enabled: z.boolean(),
  invocation: z.object({ modelInvocable: z.boolean(), userInvocable: z.boolean() }).strict(), readiness: readinessSchema, resources: z.array(z.string()),
  path: z.string().optional(), managed: z.boolean().optional(),
}).strict()
export const scopeSchema = z.object({ sessionId: z.string().min(1).optional() }).strict()
export const installSchema = z.object({
  requestId: z.string().min(1).max(200),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('bundled'), resourceId: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('local'), importId: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('prompthub'), skillId: z.string().min(1), versionId: z.string().min(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  ]), scope: z.discriminatedUnion('kind', [z.object({ kind: z.literal('user') }).strict(), z.object({ kind: z.literal('project'), sessionId: z.string() }).strict()]),
  conflict: z.enum(['reject', 'replace-owned']),
}).strict()
const resultSchema = z.object({ operationId: z.string(), state: z.enum(['installed', 'unchanged', 'failed', 'cancelled']), skillId: z.string().optional(), fingerprint: z.string().optional(), error: z.object({ code: z.string(), message: z.string() }).strict().optional() }).strict()
const catalogSchema = z.object({ revision: z.number().int().nonnegative(), complete: z.boolean(), items: z.array(skillSchema) }).strict()
const itemRequest = scopeSchema.extend({ id: z.string().min(1) })
const packageName = '@tpcowork/dsh-toolbox-skills'
function descriptor(service: string, method: string, input: z.ZodType, output: z.ZodType): InvocationDescriptor {
  return { id: `${packageName}#${service}/${method}`, service, namespace: service, method,
    invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: `${packageName}#${service}-${method}-request`, create: () => input } }],
    result: { mode: 'strict', typeSymbol: `${packageName}#${service}-${method}-result`, create: () => output },
  }
}
export const descriptors = [
  descriptor('toolboxSkills', 'inventory', scopeSchema, catalogSchema),
  descriptor('toolboxSkills', 'install', installSchema, resultSchema),
  descriptor('toolboxSkills', 'remove', itemRequest.extend({ expectedRevision: z.number().int().nonnegative() }), z.void()),
  descriptor('toolboxSkills', 'setEnabled', itemRequest.extend({ enabled: z.boolean(), expectedRevision: z.number().int().nonnegative() }), catalogSchema),
  descriptor('toolboxSkills', 'checkReadiness', itemRequest, skillSchema),
  descriptor('toolboxSkills', 'detail', itemRequest, z.object({ item: skillSchema, content: z.string() }).strict()),
  descriptor('toolboxInstaller', 'install', installSchema, resultSchema),
  descriptor('toolboxInstaller', 'cancel', z.object({ operationId: z.string().min(1) }).strict(), z.void()),
  descriptor('toolboxInstaller', 'prepareLocalImport', z.object({ path: z.string().min(1) }).strict(), z.object({ importId: z.string(), name: z.string() }).strict()),
  descriptor('toolboxInstaller', 'prepareArchive', z.object({ contentBase64: z.string().min(1) }).strict(), z.object({ importId: z.string(), name: z.string() }).strict()),
  descriptor('toolboxInstaller', 'prepareSkill', z.object({ content: z.string().min(1).max(1024 * 1024) }).strict(), z.object({ importId: z.string(), name: z.string() }).strict()),
] satisfies InvocationDescriptor[]
export const remoteContribution: TypertRemoteContribution = { package: packageName, descriptors }
export const hostContribution: TypertContribution = { package: packageName, face: 'host', invocations: descriptors, schemas: [], model: { services: [], objects: [], events: [] } }
type RemoteApi<T> = { [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => Promise<RemoteResult<R>> : never }
export type SkillsModuleApi = SkillsApi & { detail(request: { id: string; sessionId?: string }): Promise<{ item: SkillItem; content: string }> }
export type InstallerModuleApi = InstallerApi & {
  prepareLocalImport(request: { path: string }): Promise<{ importId: string; name: string }>
  prepareArchive(request: { contentBase64: string }): Promise<{ importId: string; name: string }>
  prepareSkill(request: { content: string }): Promise<{ importId: string; name: string }>
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertClientRemote { toolboxSkills: RemoteApi<SkillsModuleApi>; toolboxInstaller: RemoteApi<InstallerModuleApi> }
}
