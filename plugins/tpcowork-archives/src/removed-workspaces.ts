/**
 * Client half of ZCode's project model (Host half: `workspace-removals.ts`). ZCode has no Ungrouped, so the sessions in
 * no workspace go into one virtual sidebar group, which takes them out of DSH's Ungrouped, and neither that group, its
 * rows nor the Ungrouped section are drawn. Sessions another plugin groups (such as scheduled tasks) keep their group.
 * The removal confirmation's last sentence is reworded to match: DSH says the sessions will appear under Ungrouped.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceSessionGroup } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'

export const REMOVED_GROUP_KEY = 'tpcowork:removed-workspaces'

/** DSH's sentence about Ungrouped in the "Delete workspace" confirmation, and its replacement, per language. */
export const REMOVAL_WORDING: readonly (readonly [string, string])[] = [
  ['其会话将显示在“未分组”下。', '其会话会随工作区一起隐藏，重新添加此文件夹即可恢复。'],
  ['Its sessions will appear under Ungrouped.', 'Its sessions are hidden with it and come back when you add this folder again.'],
]

/**
 * What the sidebar must not draw: the virtual group's section, the Ungrouped section (DSH keys it with an empty group
 * key), and each hidden session, which also covers the flat list.
 */
export function hiddenRowsCss(sessionIds: readonly string[]): string {
  const sections = [`workspace:${REMOVED_GROUP_KEY}`, 'workspace:'].map(key => `[data-row-key="${key}"]`)
  const rows = [...sections, `[data-row-key="overflow:${REMOVED_GROUP_KEY}"]`, '[data-row-key="overflow:"]',
    ...sessionIds.map(id => `[data-row-key="session:${CSS.escape(id)}"]`)]
  return `${sections.map(section => `[style*="--dsh-workspace-indent"]:has(> * ${section}, > ${section})`).join(', ')}, ${rows.join(', ')} { display: none !important; }`
}

/** Loose sessions minus the ones another plugin's group shows, such as scheduled tasks. */
export function ownHidden(ids: readonly string[], groups: readonly WorkspaceSessionGroup[]): string[] {
  const elsewhere = new Set(groups.filter(group => group.key !== REMOVED_GROUP_KEY).flatMap(group => group.sessionIds as readonly string[]))
  return ids.filter(id => !elsewhere.has(id))
}

/** Replace DSH's Ungrouped sentence in the text under `root`. @returns whether anything changed. */
export function rewordRemoval(root: Node): boolean {
  let changed = false
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const [native, ours] of REMOVAL_WORDING) {
      if (node.nodeValue?.includes(native)) { node.nodeValue = node.nodeValue.replace(native, ours); changed = true }
    }
  }
  return changed
}

/**
 * Keep removed workspaces' sessions out of the sidebar and reword the removal confirmation.
 * @param ctx - Client context with `uiWorkspace`, `workspaces` and `sessions` (read as the Client face, as DSH's sidebar does).
 * @param readHidden - the Host's current hidden session ids.
 */
export function installRemovedWorkspaces(ctx: Context, readHidden: () => Promise<string[]>): void {
  const listeners = new Set<() => void>()
  let snapshot: WorkspaceSessionGroup = { key: REMOVED_GROUP_KEY, label: '', sessionIds: [] }
  const style = document.createElement('style')
  style.dataset.plugin = '@tpcowork/dsh-archives:removed-workspaces'
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = async () => {
    try {
      const ids = ownHidden(await readHidden(), ctx.uiWorkspace.sessionGroups.getSnapshot())
      if (disposed) return
      style.textContent = hiddenRowsCss(ids)
      if (ids.length === snapshot.sessionIds.length && ids.every((id, index) => id === snapshot.sessionIds[index])) return
      snapshot = { ...snapshot, sessionIds: ids as unknown as WorkspaceSessionGroup['sessionIds'] }
      for (const listener of listeners) listener()
    } catch (error) {
      if (!disposed) ctx.logger.warn('tpcowork-archives: hidden sessions unavailable', error)
    }
  }
  // Removals, re-adds and new sessions all show up in these lists; one Host read follows a burst of changes.
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh() }, 150) }
  ctx.effect(() => {
    document.head.appendChild(style)
    const offs = [ctx.workspaces.list.subscribe(schedule), (ctx.get('sessions') as unknown as ISessions).list.subscribe(schedule),
      ctx.uiWorkspace.sessionGroups.subscribe(schedule)]
    void refresh()
    return () => { disposed = true; clearTimeout(timer); offs.forEach(off => off()); listeners.clear(); style.remove() }
  }, 'tpcowork-archives: removed workspace sessions')
  ctx.on('connection/reset', schedule)
  ctx.effect(() => ctx.uiWorkspace.registerSessionGroup({
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }), 'tpcowork-archives: removed workspace group')
  // The confirmation is a portal under <body>; its text is reworded as it appears.
  ctx.effect(() => {
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          const dialog = node.closest('[role="dialog"], [role="alertdialog"]') ?? node.querySelector('[role="dialog"], [role="alertdialog"]')
          if (dialog) rewordRemoval(dialog)
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, 'tpcowork-archives: removal wording')
}
