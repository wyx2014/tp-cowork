/** Sidebar membership comes from durable run ownership, independently of retained task history. */
import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceSessionGroup } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from './session-projection-types.ts'
import type { UiText } from './ui-locales.ts'

/** Register the virtual group and hydrate missing ownership projections without opening Agents. */
export function registerAutomationSessionGroup(ctx: Context, t: UiText): void {
  const listeners = new Set<() => void>()
  const attempted = new Set<string>()
  let disposed = false
  let reading = false
  let snapshot: WorkspaceSessionGroup = { key: 'tpcowork:scheduled-sessions', label: t('scheduledSessions'), icon: 'clock', sessionIds: [] }
  const hydrate = async () => {
    if (reading) return
    reading = true
    try {
      while (!disposed) {
        const list = ctx.sessions.list.getSnapshot()
        // This producer's id namespace only selects read candidates; the saved marker decides membership.
        const id = list.ids.find(id => id.startsWith('automation-') && list.projectionsBySession[id]?.values.tpcoworkAutomation === undefined && !attempted.has(id))
        if (id === undefined) break
        attempted.add(id)
        try { await ctx.sessions.refreshProjections(id) }
        catch (error) { if (!disposed) ctx.logger.warn('自动化会话分组读取失败。', error) }
      }
    } finally { reading = false }
  }
  const update = () => {
    const list = ctx.sessions.list.getSnapshot()
    const owned = list.ids.filter(id => list.projectionsBySession[id]?.values.tpcoworkAutomation === true)
    const label = t('scheduledSessions')
    if (snapshot.label !== label || owned.length !== snapshot.sessionIds.length || owned.some((id, index) => id !== snapshot.sessionIds[index])) {
      snapshot = { ...snapshot, label, sessionIds: owned }
      for (const listener of listeners) listener()
    }
    void hydrate()
  }
  ctx.effect(() => {
    const unlist = ctx.sessions.list.subscribe(update)
    const unlocale = ctx.locale.subscribe(update)
    update()
    // Reconcile entries left by older clients that missed cold-Session deletion notifications.
    void ctx.sessions.refresh().catch(error => { if (!disposed) ctx.logger.warn('自动化会话目录刷新失败。', error) })
    return () => { disposed = true; unlist(); unlocale(); listeners.clear() }
  })
  ctx.on('connection/reset', () => { attempted.clear(); update() })
  ctx.effect(() => ctx.uiWorkspace.registerSessionGroup({
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }))
}
