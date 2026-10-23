// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '../../../../deepseek-harness/node_modules/@testing-library/react/dist/index.js'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PopupSelectSpec } from '@deepseek-ai/dsh-client-ui-commands/client'
import { ChoiceDock } from '../src/ui/Choices.tsx'
import { choiceCommands } from '../src/ui/choice-commands.ts'
import type { ChoiceDockProps } from '../src/ui/types.ts'
import type { Choice, ToolboxState } from '../src/client/model.ts'
import { actions, catalog, t } from './ui-fixture.ts'

afterEach(cleanup)
const session = { sessionId: 's1' as SessionId }

function bench() {
  const api = actions()
  const current = catalog()
  const choice: Choice = { draft: { expectedRevision: current.revision, team: null, skillIds: [], mcpIds: [] }, catalog: current, phase: 'draft', context: null, unavailable: false }
  let available = true
  api.choose = vi.fn((_sessionId, patch) => { choice.draft = { ...choice.draft, ...patch, expectedRevision: current.revision } })
  const commands = choiceCommands({ ...api, t, choice: () => choice, available: () => available })
  const popup = (name: string): PopupSelectSpec => {
    const ui = commands.find(command => command.name === name)!.ui
    if (ui.kind !== 'popupSelect') throw new Error('Expected native popup')
    return ui
  }
  const rows = (name: string) => popup(name).options(session, new AbortController().signal)
  const pick = async (name: string, label: string) => {
    const option = (await rows(name)).find(row => row.label === label)!
    expect(option).toBeDefined()
    await popup(name).onSelect(option, session)
  }
  return { api, choice, current, commands, rows, pick, popup, setAvailable(value: boolean) { available = value } }
}

describe('native composer Add contributions', () => {
  it('uses three native Add entries with localized search and leaves native files and commands to DSH', async () => {
    const b = bench()
    expect(b.commands.map(command => [command.name, command.section, command.label?.()])).toEqual([
      ['expert-team', 'add', 'Expert teams'], ['task-skills', 'add', 'Skills'], ['connectors', 'add', 'Connectors'],
    ])
    expect(b.popup('task-skills').searchLabels?.()).toEqual({ placeholder: 'Search skills', empty: 'No entries yet', noResults: 'No matching entries' })
    await b.rows('task-skills')
    expect(b.api.loadChoice).toHaveBeenCalledWith('s1')
    b.setAvailable(false)
    expect(b.commands.every(command => !command.available(session))).toBe(true)
  })

  it('toggles skills and connectors while leaving financial connectors optional', async () => {
    const b = bench()
    await b.pick('task-skills', 'Documents')
    expect(b.choice.draft.skillIds).toEqual(['bundled:office-docx'])
    expect((await b.rows('task-skills')).find(row => row.label === 'Documents')).toMatchObject({ iconSrc: expect.any(String), keywords: expect.arrayContaining(['office-docx', 'Word']) })
    expect((await b.rows('task-skills')).find(row => row.label === 'Documents')?.active).toBe(true)
    await b.pick('task-skills', 'Documents')
    expect(b.choice.draft.skillIds).toEqual([])
    expect(b.choice.draft.mcpIds).toEqual([])
    await b.pick('connectors', '聚源')
    expect(b.choice.draft.mcpIds).toEqual(['juyuan'])
    await b.pick('connectors', '聚源')
    expect(b.choice.draft.mcpIds).toEqual([])
  })

  it('includes team dependencies, protects required skills and permits cancelling the team', async () => {
    const b = bench()
    b.current.teams.items[0]!.requiredSkillIds = ['bundled:office-docx']
    await b.pick('expert-team', '资产投研团队')
    expect(b.choice.draft.team?.id).toBe('asset-research-team')
    expect(b.choice.draft.skillIds).toEqual(['bundled:office-docx'])
    expect(b.choice.draft.mcpIds).toEqual([])
    const required = (await b.rows('task-skills')).find(row => row.label === 'Documents')!
    expect(required).toMatchObject({ active: true, disabled: true, detail: 'Required by the selected team' })
    await expect(b.popup('task-skills').onSelect(required, session)).rejects.toThrow('Required by the selected team')
    await b.pick('expert-team', '资产投研团队')
    expect(b.choice.draft.team).toBeNull()
  })

  it('shows unavailable entries disabled and refuses fixed, incomplete or disconnected changes', async () => {
    const b = bench()
    b.current.mcp.items[0]!.enabled = false
    expect((await b.rows('connectors')).find(row => row.label === '聚源')?.disabled).toBe(true)
    b.current.skills.complete = false
    const skill = (await b.rows('task-skills')).find(row => row.label === 'Documents')!
    expect(skill.disabled).toBe(true)
    await expect(b.popup('task-skills').onSelect(skill, session)).rejects.toThrow('incomplete')
    b.current.skills.complete = true
    const openSkill = (await b.rows('task-skills')).find(row => row.label === 'Documents')!
    b.choice.phase = 'fixed'
    expect((await b.rows('task-skills')).every(row => row.disabled)).toBe(true)
    await expect(b.popup('task-skills').onSelect(openSkill, session)).rejects.toThrow(t('fixed'))
    b.choice.phase = 'draft'; b.choice.unavailable = true
    await expect(b.rows('task-skills')).rejects.toThrow('not connected')
    await expect(b.popup('task-skills').onSelect(openSkill, session)).rejects.toThrow('not connected')
    expect(b.api.choose).not.toHaveBeenCalled()
  })

  it('rejects choices from a changed catalog and confirms its revision only through a reviewed selection or reload', async () => {
    const b = bench()
    const stale = (await b.rows('task-skills')).find(row => row.label === 'Documents')!
    b.current.revision++
    await expect(b.popup('task-skills').onSelect(stale, session)).rejects.toThrow('catalog changed')
    const reload = (await b.rows('task-skills')).find(row => row.id === 'refresh')!
    expect(reload.detail).toBe('The catalog changed. Review the capability choices again.')
    await b.popup('task-skills').onSelect(reload, session)
    expect(b.api.loadChoice).toHaveBeenLastCalledWith('s1', true)
    expect(b.api.choose).not.toHaveBeenCalled()
  })

  it('allows removing a missing selected entry and refuses a stale toggle after another selection', async () => {
    const b = bench()
    b.choice.draft.skillIds = ['removed-skill']
    await b.pick('task-skills', 'removed-skill')
    expect(b.choice.draft.skillIds).toEqual([])
    const oldToggle = (await b.rows('task-skills')).find(row => row.label === 'Documents')!
    await b.popup('task-skills').onSelect(oldToggle, session)
    await expect(b.popup('task-skills').onSelect(oldToggle, session)).rejects.toThrow('catalog changed')
  })
})

describe('composer capability chips', () => {
  function mount(b = bench()) {
    const focusEditor = vi.fn()
    const state = { choices: { s1: b.choice } } as ToolboxState
    const props = { ...b.api, t, locked: false, focusEditor,
      useSession: selector => selector({ sessionId: 's1', blank: b.choice.phase === 'draft' }),
      useToolbox: selector => selector(state),
    } as ChoiceDockProps
    const view = render(React.createElement(ChoiceDock, props))
    return { ...b, focusEditor, props, view }
  }

  it('leaves selected capabilities to the editor and displays catalog loading separately', async () => {
    const b = mount()
    expect(screen.queryByRole('group', { name: 'Selected capabilities' })).toBeNull()
    await b.pick('task-skills', 'Documents')
    b.view.rerender(React.createElement(ChoiceDock, b.props))
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('group')).toBeNull()
    b.choice.catalog = null
    b.view.rerender(React.createElement(ChoiceDock, b.props))
    expect(screen.getByRole('status').textContent).toBe('Loading…')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces submitting and invalid selection notices without duplicating the inline references', () => {
    const b = mount()
    b.choice.draft.skillIds = ['bundled:office-docx']
    b.choice.phase = 'submitting'
    b.view.rerender(React.createElement(ChoiceDock, b.props))
    expect(screen.getByRole('status').textContent).toBe(t('submitting'))
    b.choice.phase = 'draft'; b.choice.unavailable = true
    b.view.rerender(React.createElement(ChoiceDock, b.props))
    expect(screen.getByRole('alert').textContent).toBe(t('invalidSelection'))
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('asks to review changed capabilities instead of reporting missing skills for a revision conflict', () => {
    const b = mount()
    b.choice.draft.skillIds = ['bundled:office-docx']
    b.choice.draft.expectedRevision--
    b.view.rerender(React.createElement(ChoiceDock, b.props))
    expect(screen.getByRole('alert').textContent).toBe(t('stale'))
    b.choice.catalog!.skills.items[0]!.enabled = false
    b.view.rerender(React.createElement(ChoiceDock, b.props))
    expect(screen.getByRole('alert').textContent).toBe(t('invalidSelection'))
  })

  it('keeps ordinary chat free of capability notices after an empty historical submission', () => {
    const b = mount()
    b.choice.context = { schemaVersion: 1, taskId: 'message:previous', sessionId: 's1', submittedAt: 1, catalogRevision: 1, team: null, skills: [], mcp: [] }
    b.choice.draft.expectedRevision = 1
    b.view.rerender(React.createElement(ChoiceDock, b.props))
    expect(screen.queryByRole('alert')).toBeNull()
    b.choice.unavailable = true
    b.choice.catalog = null
    b.view.rerender(React.createElement(ChoiceDock, b.props))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
