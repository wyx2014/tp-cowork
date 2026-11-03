/**
 * ZCode's project model over DSH's registry. DSH lists sessions that belong to no workspace under Ungrouped (a removed
 * workspace's sessions among them), and adding a folder again starts an empty workspace. ZCode has no Ungrouped: a
 * task shows only under its project, a removed project's tasks leave with it, and adding the folder back shows them
 * again. So every loose session is reported for the sidebar to hide, and a workspace takes in the loose sessions of its
 * folder when it is created (and at start). Nothing is deleted; DSH's `attachSession` checks each session's stored folder.
 */
import { realpath } from 'node:fs/promises'

/** Sessions started by @tpcowork/dsh-automation's scheduled runs; they live outside workspaces by design. */
export const SCHEDULED_PREFIX = 'automation-'

/** One registered workspace, as the registry lists it. */
export interface WorkspaceFact { readonly id: string; readonly path: string; readonly sessionIds: readonly string[] }
/** One stored session and the folder it ran in. */
export interface SessionFact { readonly sessionId: string; readonly cwd?: string | undefined; readonly origin?: string | undefined }

/** Registry and session facts behind the rules, injectable for tests. */
export interface RemovalFacts {
  workspaces(): readonly WorkspaceFact[]
  archived(): readonly string[]
  sessions(): Promise<readonly SessionFact[]>
  attach(workspaceId: string, sessionId: string): Promise<void>
}

/** The registry stores canonical folders; a session's cwd is resolved the same way before comparing. */
export async function canonical(path: string): Promise<string> {
  try { return await realpath(path) } catch { return path }
}

/**
 * Sessions in no workspace whose folder is one of `paths`, by folder. Archived sessions stay with archive management,
 * subagent sessions follow their parent, and scheduled runs stay in their own sidebar group.
 * @returns folder → loose session ids.
 */
export async function looseSessions(facts: RemovalFacts, paths: ReadonlySet<string>): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>()
  if (paths.size === 0) return found
  const owned = new Set(facts.workspaces().flatMap(workspace => workspace.sessionIds))
  const archived = new Set(facts.archived())
  for (const session of await facts.sessions()) {
    if (session.cwd === undefined || owned.has(session.sessionId) || archived.has(session.sessionId) || session.origin === 'subagent'
      || session.sessionId.startsWith(SCHEDULED_PREFIX)) continue
    const folder = await canonical(session.cwd)
    if (!paths.has(folder)) continue
    found.set(folder, [...found.get(folder) ?? [], session.sessionId])
  }
  return found
}

/**
 * Sessions in no workspace, which DSH would list under Ungrouped and ZCode would not show. Archived sessions stay with
 * archive management, and subagent sessions are never rows of their own.
 */
export async function hiddenSessions(facts: RemovalFacts): Promise<string[]> {
  const owned = new Set(facts.workspaces().flatMap(workspace => workspace.sessionIds))
  const archived = new Set(facts.archived())
  return (await facts.sessions())
    .filter(session => !owned.has(session.sessionId) && !archived.has(session.sessionId) && session.origin !== 'subagent')
    .map(session => session.sessionId)
}

/**
 * Give a workspace back the loose sessions of its folder, as ZCode shows a re-added project's tasks again.
 * A session that cannot be attached (its folder moved, say) is left where it is.
 * @returns how many sessions were attached.
 */
export async function restoreSessions(facts: RemovalFacts, workspace: WorkspaceFact): Promise<number> {
  const loose = (await looseSessions(facts, new Set([workspace.path]))).get(workspace.path) ?? []
  let attached = 0
  for (const sessionId of loose) {
    try { await facts.attach(workspace.id, sessionId); attached++ } catch { /* left loose */ }
  }
  return attached
}
