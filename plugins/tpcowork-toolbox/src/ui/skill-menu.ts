/** Present DSH's native `/` skill rows like the Add menu's skill picker. */
import type { InputTriggerCandidate } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { Choice } from '../client/model.ts'
import { orderSkills, skillPresentation } from './skill-presentation.ts'
import type { T } from './types.ts'

/**
 * Relabel, reorder and gate the native slash skill candidates with the toolbox catalog.
 * Candidate names stay canonical, so a pick still inserts the native `/name` reference.
 * @param choice - the Session's loaded catalog and selection; undefined before it loads.
 * @param candidates - native rows in host catalog order.
 * @param t - toolbox copy.
 * @returns rows in the Add menu's order, with its icons, labels, reasons and selection checks.
 */
export function presentSkillCandidates(choice: Choice | undefined, candidates: readonly InputTriggerCandidate[], t: T): InputTriggerCandidate[] {
  const items = choice?.catalog?.skills.items ?? []
  const byName = new Map(items.map(item => [item.name, item]))
  const selected = choice?.draft.skillIds ?? []
  // The Add menu lists catalog order with the document skills first; skills the toolbox does not know close the list.
  const rank = new Map(orderSkills(items).map((item, index) => [item.name, index]))
  const ordered = orderSkills(candidates).map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => (rank.get(a.candidate.name) ?? rank.size) - (rank.get(b.candidate.name) ?? rank.size) || a.index - b.index)
  return ordered.flatMap(({ candidate }) => {
    const skill = byName.get(candidate.name)
    const active = skill !== undefined && selected.includes(skill.id)
    if (skill && !skill.invocation.userInvocable && !active) return []
    const display = skillPresentation(candidate.name, t)
    const reason = !skill || active ? undefined : !skill.installed ? t('notInstalled')
      : !skill.enabled ? t('disabled') : skill.readiness.state !== 'ready' ? t(skill.readiness.state) : undefined
    const description = reason ?? display.description ?? skill?.description ?? candidate.description
    return [{
      ...candidate, label: display.label, keywords: display.keywords,
      ...(display.iconSrc ? { iconSrc: display.iconSrc } : {}), ...(description ? { description } : {}),
      ...(reason ? { disabled: true } : {}), ...(active ? { active: true } : {}),
    }]
  })
}
