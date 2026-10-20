/** Sidebar ownership remains available for old runs without opening their Agents. */
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSessionGroupSource } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { registerAutomationSessionGroup } from '../src/session-groups.ts'
import { en, zh } from '../src/ui-locales.ts'

const sid = (id: string) => id as SessionId
async function harness(ids: readonly string[], refresh: (id: SessionId) => Promise<void>) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const list = createSnapshotStore<SessionListState>({ ids: ids.map(sid), byId: {}, phase: 'ready', projectionsBySession: {} })
  const locale = createSnapshotStore<'zh' | 'en'>('zh')
  const sources = new Set<WorkspaceSessionGroupSource>()
  const register = vi.fn((source: WorkspaceSessionGroupSource) => {
    sources.add(source)
    return () => { sources.delete(source) }
  })
  const refreshProjections = vi.fn(refresh)
  const refreshList = vi.fn(async () => {})
  ctx.provide('sessions', { list, refreshProjections, refresh: refreshList })
  ctx.provide('locale', locale)
  ctx.provide('uiWorkspace', { registerSessionGroup: register })
  const plugin = await ctx.plugin({
    inject: ['sessions', 'locale', 'uiWorkspace'],
    apply: context => registerAutomationSessionGroup(context, key => (locale.getSnapshot() === 'zh' ? zh : en)[key]),
  })
  const source = register.mock.calls[0]![0]
  const owned = (id: SessionId, value: boolean) => list.set({
    ...list.getSnapshot(),
    projectionsBySession: { ...list.getSnapshot().projectionsBySession, [id]: { asOfSeq: 2, values: { tpcoworkAutomation: value } } },
  })
  return { ctx, list, locale, source, sources, plugin, owned, refreshProjections, refreshList }
}

describe('scheduled Session sidebar membership', () => {
  it('hydrates old runs in sequence and groups only durable ownership, with stable localized snapshots', async () => {
    const pending = new Map<SessionId, () => void>()
    const h = await harness(['automation-owned', 'automation-unrelated', 'regular'], id => new Promise(resolve => { pending.set(id, resolve) }))
    expect(h.refreshList).toHaveBeenCalledTimes(1)
    expect(h.refreshProjections.mock.calls).toEqual([[sid('automation-owned')]])
    expect(h.source.getSnapshot().sessionIds).toEqual([])
    h.owned(sid('automation-owned'), true)
    pending.get(sid('automation-owned'))!()
    await vi.waitFor(() => expect(h.refreshProjections).toHaveBeenCalledTimes(2))
    h.owned(sid('automation-unrelated'), false)
    pending.get(sid('automation-unrelated'))!()
    await vi.waitFor(() => expect(h.source.getSnapshot().sessionIds).toEqual([sid('automation-owned')]))
    expect(h.refreshProjections.mock.calls).toEqual([[sid('automation-owned')], [sid('automation-unrelated')]])
    const snapshot = h.source.getSnapshot()
    h.list.set({ ...h.list.getSnapshot() })
    expect(h.source.getSnapshot()).toBe(snapshot)
    const listener = vi.fn()
    h.source.subscribe(listener)
    h.locale.set('en')
    expect(h.source.getSnapshot()).toMatchObject({ label: 'Scheduled tasks', sessionIds: [sid('automation-owned')] })
    expect(listener).toHaveBeenCalledTimes(1)
    await h.plugin.dispose()
    expect(h.sources.size).toBe(0)
    h.locale.set('zh')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('retries unavailable history after reconnect and stops reading when the plugin leaves', async () => {
    let finish: (() => void) | undefined
    const h = await harness(['automation-first', 'automation-next'], async () => {})
    await vi.waitFor(() => expect(h.refreshProjections).toHaveBeenCalledTimes(2))
    h.refreshProjections.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    h.ctx.emit('connection/reset')
    expect(h.refreshProjections).toHaveBeenCalledTimes(3)
    await h.plugin.dispose()
    finish!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.refreshProjections).toHaveBeenCalledTimes(3)
    expect(h.sources.size).toBe(0)
  })
})
