/** Browser-safe descriptors of the archive Remote shared by the Host service and the Settings client. */
import type { InvocationDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import { z } from 'zod'

const packageName = '@tpcowork/dsh-archives'

/** One archived Session the Host still stores; titles and Workspaces come from the Client's live lists. */
export const archivedSession = z.object({ sessionId: z.string(), createdAt: z.number() })
export const archivedSessionsValue = z.array(archivedSession)
/** ZCode's batch outcome: committed, failed, and skipped because the Session changed since it was listed. */
export const removeResultValue = z.object({ succeeded: z.number(), failed: z.number(), skipped: z.number() })
export type ArchivedSession = z.infer<typeof archivedSession>
export type RemoveResult = z.infer<typeof removeResultValue>

const list: InvocationDescriptor = {
  id: `${packageName}#archiveManager/list`, service: 'archiveManager', namespace: 'archiveManager', method: 'list',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'strict', typeSymbol: 'ArchivedSessionsValue', create: () => archivedSessionsValue },
}
const remove: InvocationDescriptor = {
  id: `${packageName}#archiveManager/remove`, service: 'archiveManager', namespace: 'archiveManager', method: 'remove',
  invocation: { kind: 'direct' },
  parameters: [{ name: 'sessionIds', wire: 'sessionIds', source: 'json', codec: { mode: 'strict', typeSymbol: 'SessionIds', create: () => z.array(z.string()) } }],
  result: { mode: 'strict', typeSymbol: 'RemoveResultValue', create: () => removeResultValue },
}
const rescan: InvocationDescriptor = {
  id: `${packageName}#archiveManager/rescan`, service: 'archiveManager', namespace: 'archiveManager', method: 'rescan',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'strict', typeSymbol: 'RescanValue', create: () => z.number() },
}
/** Sessions of removed workspaces, kept out of the sidebar until their folder is added again. */
const hidden: InvocationDescriptor = {
  id: `${packageName}#archiveManager/hidden`, service: 'archiveManager', namespace: 'archiveManager', method: 'hidden',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'strict', typeSymbol: 'HiddenSessionsValue', create: () => z.array(z.string()) },
}
export const archivesRemote: TypertRemoteContribution = { package: packageName, descriptors: [list, remove, rescan, hidden] }
export const archivesContribution: TypertContribution = { ...archivesRemote, face: 'host', invocations: [list, remove, rescan, hidden], schemas: [], model: { services: [], events: [], objects: [] } }
