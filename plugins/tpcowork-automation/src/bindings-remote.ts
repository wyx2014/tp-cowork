/** Browser-safe read-only binding namespace descriptors. */
import type { InvocationDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import { z } from 'zod'
export const bindingsRequest = z.object({ workspacePath: z.string().min(1).optional() }).strict()
export const bindingsValue = z.object({
  skills: z.array(z.object({ name: z.string(), description: z.string() })),
  connectors: z.array(z.object({ name: z.string() })),
  skillsAvailable: z.boolean(),
})
const descriptor: InvocationDescriptor = {
  id: '@tpcowork/dsh-automation#automationBindings/list', service: 'automationBindings', namespace: 'automationBindings', method: 'list',
  invocation: { kind: 'direct' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'AutomationBindingsRequest', create: () => bindingsRequest } }],
  result: { mode: 'strict', typeSymbol: 'AutomationBindingsValue', create: () => bindingsValue },
}
/** Mounted separately from the nine task-management operations. */
export const bindingsRemote: TypertRemoteContribution = { package: '@tpcowork/dsh-automation-bindings', descriptors: [descriptor] }
export const bindingsContribution: TypertContribution = { ...bindingsRemote, face: 'host', invocations: [descriptor], schemas: [], model: { services: [], events: [], objects: [] } }
