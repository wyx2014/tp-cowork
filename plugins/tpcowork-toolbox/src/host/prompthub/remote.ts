/** Client-safe codecs shared by the Host contribution and existing Gateway Client. */
import { z } from 'zod'
import type { InvocationDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import { installSchema } from '../skills/remote.ts'

const id = z.string().min(1).max(200)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
export const userSchema = z.object({ id: z.string().min(1).max(200), username: z.string().min(1).max(200), name: z.string().max(200).optional() }).strict()
  .transform(user => ({ id: user.id, username: user.username, ...(user.name === undefined ? {} : { name: user.name }) }))
export const accountSchema = z.object({ configured: z.boolean(), writable: z.boolean(), state: z.enum(['unconfigured', 'signed_out', 'signed_in', 'expired']).optional(), user: userSchema.optional() }).strict()
export const browserSessionSchema = z.object({ token: z.string().min(1).max(32768) }).strict()
export const loginSchema = z.object({ username: id, passwordRef: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(200) }).strict()
export const listSchema = z.object({ query: z.string().max(200).optional(), cursor: z.string().max(200).optional() }).strict()
export const detailSchema = z.object({ id, preview: z.boolean().optional() }).strict()
export const hubInstallSchema = installSchema.extend({ source: z.object({ kind: z.literal('prompthub'), skillId: id, versionId: id, fingerprint: hash }).strict() })
export const publishSchema = z.object({ requestId: id, sourceSkillId: id, slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64), displayName: z.string().min(1).max(200), version: z.string().regex(/^\d+\.\d+(?:\.\d+)?(?:[-+][a-zA-Z0-9.-]+)?$/).max(100) }).strict()
export const hubSkillSchema = z.object({ id, name: z.string(), description: z.string(), versionId: z.string(), version: z.string(), displayName: z.string().optional(), tags: z.array(z.string()).optional(), visibility: z.string().optional(), approvalStatus: z.string().optional() }).strict()
export const fileSchema = z.object({ path: z.string().min(1).max(1000), size: z.number().int().nonnegative(), sha256: hash, contentType: z.string().max(200) })
const installResult = z.object({ operationId: z.string(), state: z.enum(['installed', 'unchanged', 'failed', 'cancelled']), skillId: z.string().optional(), fingerprint: z.string().optional(), error: z.object({ code: z.string(), message: z.string() }).optional() }).strict()
// The service's publication fingerprint is opaque; install fingerprints use T2's documented algorithm.
export const publishResultSchema = z.object({ skillId: id, versionId: id, fingerprint: z.string().min(1).max(256), fileCount: z.number().int().positive() }).strict()
const packageName = '@tpcowork/dsh-toolbox-prompthub'
function descriptor(method: string, input: z.ZodType | undefined, output: z.ZodType, cancel = false): InvocationDescriptor {
  return { id: `${packageName}#toolboxPromptHub/${method}`, service: 'toolboxPromptHub', namespace: 'toolboxPromptHub', method, invocation: { kind: 'direct' },
    parameters: input ? [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: `${packageName}#${method}-request`, create: () => input } }] : [],
    ...(cancel ? { cancellation: { parameter: 'signal' } } : {}),
    result: { mode: 'strict', typeSymbol: `${packageName}#${method}-result`, create: () => output },
  }
}
export const descriptors = [
  descriptor('browserAuth', undefined, z.object({ loginUrl: z.string(), timeoutMs: z.number().positive() }).strict()),
  descriptor('acceptBrowserSession', browserSessionSchema, z.object({ configured: z.boolean() }).strict(), true),
  descriptor('account', undefined, accountSchema), descriptor('login', loginSchema, z.object({ configured: z.boolean() }).strict(), true), descriptor('logout', undefined, z.void()),
  descriptor('list', listSchema, z.object({ items: z.array(hubSkillSchema), cursor: z.string().optional() }).strict(), true),
  descriptor('detail', detailSchema, z.object({ skill: hubSkillSchema, fingerprint: hash, files: z.array(fileSchema), content: z.string().optional() }).strict(), true),
  descriptor('install', hubInstallSchema, installResult, true), descriptor('publish', publishSchema, publishResultSchema, true),
]
export const remoteContribution: TypertRemoteContribution = { package: packageName, descriptors }
export const hostContribution: TypertContribution = { package: packageName, face: 'host', invocations: descriptors, schemas: [], model: { services: [], objects: [], events: [] } }
