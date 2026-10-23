// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { createImportPromptPreferences, deferImportPrompt, importPromptPending, IMPORT_PROMPT_DEFER_MS } from '../src/import-preferences.js'

afterEach(() => localStorage.clear())
const now = Date.UTC(2026, 9, 23)

it.each(['dismissed', 'imported'])('persists %s independently of a conversation and without an expiry', choice => {
  createImportPromptPreferences(now).decide({ choice })
  const restarted = createImportPromptPreferences(now + 365 * 86400000)
  expect(restarted.state.getSnapshot()).toEqual({ choice })
  expect(importPromptPending(restarted.state.getSnapshot(), now + 365 * 86400000)).toBe(false)
})

it('persists a five-day deferral without extending or shortening it on restart', () => {
  const preferences = createImportPromptPreferences(now)
  expect(importPromptPending(preferences.state.getSnapshot(), now)).toBe(true)
  preferences.decide(deferImportPrompt(now))
  const restarted = createImportPromptPreferences(now + 86400000)
  expect(importPromptPending(restarted.state.getSnapshot(), now + IMPORT_PROMPT_DEFER_MS - 1)).toBe(false)
  expect(importPromptPending(restarted.state.getSnapshot(), now + IMPORT_PROMPT_DEFER_MS)).toBe(true)
  expect(importPromptPending(createImportPromptPreferences(now + IMPORT_PROMPT_DEFER_MS).state.getSnapshot(), now + IMPORT_PROMPT_DEFER_MS)).toBe(true)
})

it('inherits a permanent decline from any old session before the first browser pane opens', () => {
  localStorage.setItem('tpcowork.browser-tabs.v1.corrupt', '{')
  localStorage.setItem('tpcowork.browser-tabs.v1.one', JSON.stringify({ byTab: {}, importPrompt: { deferredRun: 'old-run' } }))
  localStorage.setItem('tpcowork.browser-tabs.v1.two', JSON.stringify({ byTab: {}, importPrompt: { choice: 'imported' } }))
  localStorage.setItem('tpcowork.browser-tabs.v1.three', JSON.stringify({ byTab: {}, importPrompt: { choice: 'dismissed' } }))
  expect(createImportPromptPreferences(now).state.getSnapshot()).toEqual({ choice: 'dismissed' })
})

it('inherits an earlier successful import', () => {
  localStorage.setItem('tpcowork.browser-tabs.v1', JSON.stringify({ importPrompt: { choice: 'imported' } }))
  expect(createImportPromptPreferences(now).state.getSnapshot()).toEqual({ choice: 'imported' })
})

it('gives an old Not now choice five days once, without renewing the delay every restart', () => {
  localStorage.setItem('tpcowork.browser-tabs.v1.one', JSON.stringify({ importPrompt: { deferredRun: 'old-run' } }))
  const migrated = createImportPromptPreferences(now).state.getSnapshot()
  expect(migrated).toEqual({ deferredUntil: now + IMPORT_PROMPT_DEFER_MS })
  const restarted = createImportPromptPreferences(now + IMPORT_PROMPT_DEFER_MS).state.getSnapshot()
  expect(restarted).toEqual(migrated)
  expect(importPromptPending(restarted, now + IMPORT_PROMPT_DEFER_MS)).toBe(true)
})
