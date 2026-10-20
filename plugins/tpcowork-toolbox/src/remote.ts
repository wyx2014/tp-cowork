import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, RemoteStreamHandle, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import type { ChangeFrame, ToolboxDescription } from './contracts/index.ts'

export const descriptionSchema = z.object({
  contractVersion: z.literal(1),
  modules: z.object({ skills: z.boolean(), mcp: z.boolean(), teams: z.boolean(), installer: z.boolean(), prompthub: z.boolean() }).strict(),
  defaultMcpIds: z.array(z.string()),
  userSkillsDirectory: z.string().optional(),
}).strict()
export const changeFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z.object({ type: z.literal('changed'), change: z.object({
    revision: z.number().int().positive(), domain: z.enum(['skills', 'mcp', 'teams', 'installer', 'prompthub', 'modules']), id: z.string().optional(),
  }).strict() }).strict(),
])
const packageName = '@tpcowork/dsh-toolbox'
export const descriptors: readonly InvocationDescriptor[] = [{
  id: `${packageName}#toolbox/describe`, service: 'toolbox', namespace: 'toolbox', method: 'describe',
  invocation: { kind: 'direct' }, parameters: [],
  result: { mode: 'strict', typeSymbol: `${packageName}/contracts#ToolboxDescription`, create: () => descriptionSchema },
}, {
  id: `${packageName}#toolboxChanges/watch`, service: 'toolboxChanges', namespace: 'toolboxChanges', method: 'watch',
  invocation: { kind: 'direct' }, mode: 'stream', parameters: [], cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: `${packageName}/contracts#ChangeFrame`, create: () => changeFrameSchema },
}]
export const remoteContribution: TypertRemoteContribution = { package: packageName, descriptors }
export const hostContribution: TypertContribution = {
  package: packageName, face: 'host', invocations: descriptors,
  schemas: [{ name: 'ToolboxDescription', create: () => descriptionSchema }, { name: 'ChangeFrame', create: () => changeFrameSchema }],
  model: { services: [], events: [], objects: [] },
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertClientRemote {
    toolbox: { describe(): Promise<RemoteResult<ToolboxDescription>> }
    toolboxChanges: { watch(signal: AbortSignal): RemoteStreamHandle<ChangeFrame, never> }
  }
}
