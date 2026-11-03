import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { archiveGroups } from '../src/archives.ts'
import { autoArchiveCandidates, drainPending, PendingDeletes, removeArchived, type ArchiveStore, type StoredHeader } from '../src/host.ts'

const sources = {
  archived: [{ sessionId: 'a', createdAt: 100 }, { sessionId: 'b', createdAt: 300 }, { sessionId: 'c', createdAt: 200 }, { sessionId: 'd', createdAt: 50 }],
  sessions: { a: { displayTitle: 'Alpha report', updatedAt: 900 }, b: { displayTitle: 'Beta', updatedAt: 400 }, c: { displayTitle: 'Gamma', updatedAt: 500 } },
  workspaces: [{ workspaceId: 'w1', title: 'Docs', sessionIds: ['a', 'b'] }],
}

it('groups archived sessions by workspace, newest first, with sessions outside workspaces unclassified', () => {
  const groups = archiveGroups(sources)
  expect(groups.map(group => [group.key, group.title, group.tasks.map(task => task.id)])).toEqual([
    ['workspace:w1', 'Docs', ['a', 'b']],
    ['unclassified', null, ['c', 'd']],
  ])
  expect(groups[1]!.tasks[1]).toEqual({ id: 'd', title: 'd', createdAt: 50, updatedAt: 50 })
  expect(archiveGroups(sources, { sort: 'created' }).map(group => group.tasks.map(task => task.id))).toEqual([['b', 'a'], ['c', 'd']])
})

it('filters by title and by project', () => {
  expect(archiveGroups(sources, { query: ' alpha ' }).flatMap(group => group.tasks.map(task => task.id))).toEqual(['a'])
  expect(archiveGroups(sources, { project: 'unclassified' }).map(group => group.key)).toEqual(['unclassified'])
  expect(archiveGroups(sources, { query: 'nothing' })).toEqual([])
})

function fakeStore(headers: StoredHeader[], archived: string[], loaded: string[] = []) {
  const deleted: string[] = []
  const removed: string[] = []
  const failing = new Set<string>()
  const store: ArchiveStore = {
    archived: () => archived,
    headers: async () => headers.filter(header => !deleted.includes(header.id)),
    loaded: id => loaded.includes(id),
    delete: async (id) => { if (failing.has(id)) throw new Error('locked'); deleted.push(id); return true },
    removed: id => removed.push(id),
  }
  return { store, deleted, removed, failing, loaded }
}

async function pendingFile() {
  const dir = await mkdtemp(join(tmpdir(), 'tpcowork-archives-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return join(dir, 'tpcowork', 'pending.json')
}

it('deletes archived sessions with their subagents, skips unarchived ones, and counts failures', async () => {
  const headers = [{ id: 'a', createdAt: 1 }, { id: 'a-sub', createdAt: 2, parentSession: 'a', origin: 'subagent' }, { id: 'b', createdAt: 3 }, { id: 'live', createdAt: 4 }]
  const fake = fakeStore(headers, ['a', 'b'])
  fake.failing.add('b')
  const result = await removeArchived(fake.store, new PendingDeletes(await pendingFile()), ['a', 'a', 'b', 'live'])
  expect(result).toEqual({ succeeded: 1, failed: 1, skipped: 1 })
  expect(fake.deleted).toEqual(['a-sub', 'a'])
  expect(fake.removed).toEqual(['a'])
})

it('defers a loaded session to the next start and deletes it then, unless it was unarchived', async () => {
  const file = await pendingFile()
  const headers = [{ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 2 }]
  const first = fakeStore(headers, ['a', 'b'], ['a', 'b'])
  expect(await removeArchived(first.store, new PendingDeletes(file), ['a', 'b'])).toEqual({ succeeded: 2, failed: 0, skipped: 0 })
  expect(first.deleted).toEqual([])
  expect(first.removed).toEqual(['a', 'b'])
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(['a', 'b'])
  // A queued session is hidden from a repeated request.
  expect(await removeArchived(first.store, new PendingDeletes(file), ['a'])).toEqual({ succeeded: 0, failed: 0, skipped: 1 })

  const restarted = fakeStore(headers, ['a'])
  await drainPending(restarted.store, new PendingDeletes(file))
  expect(restarted.deleted).toEqual(['a'])
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([])
})

it('auto-archives only idle, unpinned, stopped, unloaded, non-blank top-level sessions', () => {
  const row = (sessionId: string, updatedAt: number, extra: object = {}) => ({ sessionId, updatedAt, running: false, agentAvailable: false, blank: false, ...extra })
  const rows = [
    row('old', 10), row('recent', 500), row('pinned', 10), row('archived', 10), row('running', 10, { running: true }),
    row('open', 10, { agentAvailable: true }), row('blank', 10, { blank: true }), row('child', 10, { origin: 'subagent' }), row('edge', 100),
  ]
  expect(autoArchiveCandidates(rows, { archived: ['archived'], pinned: ['pinned'] }, 100)).toEqual(['old'])
})
