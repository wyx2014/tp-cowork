import { describe, expect, it } from 'vitest'
import type { Choice } from '../src/client/model.ts'
import { presentSkillCandidates } from '../src/ui/skill-menu.ts'
import { catalog, t } from './ui-fixture.ts'

function choiceWith(extra: Partial<Choice['catalog'] extends infer C ? NonNullable<C>['skills']['items'][number] : never>[], skillIds: string[] = []): Choice {
  const current = catalog()
  const base = current.skills.items[0]!
  current.skills.items = [base, ...extra.map(item => ({ ...base, ...item }))]
  return { draft: { expectedRevision: current.revision, team: null, skillIds, mcpIds: [] }, catalog: current, phase: 'draft', context: null, unavailable: false }
}

describe('native slash skill presentation', () => {
  it('matches the Add menu: document skills first, product labels, icons and searchable aliases', () => {
    const choice = choiceWith([{ id: 'bundled:translate', name: 'translate' }, { id: 'bundled:office-pdf', name: 'office-pdf' }])
    const rows = presentSkillCandidates(choice, [
      { name: 'translate', description: 'host text' }, { name: 'office-docx', description: 'host text' },
      { name: 'unknown', description: 'Host only' }, { name: 'office-pdf', description: 'host text' },
    ], t)
    expect(rows.map(row => row.name)).toEqual(['office-pdf', 'office-docx', 'translate', 'unknown'])
    expect(rows[1]).toMatchObject({ label: 'Documents', iconSrc: expect.any(String), keywords: expect.arrayContaining(['office-docx', 'Word']) })
    expect(rows[1]!.description).not.toBe('host text')
    // A skill the toolbox does not present keeps its canonical name and host description.
    expect(rows[3]).toEqual({ name: 'unknown', label: 'unknown', keywords: ['unknown'], description: 'Host only' })
  })

  it('greys out unavailable skills with the Add menu reason, checks selected ones, and hides non-invocable ones', () => {
    const choice = choiceWith([
      { id: 'user:off', name: 'off', enabled: false },
      { id: 'user:missing', name: 'missing', installed: false },
      { id: 'user:model-only', name: 'model-only', invocation: { modelInvocable: true, userInvocable: false } },
    ], ['bundled:office-docx'])
    const rows = presentSkillCandidates(choice, ['office-docx', 'off', 'missing', 'model-only'].map(name => ({ name })), t)
    expect(rows.map(row => [row.name, row.description, row.disabled, row.active])).toEqual([
      ['office-docx', expect.any(String), undefined, true],
      ['off', t('disabled'), true, undefined],
      ['missing', t('notInstalled'), true, undefined],
    ])
  })

  it('still presents labels and order before the toolbox catalog loads', () => {
    const rows = presentSkillCandidates(undefined, [{ name: 'translate' }, { name: 'office-xlsx' }], t)
    expect(rows.map(row => [row.name, row.disabled])).toEqual([['office-xlsx', undefined], ['translate', undefined]])
    expect(rows[0]!.iconSrc).toEqual(expect.any(String))
  })
})
