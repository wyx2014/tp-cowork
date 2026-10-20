/** Capability selection contributes to DSH's native Add menu and popup shell. */
import { IconCordisPluginOutlineRegular, IconSkillOutlineRegular, IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommandContribution, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Choice } from '../client/model.ts'
import type { SelectionDraft } from '../contracts/index.ts'
import { visibleMcp } from '../client/visibility.ts'
import type { T, UiActions } from './types.ts'

type Category = 'teams' | 'skills' | 'mcp'
type SelectionPatch = Partial<Pick<SelectionDraft, 'team' | 'skillIds' | 'mcpIds'>>
interface ChoiceOption extends SelectOption { patch: SelectionPatch }
interface ChoiceCommandsDeps extends Pick<UiActions, 'loadChoice' | 'choose'> {
  choice(sessionId: SessionId): Choice | undefined
  available(sessionId: SessionId, category: Category): boolean
  t: T
}

function optionsOf(category: Category, choice: Choice, t: T): ChoiceOption[] {
  const { catalog, draft } = choice
  if (!catalog) return []
  const fixed = choice.phase !== 'draft'
  const blocked = fixed ? t(choice.phase === 'submitting' ? 'submitting' : 'fixed')
    : choice.unavailable ? t('unavailable')
      : [catalog.skills, catalog.mcp, catalog.teams].some(value => !value.complete) ? t('incomplete') : undefined
  const selectedTeam = catalog.teams.items.find(item => item.id === draft.team?.id)
  const rows: ChoiceOption[] = []
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]
  const add = (id: string, label: string, detail: string, active: boolean, reason: string | undefined, patch: SelectionPatch) => {
    rows.push({
      id: JSON.stringify([catalog.revision, id, active]), label,
      detail: blocked ?? reason ?? detail, active, disabled: blocked !== undefined || reason !== undefined, patch,
    })
  }
  if (category === 'teams') {
    for (const team of catalog.teams.items) {
      const active = draft.team?.id === team.id
      add(team.id, team.name, t('memberCount', { count: team.members.length }), active,
        active ? undefined : !team.enabled ? t('disabled') : team.readiness.state !== 'ready' ? t(team.readiness.state) : undefined,
        active ? { team: null } : {
          team: { id: team.id, version: team.version, workflowId: team.workflowId },
          skillIds: [...new Set([...draft.skillIds, ...team.requiredSkillIds])],
        })
    }
  } else if (category === 'skills') {
    for (const skill of catalog.skills.items.filter(item => item.invocation.userInvocable || draft.skillIds.includes(item.id))) {
      const active = draft.skillIds.includes(skill.id)
      const required = selectedTeam?.requiredSkillIds.includes(skill.id)
      add(skill.id, `/${skill.name}`, skill.description, active,
        required ? t('requiredByTeam') : active ? undefined : !skill.installed ? t('notInstalled')
          : !skill.enabled ? t('disabled') : skill.readiness.state !== 'ready' ? t(skill.readiness.state) : undefined,
        { skillIds: toggle(draft.skillIds, skill.id) })
    }
  } else {
    for (const mcp of catalog.mcp.items.filter(visibleMcp)) {
      const active = draft.mcpIds.includes(mcp.id)
      add(mcp.id, mcp.label, t(mcp.readiness.state), active,
        active ? undefined : !mcp.installed ? t('notInstalled') : !mcp.enabled ? t('disabled')
          : mcp.readiness.state !== 'ready' ? t(mcp.readiness.state) : undefined,
        { mcpIds: toggle(draft.mcpIds, mcp.id) })
    }
  }
  const selectedIds = category === 'teams' ? draft.team ? [draft.team.id] : [] : category === 'skills' ? draft.skillIds : draft.mcpIds
  for (const id of selectedIds) {
    if (rows.some(row => row.id === JSON.stringify([catalog.revision, id, true]))) continue
    add(id, id, t('error'), true, undefined,
      category === 'teams' ? { team: null } : category === 'skills'
        ? { skillIds: draft.skillIds.filter(value => value !== id) } : { mcpIds: draft.mcpIds.filter(value => value !== id) })
  }
  return rows
}

/**
 * Build native command contributions over the shared selection draft.
 * @param deps - live selection state, mutations and localized copy.
 * @returns registrations whose disposers belong to the plugin effect scope.
 */
export function choiceCommands(deps: ChoiceCommandsDeps): CommandContribution[] {
  const { t } = deps
  return (['teams', 'skills', 'mcp'] as const).map(category => ({
    name: category === 'teams' ? 'expert-team' : category === 'skills' ? 'task-skills' : 'connectors',
    section: 'add',
    label: () => t(category === 'mcp' ? 'connectors' : category),
    description: () => t(category === 'teams' ? 'searchTeams' : category === 'skills' ? 'searchSkills' : 'searchConnectors'),
    icon: category === 'teams' ? IconUsersOutlineRegular : category === 'skills' ? IconSkillOutlineRegular : IconCordisPluginOutlineRegular,
    available: session => deps.available(session.sessionId, category),
    ui: {
      kind: 'popupSelect',
      searchLabels: () => ({
        placeholder: t(category === 'teams' ? 'searchTeams' : category === 'skills' ? 'searchSkills' : 'searchConnectors'),
        empty: t('empty'), noResults: t('noMatches'),
      }),
      options: async (session, signal) => {
        await deps.loadChoice(session.sessionId)
        if (signal.aborted) return []
        const choice = deps.choice(session.sessionId)
        if (!choice?.catalog || choice.unavailable) throw new Error(t('unavailable'))
        const rows: SelectOption[] = optionsOf(category, choice, t)
        if (choice.phase === 'draft') rows.push({
          id: 'refresh', label: t('retryChoices'),
          detail: t(choice.draft.expectedRevision !== choice.catalog.revision ? 'stale' : 'selectionHint'),
        })
        return rows
      },
      onSelect: async (option, session) => {
        if (!deps.available(session.sessionId, category)) throw new Error(t('unavailable'))
        const choice = deps.choice(session.sessionId)
        if (!choice?.catalog || choice.unavailable) throw new Error(t('unavailable'))
        if (choice.phase !== 'draft') throw new Error(t(choice.phase === 'submitting' ? 'submitting' : 'fixed'))
        if (option.id === 'refresh') {
          await deps.loadChoice(session.sessionId, true)
          const refreshed = deps.choice(session.sessionId)
          if (!refreshed?.catalog || refreshed.unavailable) throw new Error(t('unavailable'))
          if ([refreshed.catalog.skills, refreshed.catalog.mcp, refreshed.catalog.teams].some(value => !value.complete)) throw new Error(t('incomplete'))
          return
        }
        const current = optionsOf(category, choice, t).find(row => row.id === option.id)
        if (!current) throw new Error(t('stale'))
        if (current.disabled) throw new Error(current.detail)
        deps.choose(session.sessionId, current.patch)
      },
    },
  }))
}
