import { afterEach, expect, it, vi } from 'vitest'
import {
  ASK_AUTO_CONTINUE_NOTE, createGeneralPreferences, generalLayout, markLaterReasoning, systemLocale, watchQuestionAutoContinue,
} from '../src/general-settings.js'

afterEach(() => { vi.useRealTimers() })

it('orders rows card by card with one break between cards', () => {
  const { rows, breaks } = generalLayout([['a'], ['b', 'c'], ['d']])
  expect(rows).toEqual({ a: 0, b: 2, c: 3, d: 5 })
  expect(breaks).toEqual([1, 4])
})

it('keeps the switches in storage with the reference defaults', () => {
  const storage = new Map<string, string>([['tpcowork-notification-enabled', 'false']])
  const preferences = createGeneralPreferences({ getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value) } })
  expect(preferences.get()).toEqual({ notifications: false, notificationSound: true, askAutoContinue: true, showReasoning: true, showTodos: false, followSystemLanguage: false })
  const listener = vi.fn()
  preferences.subscribe(listener)
  preferences.set('showTodos', true)
  expect(listener).toHaveBeenCalledOnce()
  expect(storage.get('tpcowork-show-todos')).toBe('true')
  expect(preferences.get().showTodos).toBe(true)
})

it('matches the system language exactly first, then by primary language', () => {
  const locales = [{ id: 'en' }, { id: 'zh-CN' }]
  expect(systemLocale(locales, ['zh-TW', 'en-US'])).toBe('zh-CN')
  expect(systemLocale(locales, ['fr', 'en-GB'])).toBe('en')
  expect(systemLocale(locales, ['fr'])).toBeUndefined()
})

function questionCard(key: string) {
  let waitState = 'counting'
  const listeners = new Set<() => void>()
  return {
    kind: 'question', key, questions: [{ id: 'q1', question: 'Which file?' }, { id: 'q2', question: 'Why?' }],
    answer: vi.fn(async () => {}),
    snapshot: () => ({ waitState, countdown: undefined }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    set(state: string) { waitState = state; for (const listener of listeners) listener() },
  }
}

function sessionStatus() {
  let status = new Map<string, { pendingInteraction?: unknown }>()
  const listeners = new Set<() => void>()
  return {
    uiSession: { sessionStatus: { getSnapshot: () => status, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) } } },
    publish(entries: [string, unknown][]) {
      status = new Map(entries.map(([id, pendingInteraction]) => [id, { pendingInteraction }]))
      for (const listener of listeners) listener()
    },
  }
}

it('continues an untouched question after the window, pausing while it has focus', () => {
  vi.useFakeTimers()
  const status = sessionStatus()
  const card = questionCard('q:1')
  const stop = watchQuestionAutoContinue(status.uiSession, () => true, () => () => {}, 1000)
  status.publish([['one', card]])
  vi.advanceTimersByTime(600)
  card.set('focused')
  vi.advanceTimersByTime(5000)
  expect(card.answer).not.toHaveBeenCalled()
  card.set('counting')
  vi.advanceTimersByTime(399)
  expect(card.answer).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(card.answer).toHaveBeenCalledWith({ answers: [
    { id: 'q1', selected: [], custom: ASK_AUTO_CONTINUE_NOTE }, { id: 'q2', selected: [], custom: ASK_AUTO_CONTINUE_NOTE },
  ] })
  stop()
})

it('leaves edited questions, plan reviews and questions asked while the switch is off waiting', () => {
  vi.useFakeTimers()
  const status = sessionStatus()
  let enabled = true
  const toggles = new Set<() => void>()
  const stop = watchQuestionAutoContinue(status.uiSession, () => enabled, (listener: () => void) => { toggles.add(listener); return () => toggles.delete(listener) }, 1000)
  const edited = questionCard('q:edited')
  const review = { ...questionCard('plan:1'), kind: 'plan-review' }
  const later = questionCard('q:later')
  status.publish([['one', edited], ['two', review], ['three', later]])
  edited.set('editing')
  vi.advanceTimersByTime(500)
  enabled = false
  for (const listener of toggles) listener()
  vi.advanceTimersByTime(5000)
  expect(edited.answer).not.toHaveBeenCalled()
  expect(review.answer).not.toHaveBeenCalled()
  expect(later.answer).not.toHaveBeenCalled()
  stop()
})

it('marks each reasoning row after the first of its Turn', () => {
  document.body.innerHTML = `
    <div data-chat-turn="1"><div data-variant="think" id="a"></div></div>
    <div data-chat-turn="1"><div data-variant="think" id="b"></div></div>
    <div data-chat-turn="2"><div data-variant="think" id="c"></div><div data-variant="think" id="d"></div></div>`
  expect(markLaterReasoning(document).map(row => row.id)).toEqual(['b', 'd'])
  expect([...document.querySelectorAll('[data-tpcowork-later-reasoning]')].map(row => row.id)).toEqual(['b', 'd'])
  document.querySelector('#a')!.remove()
  markLaterReasoning(document)
  expect([...document.querySelectorAll('[data-tpcowork-later-reasoning]')].map(row => row.id)).toEqual(['d'])
})
