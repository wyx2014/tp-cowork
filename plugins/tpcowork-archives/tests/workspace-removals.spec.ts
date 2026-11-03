import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonical, hiddenSessions, restoreSessions, type RemovalFacts, type WorkspaceFact } from '../src/workspace-removals.ts'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

function facts(workspaces: WorkspaceFact[], sessions: { sessionId: string; cwd?: string; origin?: string }[], archived: string[] = []) {
  const attached: string[] = []
  const value: RemovalFacts = {
    workspaces: () => workspaces,
    archived: () => archived,
    sessions: async () => sessions,
    attach: async (workspaceId, sessionId) => {
      if (sessionId === 'refused') throw new Error('cwd moved')
      attached.push(`${workspaceId}:${sessionId}`)
    },
  }
  return { value, attached }
}

describe('workspace removal', () => {
  it('hides every session in no workspace, as ZCode has no Ungrouped, but not owned, archived or subagent sessions', async () => {
    const { value } = facts([{ id: 'w1', path: '/kept', sessionIds: ['s-kept'] }], [
      { sessionId: 's-kept', cwd: '/kept' },
      { sessionId: 's-a', cwd: '/gone' },
      { sessionId: 's-archived', cwd: '/gone' },
      { sessionId: 's-elsewhere', cwd: '/never-added' },
      { sessionId: 's-no-cwd' },
      { sessionId: 's-child', cwd: '/gone', origin: 'subagent' },
    ], ['s-archived'])
    expect(await hiddenSessions(value)).toEqual(['s-a', 's-elsewhere', 's-no-cwd'])
  })

  it('attaches the folder\'s loose sessions to the re-added workspace, but not subagents, scheduled runs, or ones it cannot attach', async () => {
    const { value, attached } = facts([{ id: 'w1', path: '/kept', sessionIds: ['s-kept'] }], [
      { sessionId: 's-kept', cwd: '/gone' },
      { sessionId: 's-a', cwd: '/gone' },
      { sessionId: 'refused', cwd: '/gone' },
      { sessionId: 's-other', cwd: '/other' },
      { sessionId: 's-child', cwd: '/gone', origin: 'subagent' },
      { sessionId: 'automation-run', cwd: '/gone' },
    ])
    expect(await restoreSessions(value, { id: 'w2', path: '/gone', sessionIds: [] })).toBe(1)
    expect(attached).toEqual(['w2:s-a'])
  })

  it('compares folders by their real path, as the registry stores them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'removals-'))
    dirs.push(dir)
    await mkdir(join(dir, 'real'))
    await symlink(join(dir, 'real'), join(dir, 'link'))
    const real = await canonical(join(dir, 'real'))
    expect(await canonical(join(dir, 'link'))).toBe(real)
    expect(await canonical(join(dir, 'missing'))).toBe(join(dir, 'missing'))
    const { value: restoring, attached } = facts([], [{ sessionId: 's-link', cwd: join(dir, 'link') }])
    expect(await restoreSessions(restoring, { id: 'w', path: real, sessionIds: [] })).toBe(1)
    expect(attached).toEqual(['w:s-link'])
  })
})

describe('sidebar rules', () => {
  it('leaves sessions another plugin groups, such as scheduled tasks, in their group', async () => {
    const { ownHidden, REMOVED_GROUP_KEY } = await import('../src/removed-workspaces.ts')
    const groups = [{ key: 'tpcowork:scheduled-sessions', label: '定时任务', sessionIds: ['s-auto'] }, { key: REMOVED_GROUP_KEY, label: '', sessionIds: ['s-a'] }]
    expect(ownHidden(['s-a', 's-auto', 's-b'], groups as never)).toEqual(['s-a', 's-b'])
  })
})
