/** Disposable DSH slot registration using the host's React and TP theme tokens. */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { TypertClientRemote, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-permission-presets/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { AutomationBindingsRequest, AutomationBindingsValue, AutomationProject, AutomationUiServices } from './ui-types.ts'
import type { AutomationServiceApi } from './types.ts'
import { bindingsValue } from './bindings-remote.ts'
import { AutomationPage } from './AutomationPage.tsx'
import { en, zh, type UiKey } from './ui-locales.ts'
import css from './ui.css'
import { openRunSession } from './open-run-session.ts'
import { AutomationCatalog } from './ui-state.ts'
import { AutomationRunMonitor } from './run-monitor.ts'
import { AutomationNotices } from './AutomationNotices.tsx'
import { AutomationIcon } from './AutomationIcon.tsx'
import { isUnread } from './run-history.ts'
import { registerAutomationSessionGroup } from './session-groups.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'tpcowork.automation': UiKey } }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertClientRemote {
    automationBindings: { list(request: AutomationBindingsRequest): Promise<RemoteResult<AutomationBindingsValue>> }
  }
}
// Keep the generated remote augmentation reachable for this externally built Client face.
export type AutomationBindingsRemote = TypertClientRemote['automationBindings']
const namespace = 'tpcowork.automation'
/** Required services all belong to the existing host Client composition. */
export const uiDependencies = ['slots', 'locale', 'layout', 'workspaces', 'sessions', 'uiWorkspace', 'automation', 'remote.automationBindings', 'remote.automationChanges', 'remote.session', 'remote.permissionPresets']

/** @param ctx - DSH Client scope; every registration is removed with this scope. */
export function registerAutomationUi(ctx: Context, remote?: Pick<ClientRemote, '$stream' | 'automationChanges'>): void {
  ctx.effect(() => ctx.locale.register(namespace, { en, zh }))
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@tpcowork/dsh-automation'
    style.textContent = css
    document.head.append(style)
    return () => style.remove()
  })
  const projectSource = ctx.workspaces.list
  let previous = projectSource.getSnapshot()
  const mapProjects = (): readonly AutomationProject[] => previous.items.map(item => ({ id: item.workspaceId, name: item.title, path: item.path }))
  let projects = mapProjects()
  const automation: AutomationServiceApi = {
    list: () => ctx.automation.list(), create: request => ctx.automation.create(request),
    update: request => ctx.automation.update(request), delete: request => ctx.automation.delete(request),
    pause: request => ctx.automation.pause(request), resume: request => ctx.automation.resume(request),
    runNow: request => ctx.automation.runNow(request), markRunViewed: request => ctx.automation.markRunViewed(request),
    deleteRun: async request => {
      const result = await ctx.automation.deleteRun(request)
      // Repair the sidebar baseline even when a removal event was missed during reconnect.
      await ctx.sessions.refresh()
      return result
    },
  }
  const catalog = new AutomationCatalog(automation)
  const services: AutomationUiServices = {
    automation,
    migrateNative: async () => {
      const result = await ctx.remote.automationMigration.migrate({ confirm: true })
      if (!result.ok) throw result.error
      return result.value
    },
    catalog,
    executionOptions: async () => {
      const [models, permissions] = await Promise.allSettled([
        Promise.resolve().then(() => ctx.remote.session.modelCatalog()),
        Promise.resolve().then(() => ctx.remote.permissionPresets.catalog()),
      ])
      const options = {
        ...(models.status === 'fulfilled' && models.value.ok ? { models: models.value.value } : {}),
        ...(permissions.status === 'fulfilled' && permissions.value.ok ? { permissions: permissions.value.value } : {}),
      }
      if (!options.models && !options.permissions) throw new Error('Execution options unavailable')
      return options
    },
    bindings: async request => {
      const result = await ctx.remote.automationBindings.list(request)
      if (!result.ok) throw result.error
      return bindingsValue.parse(result.value)
    },
    projects: {
      getSnapshot: () => {
        const current = projectSource.getSnapshot()
        if (current !== previous) { previous = current; projects = mapProjects() }
        return projects
      },
      subscribe: listener => projectSource.subscribe(listener),
    },
    askAssistant: prompt => ctx.uiWorkspace.startSession(undefined, { prompt, clearPreviousDraft: false }),
    openSession: (id, title, signal) => openRunSession(ctx.sessions, target => ctx.uiWorkspace.openSession(target), id, title, signal,
      error => ctx.logger.warn('Automation result title update failed; existing conversation remains readable.', error)),
  }
  const t = ctx.locale.bind(namespace)
  registerAutomationSessionGroup(ctx, t)
  const monitor = new AutomationRunMonitor(catalog, {
    ...(remote ? { remote } : {}),
    text: notice => ({ title: t(notice.status === 'error' ? 'notificationError' : 'notificationCompleted'), body: notice.taskName }),
    open: target => { catalog.openRun(target); ctx.layout.selectPanel('schedules' as MainPanelId) },
    report: error => ctx.logger.warn('Automation notification channel unavailable; catalog polling remains active.', error),
  })
  ctx.effect(() => () => monitor.dispose())
  ctx.on('connection/reset', () => { monitor.reconnect(); catalog.invalidate() })
  const Page = () => {
    const locale = React.useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot())
    return <AutomationPage services={services} t={t} locale={locale.active} />
  }
  const Icon = ({ size }: { size: number }) => {
    const state = React.useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)
    const unread = state.catalog?.tasks.reduce((count, task) => count + task.runs.filter(isUnread).length, 0) ?? 0
    return <span className="tp-auto-sidebar-icon"><AutomationIcon name="clock" size={size} />{unread > 0 && <span className="tp-auto-sidebar-unread" aria-label={`${t('unread')} ${unread}`} />}</span>
  }
  const Notices = () => {
    React.useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot())
    return <AutomationNotices monitor={monitor} t={t} />
  }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'schedules', priority: -20, locale: namespace }, Page))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'schedules', priority: -20, order: 10, locale: namespace, label: () => t('title') }, Icon))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'automation.results', locale: namespace }, Notices))
}
