/**
 * TP Cowork archive management, modeled on ZCode's Settings "Archive management": the Settings client lists
 * archived Sessions and unarchives them through the Workspace service, and this Host service deletes them.
 * DSH keeps an opened Session's Agent loaded until the app quits and stored Sessions can only be deleted
 * unloaded, so a loaded Session is hidden at once and its files are removed when the app next starts.
 * Like ZCode's "Auto-archive old sessions", an optional background scan archives Sessions idle longer than
 * the chosen number of days; it is off by default and never deletes anything.
 * As in ZCode, sessions show only under their folder's workspace: a removed workspace's sessions leave with it and
 * come back when the folder is added again (see `workspace-removals.ts`).
 * @module @tpcowork/dsh-archives
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '@deepseek-ai/dsh-workspace'
import { archivesContribution, type ArchivedSession, type RemoveResult } from './remote.ts'
import { hiddenSessions, restoreSessions, type RemovalFacts } from './workspace-removals.ts'

declare module '@deepseek-ai/cordis' { interface Context { archiveManager: ArchiveManager } }

export const name = 'tpcowork-archives'

export interface Config {
  /** ZCode's "Auto-archive old sessions" switch, read live; off by default as in ZCode. */
  autoArchive: Volatile<boolean>
  /** ZCode's "Archive retention period": days without activity before a Session is archived. */
  autoArchiveDays: Volatile<number>
}

export const Config = z.object({
  autoArchive: z.boolean().default(false).volatile().description('Archive sessions without activity for longer than the retention period.'),
  autoArchiveDays: z.natural().min(1).max(365).default(30).volatile().description('Days without activity before a session is archived.'),
})

/** ZCode scans every five minutes, and again whenever either setting changes. */
export const AUTO_ARCHIVE_INTERVAL_MS = 5 * 60_000
const DAY_MS = 86_400_000

/** One Session row as the auto-archive scan reads it from the Session list. */
export interface ActivityRow { sessionId: string; updatedAt: number; running: boolean; agentAvailable: boolean; blank: boolean; origin?: string | undefined }

/**
 * Pick the Sessions ZCode's scan would archive: idle past the cutoff, not pinned, not already archived, and not
 * running. Loaded Sessions are also left alone, so a conversation open on screen is never pulled out from under
 * the user, and blank and subagent rows have nothing to archive on their own.
 * @param rows - the Session list.
 * @param state - archived and pinned sets.
 * @param cutoff - last-activity time before which a Session is idle enough.
 * @returns the Session ids to archive.
 */
export function autoArchiveCandidates(rows: readonly ActivityRow[], state: { archived: readonly string[]; pinned: readonly string[] }, cutoff: number): string[] {
  const skip = new Set([...state.archived, ...state.pinned])
  return rows.filter(row => row.updatedAt < cutoff && !skip.has(row.sessionId) && !row.running && !row.agentAvailable
    && !row.blank && row.origin !== 'subagent').map(row => row.sessionId)
}

/** Stored Session facts the deletion needs: identity, creation time, and the subagent parent link. */
export interface StoredHeader { id: string; createdAt: number; parentSession?: string | undefined; origin?: string | undefined }

/** Host capabilities behind one deletion pass, injectable for tests. */
export interface ArchiveStore {
  archived(): readonly string[]
  headers(): Promise<readonly StoredHeader[]>
  loaded(id: string): boolean
  /** Delete one unloaded stored Session; resolves false when it was already absent. */
  delete(id: string): Promise<boolean>
  /** Tell connected Clients the Session left the list. */
  removed(id: string): void
}

/** Sessions whose deletion waits for the app to restart, persisted beside the DSH home's other product state. */
export class PendingDeletes {
  private ids: Set<string> | undefined
  constructor(private readonly file: string) {}

  async list(): Promise<Set<string>> {
    if (this.ids) return this.ids
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      this.ids = new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.ids = new Set()
    }
    return this.ids
  }

  async add(id: string): Promise<void> {
    await this.replace([...await this.list(), id])
  }

  async replace(ids: Iterable<string>): Promise<void> {
    this.ids = new Set(ids)
    await mkdir(dirname(this.file), { recursive: true })
    const staging = `${this.file}.${process.pid}.tmp`
    await writeFile(staging, JSON.stringify([...this.ids]))
    await rename(staging, this.file)
  }
}

/** The Session and every stored subagent descendant, children first so a parent never outlives its subagents. */
function family(root: string, headers: readonly StoredHeader[]): string[] {
  const children = new Map<string, string[]>()
  for (const header of headers) {
    if (header.origin !== 'subagent' || header.parentSession === undefined) continue
    children.set(header.parentSession, [...children.get(header.parentSession) ?? [], header.id])
  }
  const order: string[] = []
  const visit = (id: string) => {
    for (const child of children.get(id) ?? []) visit(child)
    order.push(id)
  }
  visit(root)
  return order
}

/**
 * Delete archived Sessions as ZCode's archive management does, counting each requested Session once.
 * @param store - Host capabilities.
 * @param pending - deletions deferred to the next start.
 * @param sessionIds - Sessions the user confirmed.
 * @returns committed, failed, and skipped (no longer archived) counts.
 */
export async function removeArchived(store: ArchiveStore, pending: PendingDeletes, sessionIds: readonly string[]): Promise<RemoveResult> {
  const result = { succeeded: 0, failed: 0, skipped: 0 }
  const headers = await store.headers()
  for (const id of new Set(sessionIds)) {
    if (!store.archived().includes(id) || (await pending.list()).has(id)) { result.skipped++; continue }
    const members = family(id, headers)
    if (members.some(member => store.loaded(member))) {
      await pending.add(id)
      store.removed(id)
      result.succeeded++
      continue
    }
    try {
      for (const member of members) await store.delete(member)
      store.removed(id)
      result.succeeded++
    } catch {
      result.failed++
    }
  }
  return result
}

/**
 * Finish deletions deferred by an earlier run. Each stays queued while it is still loaded; one the user
 * unarchived meanwhile is kept.
 */
export async function drainPending(store: ArchiveStore, pending: PendingDeletes): Promise<void> {
  const deferred = await pending.list()
  if (deferred.size === 0) return
  const headers = await store.headers()
  const known = new Set(headers.map(header => header.id))
  const kept: string[] = []
  for (const id of deferred) {
    if (!known.has(id) || !store.archived().includes(id)) continue
    const members = family(id, headers)
    if (members.some(member => store.loaded(member))) { kept.push(id); continue }
    try {
      for (const member of members) await store.delete(member)
    } catch {
      kept.push(id)
    }
  }
  await pending.replace(kept)
}

/** The `archiveManager` Remote behind the Settings page. */
export class ArchiveManager extends TypertRemoteService {
  static inject = ['typert', 'workspaceRegistry', 'sessionPersistence', 'sessionQuery', 'sessions', 'sessionController']
  private scanning: Promise<number> | undefined
  private readonly pending = new PendingDeletes(join(resolveDshHome(), 'tpcowork', 'archives-pending-delete.json'))
  private readonly store: ArchiveStore
  /** Workspaces already seen, so a put for a new id is a creation. */
  private readonly known = new Set<string>()
  private readonly facts: RemovalFacts

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'archiveManager')
    ctx.typert.register(archivesContribution)
    this.store = {
      archived: () => ctx.workspaceRegistry.archivedSessionIds,
      headers: async () => (await ctx.sessionQuery.listSessions()).map(record => record.header),
      loaded: id => ctx.sessions.get(id as SessionId) !== undefined,
      delete: async (id) => {
        const snapshot = await ctx.sessionPersistence.stat(id as SessionId)
        return ctx.sessionPersistence.delete(id as SessionId, { expectedRevision: snapshot?.revision })
      },
      removed: id => ctx.emit('api-session/removed', id as SessionId),
    }
    const registry = () => ctx.workspaceRegistry
    this.facts = {
      workspaces: () => registry().list().map(workspace => ({ id: workspace.id, path: workspace.path, sessionIds: workspace.sessionIds })),
      archived: () => registry().archivedSessionIds,
      sessions: async () => (await ctx.sessionController.list({}, AbortSignal.timeout(60_000))).items,
      attach: async (workspaceId, sessionId) => {
        const workspace = registry().get(workspaceId as never)
        if (workspace === undefined) throw new Error(`workspace '${workspaceId}' is gone`)
        await workspace.attachSession(sessionId as SessionId)
      },
    }
    ctx.on('domain/changed' as never, ((change: { domain: string; table: string; key: string; operation: string; value?: unknown }) => {
      if (change.domain !== 'workspace' || change.table !== 'workspaces') return
      if (change.operation === 'deleted') { this.known.delete(change.key); return }
      const path = (change.value as { path?: unknown } | undefined)?.path
      if (this.known.has(change.key) || typeof path !== 'string') return
      this.known.add(change.key)
      // The registry is still committing the creation; attach once it has settled.
      setTimeout(() => { void this.restore(change.key, path) }, 0)
    }) as never)
    // At start every workspace takes in its folder's loose sessions, such as ones left by a removal before this ran.
    void Promise.resolve().then(async () => {
      for (const workspace of this.facts.workspaces()) {
        this.known.add(workspace.id)
        await this.restore(workspace.id, workspace.path)
      }
    }).catch((error: unknown) => ctx.logger.warn(`tpcowork-archives: restoring loose sessions failed: ${String(error)}`))
    // Startup cleanup is best effort: a failure leaves the queue for the next start.
    void Promise.resolve().then(() => drainPending(this.store, this.pending)).catch((error: unknown) => {
      ctx.logger.warn(`tpcowork-archives: deferred deletion failed: ${String(error)}`)
    })
    ctx.effect(() => {
      const tick = () => { void this.rescan().catch((error: unknown) => ctx.logger.warn(`tpcowork-archives: auto-archive scan failed: ${String(error)}`)) }
      tick()
      const timer = setInterval(tick, AUTO_ARCHIVE_INTERVAL_MS)
      timer.unref?.()
      return () => clearInterval(timer)
    }, 'tpcowork-archives: auto-archive scan')
  }

  /**
   * Run one auto-archive scan now; the Settings page calls this after either setting changes, as ZCode rescans.
   * Overlapping requests share the scan in flight.
   * @returns how many Sessions this scan archived; 0 while the switch is off.
   */
  rescan(): Promise<number> {
    this.scanning ??= this.scan().finally(() => { this.scanning = undefined })
    return this.scanning
  }

  private async scan(): Promise<number> {
    if (!this.config.autoArchive.get()) return 0
    const days = Math.max(1, Math.floor(this.config.autoArchiveDays.get()))
    const signal = AbortSignal.timeout(60_000)
    const { items } = await this.ctx.sessionController.list({}, signal)
    const registry = this.ctx.workspaceRegistry
    const candidates = autoArchiveCandidates(items, { archived: registry.archivedSessionIds, pinned: registry.pinnedSessionIds }, Date.now() - days * DAY_MS)
    let archived = 0
    for (const id of candidates) {
      // The registry refuses a Session that started work meanwhile; it simply stays for a later scan.
      try { await registry.archiveSession(id as SessionId); archived++ } catch { /* skipped */ }
    }
    if (archived > 0) this.ctx.logger.info(`tpcowork-archives: auto-archived ${String(archived)} sessions idle for ${String(days)} days`)
    return archived
  }

  /** @returns the archived Sessions still stored, without the ones waiting to be deleted. */
  async list(): Promise<ArchivedSession[]> {
    const deferred = await this.pending.list()
    const archived = new Set(this.store.archived())
    return (await this.store.headers())
      .filter(header => archived.has(header.id) && !deferred.has(header.id))
      .map(header => ({ sessionId: header.id, createdAt: header.createdAt }))
  }

  /** A workspace for `path` exists: attach its folder's loose sessions. */
  private async restore(workspaceId: string, path: string): Promise<void> {
    try {
      const attached = await restoreSessions(this.facts, { id: workspaceId, path, sessionIds: [] })
      if (attached > 0) this.ctx.logger.info(`tpcowork-archives: restored ${String(attached)} loose sessions to the workspace ${path}`)
    } catch (error) {
      this.ctx.logger.warn(`tpcowork-archives: restoring sessions to ${path} failed: ${String(error)}`)
    }
  }

  /** @returns the sessions in no workspace, which the sidebar does not show (there is no Ungrouped, as in ZCode). */
  hidden(): Promise<string[]> {
    return hiddenSessions(this.facts)
  }

  /** Delete the confirmed archived Sessions. */
  remove(sessionIds: string[]): Promise<RemoveResult> {
    return removeArchived(this.store, this.pending, sessionIds)
  }
}

export function apply(ctx: Context, config: Config): void {
  ctx.plugin(ArchiveManager, config)
}
