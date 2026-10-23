/** Synchronize the selection owner with native atomic composer references. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { Context } from '@deepseek-ai/cordis'
import type { ReferenceInsert, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UserTextReference } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Choice, ToolboxModel } from '../client/model.ts'
import type { SelectionDraft, TeamItem } from '../contracts/index.ts'
import { mcpIcon, teamIcon } from './capability-presentation.ts'

/** Stable codec identity of the toolbox's inline composer selection. */
export const capabilityReferenceSource = 'toolbox-capabilities'
type Kind = 'team' | 'skill' | 'mcp'
type Capability = { kind: Kind; id: string; label: string }

function reference(value: Capability, skillLabel: (name: string) => string = name => name): ReferenceInsert {
  const ref = JSON.stringify([value.kind, value.id, value.label])
  return { source: capabilityReferenceSource, ref, label: value.kind === 'skill' ? skillLabel(value.label) : value.label, appearance: value.kind, clipboardText: capabilityClipboardText(ref) }
}

/**
 * Put the selected team on its own first line while retaining editable prose and references.
 * @param ctx - target Session scope with native input event handlers.
 * @param input - prepared native composer.
 * @param team - selected team from the reviewed catalog.
 */
export function prependTeamReference(ctx: Context, input: SessionInput, team: TeamItem): void {
  const prior = input.state.getSnapshot().occurrences.filter(item => item.source === capabilityReferenceSource)
  input.syncReferences(capabilityReferenceSource, prior.filter(item => decode(item.ref)?.kind !== 'team').map(({ source, ref, label, clipboardText, appearance }) => ({
    source, ref, label, clipboardText, ...(appearance ? { appearance } : {}),
  })))
  const { draft } = input.state.getSnapshot()
  const separator = /^[ \t]*\n[ \t]*\n/u.test(draft) ? '' : /^[ \t]*\n/u.test(draft) ? '\n' : '\n\n'
  const span = () => ({ start: 0, end: 0, draftRev: input.state.getSnapshot().draftRev })
  if ((separator && !ctx.bail(ctx, 'slash/input-insert-text', { text: separator, span: span() }))
    || !input.insertReference(reference({ kind: 'team', id: team.id, label: team.name }), span())) {
    throw new Error('toolbox/draft-unavailable')
  }
}

function decode(ref: string): Capability | undefined {
  try {
    const value: unknown = JSON.parse(ref)
    if (!Array.isArray(value) || value.length !== 3) return undefined
    const [kind, id, label] = value
    if ((kind !== 'team' && kind !== 'skill' && kind !== 'mcp') || typeof id !== 'string' || typeof label !== 'string') return undefined
    return { kind, id, label }
  } catch (error) {
    // Persisted drafts may contain references from a removed or older source.
    return undefined
  }
}

/**
 * Project a capability reference to readable clipboard and message text.
 * @param ref - source-owned serialized reference.
 * @returns the skill or connector mention.
 */
export function capabilityClipboardText(ref: string): string {
  const capability = decode(ref)
  if (!capability) throw new Error('toolbox/invalid-reference')
  return `${capability.kind === 'skill' ? '$' : '@'}${capability.label}`
}

/**
 * Identify sent mentions independently of the current draft selection.
 * Disabled catalog entries remain recognizable in historical messages.
 * @param choice - the Session's loaded catalog.
 * @param presentation - optional localized labels and images; lookup names stay canonical.
 * @returns exact semantic mentions, or undefined before the catalog loads.
 */
export function capabilityTextReferences(choice: Choice | undefined, presentation?: (name: string) => { label: string; iconSrc?: string }): readonly UserTextReference[] | undefined {
  const catalog = choice?.catalog
  if (!catalog) return undefined
  return [
    ...catalog.skills.items.map(item => ({ text: `$${item.name}`, kind: 'skill' as const, name: item.name,
      ...(item.path === undefined ? {} : { path: item.path }),
      ...(presentation?.(item.name)),
    })),
    ...catalog.mcp.items.map(item => ({ text: `@${item.label}`, kind: 'mcp' as const, name: item.label, iconSrc: mcpIcon(item.id) })),
    ...catalog.teams.items.map(item => ({ text: `@${item.name}`, kind: 'team' as const, name: item.name, iconSrc: teamIcon(item.id) })),
  ]
}

/**
 * Project selected capabilities to native editor references.
 * @param choice - current catalog and selection.
 * @returns references carrying stable capability identities and display labels.
 */
export function capabilityReferences(choice: Choice, skillLabel?: (name: string) => string): ReferenceInsert[] {
  const { draft, catalog } = choice
  const values: Capability[] = [
    ...(draft.team ? [{ kind: 'team' as const, id: draft.team.id, label: catalog?.teams.items.find(item => item.id === draft.team?.id)?.name ?? draft.team.id }] : []),
    ...draft.skillIds.map(id => ({ kind: 'skill' as const, id, label: catalog?.skills.items.find(item => item.id === id)?.name ?? id })),
    ...draft.mcpIds.map(id => ({ kind: 'mcp' as const, id, label: catalog?.mcp.items.find(item => item.id === id)?.label ?? id })),
  ]
  return values.map(value => reference(value, skillLabel))
}

function canEdit(choice: Choice): boolean {
  return choice.phase === 'draft' && !choice.unavailable && choice.catalog !== null
    && [choice.catalog.skills, choice.catalog.mcp, choice.catalog.teams].every(value => value.complete)
}

function adoptSkillReferences(choice: Choice, input: SessionInput): string[] {
  if (!canEdit(choice)) return []
  const adopted: string[] = []
  for (const occurrence of input.state.getSnapshot().occurrences) {
    if (occurrence.source !== 'skill' || occurrence.invalid) continue
    const skill = choice.catalog?.skills.items.find(item => `/${item.name}` === occurrence.ref
      && item.invocation.userInvocable && item.enabled && item.installed && item.readiness.state === 'ready')
    if (!skill) continue
    if (input.replaceReference(occurrence.occurrenceId, reference({ kind: 'skill', id: skill.id, label: skill.name }))) adopted.push(skill.id)
  }
  return adopted
}

function patchFromReferences(choice: Choice, refs: readonly string[]): Partial<Pick<SelectionDraft, 'team' | 'skillIds' | 'mcpIds'>> {
  const values = refs.flatMap(ref => { const value = decode(ref); return value ? [value] : [] })
  const teamId = values.find(value => value.kind === 'team')?.id
  const team = choice.catalog?.teams.items.find(item => item.id === teamId)
  return {
    team: team ? { id: team.id, version: team.version, workflowId: team.workflowId }
      : choice.draft.team?.id === teamId ? choice.draft.team : null,
    skillIds: [...new Set([
      ...values.filter(value => value.kind === 'skill' && (choice.draft.skillIds.includes(value.id)
        || choice.catalog?.skills.items.some(item => item.id === value.id && item.enabled && item.installed && item.readiness.state === 'ready'))).map(value => value.id),
      ...(team?.requiredSkillIds ?? []),
    ])],
    mcpIds: [...new Set(values.filter(value => value.kind === 'mcp' && (choice.draft.mcpIds.includes(value.id)
      || choice.catalog?.mcp.items.some(item => item.id === value.id && item.enabled && item.installed && item.readiness.state === 'ready'))).map(value => value.id))],
  }
}

/**
 * Bind one retained Session and adopt native slash-picked skills into its selection.
 * Popup closure orders token consumption before reference insertion.
 * @param model - the selection owner.
 * @param sessionId - retained Session identity.
 * @param input - native editor facade.
 * @param popup - native popup state used to preserve its revision-guarded token.
 * @returns disposer for subscriptions owned by the Session and plugin scopes.
 */
export function bindInlineCapabilities(model: ToolboxModel, sessionId: string, input: SessionInput, popup: ObservableSnapshot<{ readonly open: boolean }>, skillLabel?: (name: string) => string): () => void {
  let applying = false
  let disposed = false
  let pending = false
  let synchronized = false
  let modelKey = ''
  let editorKey = ''
  const actual = () => input.state.getSnapshot().occurrences.filter(value => value.source === capabilityReferenceSource).map(value => value.ref)
  const synchronize = () => {
    pending = false
    let choice = model.state.getSnapshot().choices[sessionId]
    if (disposed || popup.getSnapshot().open || !choice?.catalog) return
    const phase = input.state.getSnapshot().phase
    if (phase !== 'plain' && phase !== 'claimed') return
    const references = capabilityReferences(choice, skillLabel)
    applying = true
    try {
      const adopted = adoptSkillReferences(choice, input)
      const skillIds = choice.draft.skillIds
      if (adopted.some(id => !skillIds.includes(id))) {
        model.choose(sessionId, { skillIds: [...new Set([...skillIds, ...adopted])] })
        choice = model.state.getSnapshot().choices[sessionId]!
      }
      if (((!synchronized && actual().length > 0)
        || (synchronized && JSON.stringify(references) === modelKey && JSON.stringify(actual()) !== editorKey)) && canEdit(choice)) {
        model.choose(sessionId, patchFromReferences(choice, actual()))
        choice = model.state.getSnapshot().choices[sessionId]!
      }
      const selected = capabilityReferences(choice, skillLabel)
      if (input.syncReferences(capabilityReferenceSource, selected)) {
        modelKey = JSON.stringify(selected)
        editorKey = JSON.stringify(actual())
        synchronized = true
      }
    } finally { applying = false }
  }
  // Input notifications can run inside Lexical's commit listener, outside an active $-edit.
  // Batch structural reconciliation after that commit; popup state also orders native token consumption.
  const schedule = () => {
    if (disposed || applying || pending) return
    pending = true
    queueMicrotask(synchronize)
  }
  const offs = [model.state.subscribe(schedule), input.state.subscribe(schedule), popup.subscribe(schedule)]
  schedule()
  return () => { disposed = true; for (const off of offs) off() }

}

/**
 * Remove one clicked reference through the native Add menu's selection owner.
 * @param model - the selection owner.
 * @param sessionId - Session whose draft is edited.
 * @param ref - clicked reference identity.
 * @returns whether the selection permits removal.
 */
export function removeInlineCapability(model: ToolboxModel, sessionId: string, ref: string): boolean {
  const choice = model.state.getSnapshot().choices[sessionId]
  const value = decode(ref)
  if (!choice || !value || !canEdit(choice)) return false
  const team = choice.catalog?.teams.items.find(item => item.id === choice.draft.team?.id)
  if (value.kind === 'skill' && team?.requiredSkillIds.includes(value.id)) return false
  const references = capabilityReferences(choice).filter(reference => reference.ref !== ref)
  model.choose(sessionId, patchFromReferences(choice, references.map(reference => reference.ref)))
  return true
}
