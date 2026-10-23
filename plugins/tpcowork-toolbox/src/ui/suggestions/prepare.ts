import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolboxModel } from '../../client/model.ts'
import { capabilityReferences } from '../inline-capabilities.ts'
import { suggestionSkillLabel, type Suggestion } from './catalog.ts'
import type { T } from '../types.ts'

/** Resolve once, then replace the native draft and its selection together; never submit. */
export async function prepareSuggestion(options: {
  sessionId: string; item: Suggestion; input: SessionInput; model: ToolboxModel; loadChoice(): Promise<void>; signal: AbortSignal; t: T
}): Promise<'ready' | 'unavailable' | 'cancelled'> {
  const { sessionId, item, input, model, signal, t } = options
  const revision = input.state.getSnapshot().draftRev
  await options.loadChoice()
  const state = input.state.getSnapshot()
  if (signal.aborted || state.draftRev !== revision || !['plain', 'claimed'].includes(state.phase)) return 'cancelled'
  const choice = model.state.getSnapshot().choices[sessionId]
  if (!choice?.catalog || choice.unavailable || choice.phase !== 'draft'
    || ![choice.catalog.skills, choice.catalog.mcp, choice.catalog.teams].every(value => value.complete)) throw new Error('toolbox/selection-unavailable')
  const candidates = choice.catalog.skills.items.filter(skill => skill.name === item.skill && skill.installed && skill.enabled && skill.invocation.userInvocable && skill.readiness.state === 'ready')
  const skill = candidates.length === 1 ? candidates[0] : undefined
  const template = t(item.prompt, { skill: '{skill}' })
  const token = skill ? `$${skill.name}` : item.skill ? suggestionSkillLabel(item.skill, t) : ''
  const text = template.replace('{skill}', token)
  // The selection and native editor share one synchronous write, so reconciliation cannot insert a duplicate mention.
  model.choose(sessionId, { team: null, skillIds: skill ? [skill.id] : [], mcpIds: [] })
  input.setDraft(text)
  if (skill) {
    const reference = capabilityReferences(model.state.getSnapshot().choices[sessionId]!, name => suggestionSkillLabel(name, t))[0]!
    const start = template.indexOf('{skill}')
    if (start < 0 || !input.insertReference(reference, { start, end: start + token.length, draftRev: input.state.getSnapshot().draftRev })) throw new Error('toolbox/draft-unavailable')
  }
  input.focus()
  return item.skill && !skill ? 'unavailable' : 'ready'
}
