/** ZCode's archive grouping in DSH terms: Workspaces are its projects and Sessions outside them are unclassified. */

export type ArchiveSort = 'updated' | 'created'

/** One archived Session as the page shows it. */
export interface ArchiveTask { id: string; title: string; createdAt: number; updatedAt: number }

/** Archived Sessions of one Workspace, or of none. */
export interface ArchiveGroup { key: string; workspaceId: string | null; title: string | null; tasks: ArchiveTask[] }

export interface ArchiveSources {
  /** Host-listed archived Sessions with their creation times. */
  archived: readonly { sessionId: string; createdAt: number }[]
  /** Client Session rows; a missing row falls back to the Session id and its creation time. */
  sessions: Readonly<Record<string, { displayTitle: string; updatedAt: number } | undefined>>
  workspaces: readonly { workspaceId: string; title: string; sessionIds: readonly string[] }[]
}

export interface ArchiveFilter { query?: string; sort?: ArchiveSort; project?: string }

const UNCLASSIFIED = 'unclassified'

/**
 * Group archived Sessions by Workspace, newest first by the chosen time, in the order of each group's newest task.
 * @param sources - archived Sessions, Session rows, and Workspaces.
 * @param filter - title search, sort time, and `all` or one group key.
 * @returns the non-empty groups.
 */
export function archiveGroups(sources: ArchiveSources, filter: ArchiveFilter = {}): ArchiveGroup[] {
  const sort = filter.sort ?? 'updated'
  const query = filter.query?.trim().toLocaleLowerCase() ?? ''
  const owner = new Map<string, { workspaceId: string; title: string }>()
  for (const workspace of sources.workspaces) for (const id of workspace.sessionIds) owner.set(id, workspace)
  const groups = new Map<string, ArchiveGroup>()
  for (const { sessionId, createdAt } of sources.archived) {
    const row = sources.sessions[sessionId]
    const task: ArchiveTask = { id: sessionId, title: row?.displayTitle ?? sessionId, createdAt, updatedAt: Math.max(row?.updatedAt ?? 0, createdAt) }
    if (query && !task.title.toLocaleLowerCase().includes(query)) continue
    const workspace = owner.get(sessionId)
    const key = workspace ? `workspace:${workspace.workspaceId}` : UNCLASSIFIED
    if (filter.project && filter.project !== 'all' && filter.project !== key) continue
    const group = groups.get(key) ?? { key, workspaceId: workspace?.workspaceId ?? null, title: workspace?.title ?? null, tasks: [] }
    group.tasks.push(task)
    groups.set(key, group)
  }
  const time = (task: ArchiveTask) => sort === 'created' ? task.createdAt : task.updatedAt
  const result = [...groups.values()]
  for (const group of result) group.tasks.sort((left, right) => time(right) - time(left))
  return result.sort((left, right) => time(right.tasks[0]!) - time(left.tasks[0]!))
}
