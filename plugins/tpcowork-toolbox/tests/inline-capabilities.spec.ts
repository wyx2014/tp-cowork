// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { $nodesOfType, HISTORY_PUSH_TAG, REDO_COMMAND, UNDO_COMMAND } from '../../../../deepseek-harness/packages/client/ui-conversation/node_modules/lexical/dist/Lexical.mjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '../../../../deepseek-harness/node_modules/@testing-library/react/dist/index.js'
import { createElement } from 'react'
import type { UserTextReference } from '@deepseek-ai/dsh-client-ui-primitives'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { UserTextRegistry } from '../../../../deepseek-harness/packages/client/ui-conversation/src/client/conversation/user-text-registry.ts'
import { PlainUserText, UserText } from '../../../../deepseek-harness/packages/client/ui-conversation/src/client/user-text/UserText.tsx'
import { CapabilityReference, capabilityReferenceRule } from '../../../../deepseek-harness/packages/client/ui-chat/src/client/chat/CapabilityReference.tsx'
import { SessionInputShell } from '../../../../deepseek-harness/packages/client/ui-conversation/src/client/input/facade.ts'
import { ReferenceChipNode } from '../../../../deepseek-harness/packages/client/ui-conversation/src/client/input/editor/chip-node.tsx'
import type { InputTriggerController } from '../../../../deepseek-harness/packages/client/ui-conversation/src/client/contract/input.ts'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply as applySkillUi } from '../../../../deepseek-harness/packages/client/ui-skill/src/client/index.ts'
import { ToolboxModel } from '../src/client/model.ts'
import { choiceCommands } from '../src/ui/choice-commands.ts'
import { bindInlineCapabilities, capabilityClipboardText, capabilityReferenceSource, capabilityTextReferences, prepareSkillCreationDraft, prependTeamReference, removeInlineCapability } from '../src/ui/inline-capabilities.ts'
import { en, zh, type UiKey } from '../src/ui/locales.ts'
import { skillPresentation } from '../src/ui/skill-presentation.ts'
import { catalog, t } from './ui-fixture.ts'

const disposers: Array<() => void> = []
afterEach(() => { cleanup(); for (const dispose of disposers.splice(0)) dispose() })

function bench(skillLabel?: (name: string) => string) {
  const ctx = new Context()
  const model = new ToolboxModel({} as ConstructorParameters<typeof ToolboxModel>[0])
  const current = catalog()
  model.state.update(state => { state.choices.s1 = { draft: { expectedRevision: current.revision, team: null, skillIds: [], mcpIds: [] }, catalog: current, phase: 'draft', context: null, unavailable: false } })
  const sink = vi.fn(async (_text: string, _attachments: readonly unknown[], _placement: string, _signal: AbortSignal) => ({ kind: 'success' as const }))
  const triggers: InputTriggerController = {
    launcher: createSnapshotStore<string | null>(null),
    lexicon: createSnapshotStore<ReadonlyMap<'/' | '@', readonly string[]>>(new Map()),
    track: () => {}, arbitrate: () => 'pass', onSpace: () => false,
    serializeReference: async (_source, ref) => capabilityClipboardText(ref),
    adjudicate: async () => undefined, openReference: () => false, toggleSource: () => {},
  }
  const shell = new SessionInputShell({ actx: ctx, defaultSink: sink,
    inputTriggers: () => triggers,
    commandAttachments: { serialize: async () => [], release: () => {}, unsupportedNotice: token => token },
  })
  ctx.on('slash/input-insert-text', request => shell.insertText(request.text, request.span) ? true : undefined)
  ctx.on('slash/input-insert-reference', request => shell.insertReference(request.reference, request.span) ? true : undefined)
  const popup = createSnapshotStore({ open: false })
  const unbind = bindInlineCapabilities(model, 's1', shell, popup, skillLabel)
  disposers.push(() => { unbind(); shell.dispose(); model.dispose(); void ctx.fiber.dispose() })
  const choice = () => model.state.getSnapshot().choices.s1!
  const refs = () => shell.snapshot.occurrences.filter(reference => reference.source === capabilityReferenceSource)
  const removeNode = (label: string) => shell.editor.update(() => {
    $nodesOfType(ReferenceChipNode).find(node => node.getLabel() === label)!.remove()
  }, { discrete: true, tag: HISTORY_PUSH_TAG })
  let source: InputTriggerSource | undefined
  return { ctx, model, current, shell, popup, sink, choice, refs, removeNode, unbind,
    slashSource: () => source ??= slashSkillSource(ctx),
  }
}

/** Render sent user text the way Chat does: the capability rule over the Session's published references. */
function sentUserText(text: string, capabilityReferences: readonly UserTextReference[], actions: { openFile: (path: string) => void; openSkill: (name: string) => void }) {
  const registry = new UserTextRegistry(new Context())
  registry.register(capabilityReferenceRule)
  const renderSlot = (_name: string, owner: { node: { id: string } }) => owner.node.id === 'capability'
    ? createElement(CapabilityReference as never, { ...owner, ...actions })
    : createElement(PlainUserText as never, owner)
  return createElement('div', null, createElement(UserText as never, {
    text, facts: { capabilityReferences }, interactive: true, renderSlot,
    useUserTextRevision: bindSnapshotSelector({ getSnapshot: () => registry.getSnapshot(), subscribe: (listener: () => void) => registry.subscribe(listener) }),
    createUserTextEvaluator: () => registry.createEvaluator(),
    reportTransformFailure: (error: unknown): never => { throw error },
  }))
}

function slashSkillSource(ctx: Context): InputTriggerSource {
  let source!: InputTriggerSource
  ctx.provide('inputTriggers', { registerSource: (value: InputTriggerSource) => { source = value; return () => {} } })
  ctx.provide('sessions', {})
  ctx.provide('remote', { skills: {}, $on: () => () => {} })
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key })
  ctx.provide('slots', { inject: () => () => {} })
  ctx.provide('uiConversation', { userText: { register: () => () => {} } })
  applySkillUi(ctx)
  return source
}

function pickSlashSkill(b: ReturnType<typeof bench>, start: number, end: number) {
  const outcome = b.slashSource().onPick({
    candidate: { name: 'office-docx' }, session: { sessionId: 's1' as SessionId },
    position: start === 0 ? 'leading' : 'inline', via: 'menu', action: 'pick',
    span: { start, end, draftRev: b.shell.snapshot.draftRev },
  })
  if (!outcome || typeof outcome === 'string' || !('insert' in outcome)) throw new Error('Expected a skill reference')
  return b.shell.insertReference(outcome.insert, { start, end, draftRev: b.shell.snapshot.draftRev })
}

describe('inline capability selection', () => {
  it.each([zh, en])('shows the localized skill creator label while retaining its invocation until the user sends', async copy => {
    const translate = (key: UiKey, params?: Record<string, unknown>) => copy[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
    const b = bench(name => skillPresentation(name, translate).label)
    b.model.state.update(state => {
      state.choices.s1!.catalog!.skills.items.push({ ...b.current.skills.items[0]!, id: 'creator', name: 'skill-creator' })
    })
    prepareSkillCreationDraft(b.shell, translate('createPrompt', { skill: '{skill}' }), translate('skillSkillCreatorName'))
    expect(b.shell.snapshot.occurrences[0]).toMatchObject({
      source: 'skill', ref: '/skill-creator', label: translate('skillSkillCreatorName'), clipboardText: '/skill-creator',
    })
    await vi.waitFor(() => expect(b.refs()).toHaveLength(1))
    expect(b.refs()[0]).toMatchObject({ label: translate('skillSkillCreatorName'), clipboardText: '$skill-creator' })
    expect(b.choice().draft.skillIds).toEqual(['creator'])
    expect(b.sink).not.toHaveBeenCalled()
    b.shell.submit()
    await vi.waitFor(() => expect(b.sink).toHaveBeenCalledWith(
      translate('createPrompt', { skill: '$skill-creator' }), [], 'queue', expect.any(AbortSignal),
    ))
  })

  it.each(['add', 'slash'])('opens a sent %s-picked skill document after the draft selection changes', async (entry) => {
    const b = bench()
    if (entry === 'slash') {
      const draft = '报告正文 /'
      b.shell.setDraft(draft)
      pickSlashSkill(b, draft.length - 1, draft.length)
      await vi.waitFor(() => expect(b.refs()).toHaveLength(1))
      b.model.choose('s1', { mcpIds: ['juyuan'] })
    } else {
      b.shell.setDraft('报告正文')
      b.model.choose('s1', { skillIds: ['bundled:office-docx'], mcpIds: ['juyuan'] })
    }
    await vi.waitFor(() => expect(b.refs()).toHaveLength(2))
    b.shell.submit()
    await vi.waitFor(() => expect(b.sink).toHaveBeenCalledOnce())
    const text = b.sink.mock.calls[0]![0]
    b.model.choose('s1', { skillIds: [], mcpIds: [] })
    b.model.state.update(state => {
      const catalog = state.choices.s1!.catalog!
      catalog.mcp.items[0]!.enabled = false
      catalog.skills.items[0]!.enabled = false
      catalog.skills.items[0]!.path = '/personal/skills/office-docx/SKILL.md'
    })
    expect(capabilityTextReferences(undefined)).toBeUndefined()
    const openFile = vi.fn()
    const openSkill = vi.fn()
    const view = render(sentUserText(text, capabilityTextReferences(b.choice())!, { openFile, openSkill }))
    fireEvent.click(view.getByRole('button', { name: '/office-docx' }), { detail: 1 })
    expect(openFile).toHaveBeenCalledWith('/personal/skills/office-docx/SKILL.md')
    expect(openSkill).not.toHaveBeenCalled()
    const connector = view.container.querySelector('[data-ref-chip="mcp"]')!
    fireEvent.click(connector)
    expect(connector.tagName).toBe('SPAN')
    expect(openFile).toHaveBeenCalledOnce()
    expect({ text, shown: view.container.textContent, references: [...view.container.querySelectorAll('[data-ref-chip]')].map(node => ({
      kind: node.getAttribute('data-ref-chip'), label: node.textContent, clickable: node.tagName === 'BUTTON',
    })) }).toMatchSnapshot()
    expect(b.choice().draft.skillIds).toEqual([])
    expect(b.choice().draft.mcpIds).toEqual([])
  })
  it('gives Add and slash picks the same reference, selection, submission and removal behavior', async () => {
    const add = bench()
    add.shell.setDraft('报告正文')
    const skills = choiceCommands({
      loadChoice: async () => {}, choose: (sessionId, patch) => add.model.choose(sessionId, patch),
      choice: () => add.choice(), available: () => true, t,
    }).find(command => command.name === 'task-skills')!.ui
    if (skills.kind !== 'popupSelect') throw new Error('Expected skill popup')
    const session = { sessionId: 's1' as SessionId }
    const option = (await skills.options(session, new AbortController().signal)).find(row => row.label === 'Documents')!
    await skills.onSelect(option, session)
    await vi.waitFor(() => expect(add.refs()).toHaveLength(1))

    const slash = bench()
    slash.shell.setDraft('报告正文 /off')
    await Promise.resolve()
    expect(pickSlashSkill(slash, 5, 9)).toBe(true)
    await vi.waitFor(() => expect(slash.refs()).toHaveLength(1))
    const project = (b: ReturnType<typeof bench>) => ({
      text: b.shell.snapshot.draft,
      references: b.refs().map(({ source, ref, label, appearance, clipboardText }) => ({ source, ref, label, appearance, clipboardText })),
      skillIds: b.choice().draft.skillIds,
    })
    expect(project(slash)).toEqual(project(add))
    expect(project(slash)).toMatchSnapshot()
    for (const b of [add, slash]) {
      b.shell.submit()
      await vi.waitFor(() => expect(b.sink).toHaveBeenCalledWith('报告正文 $office-docx', [], 'queue', expect.any(AbortSignal)))
      await vi.waitFor(() => expect(b.shell.snapshot.phase).toBe('plain'))
      expect(b.refs()).toHaveLength(1)
      b.removeNode('office-docx')
      await vi.waitFor(() => expect(b.choice().draft.skillIds).toEqual([]))
      b.shell.editor.dispatchCommand(UNDO_COMMAND, undefined)
      await vi.waitFor(() => expect(b.choice().draft.skillIds, b === add ? 'Add undo' : 'slash undo').toEqual(['bundled:office-docx']))
      expect(b.shell.snapshot.draft).not.toContain('报告正文')
      expect(removeInlineCapability(b.model, 's1', b.refs()[0]!.ref)).toBe(true)
      await vi.waitFor(() => expect(b.refs()).toHaveLength(0))
    }
  })

  it('undoes a slash selection in one step and restores the shared selection on redo', async () => {
    const b = bench()
    b.shell.setDraft('正文 /off')
    await Promise.resolve()
    expect(pickSlashSkill(b, 3, 7)).toBe(true)
    await vi.waitFor(() => expect(b.choice().draft.skillIds).toEqual(['bundled:office-docx']))
    b.shell.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await vi.waitFor(() => expect(b.refs()).toHaveLength(0))
    expect(b.choice().draft.skillIds).toEqual([])
    expect(b.shell.snapshot.draft).toBe('正文 /off')
    b.shell.editor.dispatchCommand(REDO_COMMAND, undefined)
    await vi.waitFor(() => expect(b.choice().draft.skillIds).toEqual(['bundled:office-docx']))
    expect(b.refs()).toHaveLength(1)
  })

  it('adopts slash picks after existing references, deduplicates selected skills and waits for the catalog', async () => {
    const b = bench()
    b.shell.setDraft('正文')
    b.model.choose('s1', { mcpIds: ['juyuan'] })
    await vi.waitFor(() => expect(b.refs()).toHaveLength(1))
    b.shell.insertText('/off', { start: 5, end: 5, draftRev: b.shell.snapshot.draftRev })
    b.model.state.update(state => { state.choices.s1!.catalog = null })
    expect(pickSlashSkill(b, 5, 9)).toBe(true)
    await Promise.resolve()
    expect(b.shell.snapshot.occurrences.some(ref => ref.source === 'skill')).toBe(true)
    b.model.state.update(state => { state.choices.s1!.catalog = b.current })
    await vi.waitFor(() => expect(b.choice().draft.skillIds).toEqual(['bundled:office-docx']))
    expect(b.refs().map(ref => ref.label)).toEqual(['聚源', 'office-docx'])
    expect(b.shell.snapshot.draft).toContain('正文')
    const end = b.shell.caretSpan().end
    b.shell.insertText('/off', { start: end, end, draftRev: b.shell.snapshot.draftRev })
    expect(pickSlashSkill(b, end, end + 4)).toBe(true)
    await vi.waitFor(() => expect(b.shell.snapshot.occurrences).toHaveLength(2))
    expect(b.choice().draft.skillIds).toEqual(['bundled:office-docx'])
    expect(b.choice().draft.mcpIds).toEqual(['juyuan'])
  })

  it('retains a slash-picked skill when another capability changes before reconciliation', async () => {
    const b = bench()
    b.shell.setDraft('/off')
    await Promise.resolve()
    expect(pickSlashSkill(b, 0, 4)).toBe(true)
    b.model.choose('s1', { mcpIds: ['juyuan'] })
    await vi.waitFor(() => expect(b.choice().draft).toMatchObject({ skillIds: ['bundled:office-docx'], mcpIds: ['juyuan'] }))
    expect(b.refs().map(ref => ref.label)).toEqual(['office-docx', '聚源'])
  })

  it('prepares the team on the first line above the prompt while preserving existing references and editable content', async () => {
    const b = bench()
    b.shell.setDraft('请深度研究【公司名称或股票代码】。')
    b.model.choose('s1', { skillIds: ['bundled:office-docx'] })
    await vi.waitFor(() => expect(b.refs()).toHaveLength(1))
    const before = b.shell.snapshot.draft
    const team = b.current.teams.items[0]!
    prependTeamReference(b.ctx, b.shell, team)
    expect(b.refs().some(item => item.appearance === 'skill')).toBe(true)
    expect(b.shell.snapshot.draft).toContain(before)
    b.model.prepareTeam('s1', team)
    await vi.waitFor(() => expect(b.refs().find(item => item.appearance === 'team')?.offset).toBe(0))
    expect(b.shell.snapshot.draft).toMatch(/^@资产投研团队 \n\n请深度研究【公司名称或股票代码】。/)
    const prepared = b.shell.snapshot.draft
    prependTeamReference(b.ctx, b.shell, team)
    b.model.prepareTeam('s1', team)
    await vi.waitFor(() => expect(b.refs()).toHaveLength(1))
    expect(b.shell.snapshot.draft).toBe(prepared)
    expect(b.sink).not.toHaveBeenCalled()
    expect(removeInlineCapability(b.model, 's1', b.refs()[0]!.ref)).toBe(true)
    await vi.waitFor(() => expect(b.choice().draft.team).toBeNull())
    expect(b.shell.snapshot.draft).toContain('请深度研究【公司名称或股票代码】。')
  })

  it('inserts references without replacing prose, waits for popup token consumption, and synchronizes deletion and undo', async () => {
    const b = bench()
    b.shell.setDraft('保留正文')
    b.popup.set({ open: true })
    b.model.choose('s1', { skillIds: ['bundled:office-docx'], mcpIds: ['juyuan'] })
    await Promise.resolve()
    expect(b.refs()).toHaveLength(0)
    b.popup.set({ open: false })
    await vi.waitFor(() => expect(b.refs().map(reference => reference.label)).toEqual(['office-docx', '聚源']))
    expect(b.shell.snapshot.draft).toContain('保留正文')
    expect(b.refs()[0]!.appearance).toBe('skill')
    b.removeNode('office-docx')
    await vi.waitFor(() => expect(b.choice().draft.skillIds).toEqual([]))
    b.shell.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await vi.waitFor(() => expect(b.choice().draft.skillIds).toEqual(['bundled:office-docx']))
    expect(b.shell.snapshot.draft).toContain('保留正文')
  })

  it('preserves selected capabilities after sending and removes their actual selection on click', async () => {
    const b = bench()
    b.shell.setDraft('报告正文')
    b.model.choose('s1', { skillIds: ['bundled:office-docx'], mcpIds: ['juyuan'] })
    await vi.waitFor(() => expect(b.refs()).toHaveLength(2))
    b.shell.submit()
    await vi.waitFor(() => expect(b.sink).toHaveBeenCalledWith('报告正文 $office-docx @聚源', [], 'queue', expect.any(AbortSignal)))
    expect(b.refs()).toHaveLength(2)
    expect(b.shell.snapshot.draft).not.toContain('报告正文')
    expect(b.choice().draft.mcpIds).toEqual(['juyuan'])
    expect(removeInlineCapability(b.model, 's1', b.refs().find(reference => reference.appearance === 'mcp')!.ref)).toBe(true)
    await vi.waitFor(() => expect(b.refs()).toHaveLength(1))
    expect(b.choice().draft.mcpIds).toEqual([])
  })

  it('restores required team references after keyboard deletion and keeps submitted teams fixed', async () => {
    const b = bench()
    b.model.state.update(state => { state.choices.s1!.catalog!.teams.items[0]!.requiredSkillIds = ['bundled:office-docx'] })
    b.model.prepareTeam('s1', b.choice().catalog!.teams.items[0]!)
    await vi.waitFor(() => expect(b.refs()).toHaveLength(2))
    const skill = b.refs().find(reference => reference.appearance === 'skill')!
    expect(removeInlineCapability(b.model, 's1', skill.ref)).toBe(false)
    b.removeNode('office-docx')
    await vi.waitFor(() => expect(b.refs().some(reference => reference.label === 'office-docx')).toBe(true))
    b.model.state.update(state => { state.choices.s1!.phase = 'fixed' })
    b.removeNode('资产投研团队')
    await vi.waitFor(() => expect(b.refs()).toHaveLength(2))
    expect(b.choice().draft.team?.id).toBe('asset-research-team')
  })

  it('restores an unsent selection from persisted native references when its binding is recreated', async () => {
    const b = bench()
    b.model.choose('s1', { skillIds: ['bundled:office-docx'], mcpIds: ['juyuan'] })
    await vi.waitFor(() => expect(b.refs()).toHaveLength(2))
    const persisted = b.shell.draftSnapshot
    b.unbind()
    b.model.choose('s1', { skillIds: [], mcpIds: [] })
    b.shell.setDraft(persisted)
    const unbind = bindInlineCapabilities(b.model, 's1', b.shell, b.popup)
    disposers.push(unbind)
    await vi.waitFor(() => expect(b.choice().draft).toMatchObject({ skillIds: ['bundled:office-docx'], mcpIds: ['juyuan'] }))
    expect(b.refs()).toHaveLength(2)
  })
})
