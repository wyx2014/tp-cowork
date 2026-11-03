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

it('does not inherit choices made on the earlier Chrome sign-in offer', () => {
  localStorage.setItem('tpcowork.browser-import-prompt.v1', JSON.stringify({ choice: 'dismissed' }))
  localStorage.setItem('tpcowork.browser-tabs.v1', JSON.stringify({ importPrompt: { choice: 'dismissed' } }))
  expect(importPromptPending(createImportPromptPreferences(now).state.getSnapshot(), now)).toBe(true)
})
