// @vitest-environment jsdom
import * as React from 'react'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '../../../../deepseek-harness/node_modules/@testing-library/react/dist/index.js'
import { SessionInputShell } from '../../../../deepseek-harness/packages/client/ui-conversation/src/client/input/facade.ts'
import type { InputTriggerController, InputZone } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ToolboxModel } from '../src/client/model.ts'
import { bindInlineCapabilities, capabilityClipboardText } from '../src/ui/inline-capabilities.ts'
import { prepareSuggestion } from '../src/ui/suggestions/prepare.ts'
import { suggestions, suggestionSkillLabel } from '../src/ui/suggestions/catalog.ts'
import { Suggestions, SuggestionsSetting } from '../src/ui/suggestions/Suggestions.tsx'
import { createSuggestionPreferences } from '../src/ui/suggestions/preferences.ts'
import { registerSuggestions, SuggestionsDock } from '../src/ui/suggestions/register.tsx'
import { catalog, t } from './ui-fixture.ts'

const dispose: Array<() => void> = []
afterEach(() => { cleanup(); dispose.splice(0).forEach(fn => fn()); localStorage.clear() })

it('extends native list slots without redeclaring or replacing the composer and disposes cleanly', () => {
  const core = new SlotCore()
  core.register({ name: 'root', children: {
    'conversation.input.dock': { kind: 'list', scope: 'session' },
    'settings.general.item': { kind: 'list', scope: 'root' },
    'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
  } }, (() => null) as never)
  const NativeComposer = () => null
  core.register({ name: 'conversation.composer.bar', children: {
    'conversation.input.attachments': { kind: 'single', scope: 'session' },
  } } as never, NativeComposer as never)
  const cleanups: Array<() => void> = []
  const ctx = { effect: (fn: () => () => void) => cleanups.push(fn()), slots: {
    register: core.register.bind(core), inject: (_name: string, fn: () => () => void) => cleanups.push(fn()),
  } } as unknown as Context
  expect(() => registerSuggestions(ctx, { t, prepare: async () => 'ready' })).not.toThrow()
  expect(core.entriesOfSlot('conversation.composer.bar').map(entry => entry.component)).toEqual([NativeComposer])
  expect(core.entriesOfSlot('conversation.input.dock')).toHaveLength(1)
  cleanups.reverse().forEach(fn => fn())
  expect(core.entriesOfSlot('conversation.input.dock')).toHaveLength(0)
  expect(core.entriesOfSlot('settings.general.item')).toHaveLength(0)
})

it('renders below the owning native editor and disappears when that pane becomes active', async () => {
  const preferences = createSuggestionPreferences(); dispose.push(preferences.dispose)
  const session = { sessionId: 's1', blank: true, openState: 'open', running: false, awaitingFirstTurn: false, pendingSubmissions: [] } as unknown as InputZone['session']
  function Pane({ id, phase }: { id: string; phase: string }) {
    return React.createElement('div', { 'data-conversation-content': '', 'data-content-phase': phase, 'data-testid': id },
      React.createElement('div', { 'data-composer-seat': '' }, React.createElement('div', { 'data-stack': '' },
        React.createElement('div', { 'data-slot': 'conversation.input.dock', style: { display: 'contents' } },
          React.createElement(SuggestionsDock, { session: { ...session, sessionId: id } as InputZone['session'], input: { phase: 'plain' } as InputZone['input'], preferences, t, prepare: async () => 'ready' })),
        React.createElement('div', { 'data-native-editor': '', 'data-slot': 'conversation.composer.bar', style: { display: 'contents' } },
          React.createElement('div', {}, React.createElement('div', { 'data-composer-dock': '' }))))))
  }
  const view = (phase: string) => React.createElement(React.Fragment, null, React.createElement(Pane, { id: 'first', phase }), React.createElement(Pane, { id: 'second', phase: 'active' }))
  const result = render(view('hero'))
  const section = await within(screen.getByTestId('first')).findByTestId('task-suggestions')
  expect(section.previousElementSibling?.hasAttribute('data-native-editor')).toBe(true)
  expect(within(screen.getByTestId('second')).queryByTestId('task-suggestions')).toBeNull()
  result.rerender(view('active'))
  await waitFor(() => expect(screen.queryByTestId('task-suggestions')).toBeNull())
  result.rerender(view('hero'))
  await screen.findByTestId('task-suggestions')
  result.unmount()
  expect(screen.queryByTestId('task-suggestions')).toBeNull()
})
function fixture() {
  const ctx = new Context()
  const model = new ToolboxModel({} as ConstructorParameters<typeof ToolboxModel>[0])
  const current = catalog()
  current.skills.items.push({ ...current.skills.items[0]!, id: 'pptx', name: 'office-pptx' })
  model.state.update(state => { state.choices.s1 = { draft: { expectedRevision: current.revision, team: null, skillIds: [], mcpIds: [] }, catalog: current, phase: 'draft', context: null, unavailable: false } })
  const sink = vi.fn(async () => ({ kind: 'success' as const }))
  const triggers: InputTriggerController = { launcher: createSnapshotStore<string | null>(null), lexicon: createSnapshotStore<ReadonlyMap<'/' | '@', readonly string[]>>(new Map()),
    track: () => {}, arbitrate: () => 'pass', onSpace: () => false, serializeReference: async (_source, ref) => capabilityClipboardText(ref),
    adjudicate: async () => undefined, openReference: () => false, toggleSource: () => {} }
  const input = new SessionInputShell({ actx: ctx, defaultSink: sink, inputTriggers: () => triggers,
    commandAttachments: { serialize: async () => [], release: () => {}, unsupportedNotice: token => token } })
  const unbind = bindInlineCapabilities(model, 's1', input, createSnapshotStore({ open: false }), name => suggestionSkillLabel(name, t))
  dispose.push(() => { unbind(); input.dispose(); model.dispose(); void ctx.fiber.dispose() })
  return { input, model, sink, sessionId: 's1', t, loadChoice: async () => {}, signal: new AbortController().signal, item: suggestions[2]! }
}

it('replaces prose with one native presentation reference, keeps its canonical skill and never sends', async () => {
  const f = fixture()
  f.input.setDraft('Old editable draft')
  expect(await prepareSuggestion(f)).toBe('ready')
  await waitFor(() => expect(f.input.snapshot.occurrences).toHaveLength(1))
  expect(f.input.snapshot.draft).not.toContain('Old editable draft')
  expect(f.input.snapshot.occurrences[0]).toMatchObject({ label: 'Presentations', clipboardText: '$office-pptx', appearance: 'skill' })
  expect(f.model.state.getSnapshot().choices.s1?.draft.skillIds).toEqual(['pptx'])
  await prepareSuggestion(f)
  await waitFor(() => expect(f.input.snapshot.occurrences).toHaveLength(1))
  expect(f.sink).not.toHaveBeenCalled()
  await prepareSuggestion({ ...f, item: suggestions[0]! })
  await waitFor(() => expect(f.input.snapshot.occurrences).toHaveLength(0))
  expect(f.model.state.getSnapshot().choices.s1?.draft.skillIds).toEqual([])
  expect(f.sink).not.toHaveBeenCalled()
})
it.each(['edited', 'cancelled'])('does not overwrite a %s draft when skill lookup finishes late', async reason => {
  const f = fixture(), abort = new AbortController()
  let finish!: () => void
  const pending = prepareSuggestion({ ...f, signal: abort.signal, loadChoice: () => new Promise<void>(done => { finish = done }) })
  if (reason === 'edited') f.input.setDraft('User is still writing')
  else abort.abort()
  finish()
  expect(await pending).toBe('cancelled')
  expect(f.input.snapshot.occurrences).toHaveLength(0)
  expect(f.model.state.getSnapshot().choices.s1?.draft.skillIds).toEqual([])
  if (reason === 'edited') expect(f.input.snapshot.draft).toBe('User is still writing')
})
it('keeps a disabled skill disabled and fills a plain prompt with an unavailable result', async () => {
  const f = fixture()
  f.model.state.update(state => { state.choices.s1!.catalog!.skills.items.find(skill => skill.id === 'pptx')!.enabled = false })
  expect(await prepareSuggestion(f)).toBe('unavailable')
  expect(f.input.snapshot.draft).toContain('Presentations')
  expect(f.input.snapshot.occurrences).toHaveLength(0)
  expect(f.model.state.getSnapshot().choices.s1?.draft.skillIds).toEqual([])
})
it('shows three tasks, rotates only its own pane, cancels pending picks and persists closing with a settings switch', async () => {
  const preferences = createSuggestionPreferences()
  dispose.push(preferences.dispose)
  const prepare = vi.fn(async (_session: string, _item: unknown, _signal: AbortSignal) => 'ready' as const)
  render(React.createElement(React.Fragment, null,
    React.createElement('div', { 'data-testid': 'first' }, React.createElement(Suggestions, { sessionId: 's1', disabled: false, t, preferences, prepare })),
    React.createElement('div', { 'data-testid': 'second' }, React.createElement(Suggestions, { sessionId: 's2', disabled: false, t, preferences, prepare })),
    React.createElement(SuggestionsSetting, { preferences, t })))
  const first = within(screen.getByTestId('first')), second = within(screen.getByTestId('second'))
  expect(first.getAllByRole('listitem')).toHaveLength(3)
  fireEvent.click(first.getByText('Create a presentation ready to share'))
  await waitFor(() => expect(prepare).toHaveBeenCalledOnce())
  expect(prepare.mock.calls[0]?.[1]).toMatchObject({ skill: 'office-pptx' })
  fireEvent.click(first.getByRole('button', { name: 'Show more' }))
  expect(first.queryByText('Create a presentation ready to share')).toBeNull()
  expect(first.getByText('Create an editable project proposal')).toBeTruthy()
  expect(second.getByText('Create a presentation ready to share')).toBeTruthy()
  fireEvent.click(first.getByRole('button', { name: 'Turn off task suggestions?' }))
  const dialog = await screen.findByRole('dialog', { name: 'Turn off task suggestions?' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
  expect(screen.queryByTestId('task-suggestions')).toBeNull()
  const restored = createSuggestionPreferences(); dispose.push(restored.dispose)
  expect(restored.state.getSnapshot().enabled).toBe(false)
  fireEvent.click(screen.getByRole('switch', { name: 'Proactive task suggestions' }))
  expect(screen.getAllByTestId('task-suggestions')).toHaveLength(2)
})
