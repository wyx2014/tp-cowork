import { skillPresentation, skillReferenceStyles } from './skill-presentation.ts'
import { capabilityReferenceStyles } from './capability-presentation.ts'
/** Registration owns services and effects; components receive callbacks and framework hooks. */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { ToolboxModel, needsToolboxAdmission, selectionIssues } from '../client/model.ts'
import { unwrap } from '../client/remote.ts'
import { ToolboxWatch } from '../client/watch.ts'
import { pickSkillDirectory } from '../client/skill-directory.ts'
import { prepareSkillArchive } from '../client/skill-package.ts'
import { admissionFailure } from '../client/failure.ts'
import { ToolboxPage } from './Page.tsx'
import { ChoiceDock } from './Choices.tsx'
import { choiceCommands } from './choice-commands.ts'
import { bindInlineCapabilities, capabilityClipboardText, capabilityReferenceSource, capabilityTextReferences, prepareSkillCreationDraft, prependTeamReference, removeInlineCapability } from './inline-capabilities.ts'
import type { UiActions, UiInjected } from './types.ts'
import { en, zh, type UiKey } from './locales.ts'
import { styles } from './styles.ts'
import { registerSuggestions } from './suggestions/register.tsx'
import { prepareSuggestion } from './suggestions/prepare.ts'
import { suggestionSkillLabel } from './suggestions/catalog.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'tpcowork.toolbox': UiKey } }
const namespace = 'tpcowork.toolbox'
export const uiDependencies = [
  'slots', 'locale', 'layout', 'sessions', 'uiWorkspace', 'commandUi', 'conversation', 'inputTriggers',
  'remote.session', 'remote.toolbox', 'remote.toolboxChanges', 'remote.toolboxSkills', 'remote.toolboxInstaller',
  'remote.toolboxMcp', 'remote.toolboxTeams', 'remote.toolboxTpcoworkHub', 'remote.toolboxTasks',
]

export function registerToolboxUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(namespace, { en, zh }))
  ctx.effect(() => {
    const style = document.createElement('style'); style.dataset.plugin = '@tpcowork/dsh-toolbox'; style.textContent = styles + skillReferenceStyles + capabilityReferenceStyles
    document.head.append(style); return () => style.remove()
  })
  const remote: ClientRemote = ctx.remote
  const model = new ToolboxModel(remote)
  const watch = new ToolboxWatch(remote, model)
  ctx.effect(() => () => watch.dispose())
  ctx.on('connection/reset', () => { watch.reconnect() })
  const t = ctx.locale.bind(namespace)
  const inlineBindings = new Map<SessionBinding, () => void>()
  ctx.effect(() => () => { for (const dispose of [...inlineBindings.values()]) dispose() })
  const bindInline = (sessionId: string) => {
    const binding = ctx.sessions.binding(sessionId as SessionId)
    if (!binding || inlineBindings.has(binding) || ctx.sessions.subagentAddress(binding.sessionId) !== undefined) return
    const input = ctx.conversation.input.for(binding.ctx)
    // popupFor's public wiring face is opaque; its observable state is shared with the native overlay.
    const popup = ctx.commandUi.popupFor(binding.ctx) as { state: ObservableSnapshot<{ readonly open: boolean }> }
    const unbind = bindInlineCapabilities(model, sessionId, input, popup.state, name => suggestionSkillLabel(name, t))
    const dispose = () => { unbind(); inlineBindings.delete(binding) }
    inlineBindings.set(binding, dispose)
    binding.ctx.effect(() => dispose)
  }
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: '@', name: capabilityReferenceSource,
    candidates: async () => [], onPick: () => 'handled',
    warm: session => { if (ctx.sessions.subagentAddress(session.sessionId) === undefined) void model.loadChoice(session.sessionId) },
    textReferences: session => capabilityTextReferences(model.state.getSnapshot().choices[session.sessionId], name => skillPresentation(name, t)),
    subscribeLexicon: (_session, listener) => model.state.subscribe(listener),
    codec: { clipboardText: capabilityClipboardText, serialize: async ref => capabilityClipboardText(ref) },
    openReference: (session, reference) => removeInlineCapability(model, session.sessionId, reference.ref),
  }))
  const actions: UiActions = {
    refresh: () => model.refresh(), refreshSkills: () => model.refresh('skills'), setTab: tab => model.setTab(tab),
    skillDetail: request => unwrap(remote.toolboxSkills.detail(request)), skillEnable: request => model.setSkillEnabled(request),
    skillRemove: request => unwrap(remote.toolboxSkills.remove(request)), skillCheck: request => model.checkSkill(request),
    callSetup: request => unwrap(remote.toolboxSkills.callSetup(request)),
    saveCallSetup: request => unwrap(remote.toolboxSkills.saveCallSetup(request)),
    prepareImport: request => unwrap(remote.toolboxInstaller.prepareLocalImport(request)), skillInstall: request => unwrap(remote.toolboxInstaller.install(request)),
    prepareSkillArchive: file => prepareSkillArchive(file, request => unwrap(remote.toolboxInstaller.prepareLocalImport(request)), request => unwrap(remote.toolboxInstaller.prepareArchive(request))),
    pickSkillDirectory: () => pickSkillDirectory(() => ctx.uiWorkspace.pickDirectory()),
    openSkillDirectory: async path => { await unwrap(remote.session.openWorkspacePath({ path })) },
    prepareManualSkill: request => unwrap(remote.toolboxInstaller.prepareSkill(request)),
    mcpDefinition: request => unwrap(remote.toolboxMcp.definition(request)), mcpCreate: request => unwrap(remote.toolboxMcp.create(request)),
    mcpUpdate: request => unwrap(remote.toolboxMcp.update(request)), mcpRemove: request => unwrap(remote.toolboxMcp.remove(request)), mcpEnable: request => unwrap(remote.toolboxMcp.setEnabled(request)),
    mcpProbe: (request, signal) => unwrap(remote.toolboxMcp.probe(request, signal)),
    mcpInventory: () => unwrap(remote.toolboxMcp.inventory()), mcpImport: request => unwrap(remote.toolboxMcp.importDefinitions(request)),
    mcpProbeDraft: (request, signal) => unwrap(remote.toolboxMcp.probeDraft(request, signal)),
    hubAccount: () => unwrap(remote.toolboxTpcoworkHub.account()), hubLogin: (request, signal) => unwrap(remote.toolboxTpcoworkHub.login(request, signal)), hubLogout: () => unwrap(remote.toolboxTpcoworkHub.logout()),
    hubList: (request, signal) => unwrap(remote.toolboxTpcoworkHub.list(request, signal)), hubDetail: (request, signal) => unwrap(remote.toolboxTpcoworkHub.detail(request, signal)), hubInstall: (request, signal) => unwrap(remote.toolboxTpcoworkHub.install(request, signal)), hubPublish: (request, signal) => unwrap(remote.toolboxTpcoworkHub.publish(request, signal)),
    prepareSkill: template => ctx.uiWorkspace.startSession(undefined, {
      prompt: template.replace('{skill}', skillPresentation('skill-creator', t).label), clearPreviousDraft: false,
      onPrepared: sessionId => {
        const binding = ctx.sessions.binding(sessionId)!
        prepareSkillCreationDraft(ctx.conversation.input.for(binding.ctx), template, skillPresentation('skill-creator', t).label)
      },
    }),
    prepareTeam: (team, prompt) => ctx.uiWorkspace.startSession(undefined, { prompt, clearPreviousDraft: false, reuseBlank: false, onPrepared: sessionId => {
      const binding = ctx.sessions.binding(sessionId)!
      prependTeamReference(binding.ctx, ctx.conversation.input.for(binding.ctx), team)
      model.prepareTeam(sessionId, team)
    } }),
    loadChoice: (sessionId, confirm) => { bindInline(sessionId); return model.loadChoice(sessionId, confirm) }, choose: (sessionId, patch) => model.choose(sessionId, patch),
  }
  const injected = (): UiInjected => ({ ...actions, hooks: { toolbox: model.state } })
  registerSuggestions(ctx, { t, prepare: async (sessionId, item, signal) => {
    const binding = ctx.sessions.binding(sessionId as SessionId)
    if (!binding) return 'cancelled'
    return prepareSuggestion({ sessionId, item, signal, model, t, input: ctx.conversation.input.for(binding.ctx), loadChoice: () => actions.loadChoice(sessionId) })
  } })
  for (const contribution of choiceCommands({
    ...actions, t,
    choice: sessionId => model.state.getSnapshot().choices[sessionId],
    available: (sessionId, category) => ctx.sessions.subagentAddress(sessionId) === undefined
      && model.state.getSnapshot().description?.modules[category] !== false,
  })) ctx.effect(() => ctx.commandUi.register(contribution))
  ctx.on('client-session/prompt-admission', async ({ request, signal }, next) => {
    let choice = model.state.getSnapshot().choices[request.sessionId]
    // Persisted editor references can appear before the saved capability context is loaded.
    // An initial empty cache entry must not let that message bypass toolbox admission.
    if (!choice?.catalog) {
      if (!model.state.getSnapshot().description) await model.refresh()
      const description = model.state.getSnapshot().description
      if (!description) return admissionFailure('toolbox/selection-unavailable', t('unavailable'))
      if (description.modules.teams) {
        await actions.loadChoice(request.sessionId)
        choice = model.state.getSnapshot().choices[request.sessionId]
        if (!choice?.catalog || choice.unavailable) return admissionFailure('toolbox/selection-unavailable', t('unavailable'))
      }
    }
    if (!choice || !needsToolboxAdmission(choice)) return next()
    const issues = selectionIssues(choice)
    if (choice.phase === 'draft' && issues.length > 0) {
      return admissionFailure('toolbox/selection-unavailable', t(issues.length === 1 && issues[0] === 'stale' ? 'stale' : 'invalidSelection'))
    }
    try { return { ok: true, value: await model.submit(request, signal ?? new AbortController().signal) } }
    catch (error) { return admissionFailure('toolbox/admission-failed', t('failed')) }
  })
  const Icon = ({ size }: { size: number }) => <svg data-testid="toolbox-navigation" className="tp-toolbox-sidebar-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6H5a2 2 0 0 1 0-4h10a7 7 0 0 1 7 7v5a8 8 0 0 1-16 0" />
    <circle cx="5" cy="12" r="3" /><circle cx="13" cy="12" r="3" /><path d="M8 12h2" />
  </svg>
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'toolbox', priority: -15, locale: namespace, inject: injected }, ToolboxPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'toolbox', priority: -15, order: 11, locale: namespace, label: () => t('sidebarLabel') }, Icon))
  ctx.slots.inject('conversation.input.selection', () => ctx.slots.register({ name: 'conversation.input.selection', id: 'toolbox.selection', order: -20, locale: namespace, inject: injected }, ChoiceDock))
  ctx.provide('toolboxNavigation', { open: (tab: Parameters<UiActions['setTab']>[0] = 'teams') => { model.setTab(tab); ctx.layout.selectPanel('toolbox' as MainPanelId) } })
}
declare module '@deepseek-ai/cordis' { interface Context { toolboxNavigation: { open(tab?: Parameters<UiActions['setTab']>[0]): void } } }
