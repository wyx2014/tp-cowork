/** Browser-safe descriptor of the read-only memory catalog shared by the Host service and the Settings client. */
import type { InvocationDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import { z } from 'zod'

const packageName = '@tpcowork/dsh-memory'

/** One memory file as ZCode's viewer lists it; `path` is the real file inside the memory directory. */
export const memoryFileSummary = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(['index', 'item']),
  size: z.number(),
  updatedAt: z.number(),
})

/** One workspace directory that holds at least one memory file. */
export const memoryWorkspaceSummary = z.object({
  id: z.string(),
  label: z.string(),
  updatedAt: z.number(),
  files: z.array(memoryFileSummary),
})

export const memoryCatalogValue = z.array(memoryWorkspaceSummary)
export type MemoryFileSummary = z.infer<typeof memoryFileSummary>
export type MemoryWorkspaceSummary = z.infer<typeof memoryWorkspaceSummary>

const descriptor: InvocationDescriptor = {
  id: `${packageName}#memoryCatalog/list`, service: 'memoryCatalog', namespace: 'memoryCatalog', method: 'list',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'strict', typeSymbol: 'MemoryCatalogValue', create: () => memoryCatalogValue },
}
export const catalogRemote: TypertRemoteContribution = { package: packageName, descriptors: [descriptor] }
export const catalogContribution: TypertContribution = { ...catalogRemote, face: 'host', invocations: [descriptor], schemas: [], model: { services: [], events: [], objects: [] } }
