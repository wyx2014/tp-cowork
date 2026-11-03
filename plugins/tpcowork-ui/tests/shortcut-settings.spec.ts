import { expect, it } from 'vitest'
import { bindingFromEvent, shortcutRows } from '../src/shortcut-settings.js'

const row = (id: string, label: string, aliases: string[] = []) => ({ id, label, aliases, keys: ['⌘', 'N'], binding: { code: 'KeyN', modifiers: ['meta'] }, modified: false })
const catalog = [row('zeta.custom', 'Zeta'), row('settings.open', 'Open settings', ['preferences']), row('session.new', 'New task')]
const fixed = [
  { id: 'fixed.dismiss', label: 'Close menu', keys: ['Esc'], bindings: [], group: 'menus' },
  { id: 'fixed.send', label: 'Send', keys: ['Enter'], bindings: [], group: 'input' },
]

it('lists editable commands in product order, then read-only input and menu keys', () => {
  const rows = shortcutRows(catalog, fixed, '', null)
  expect(rows.map(entry => [entry.id, entry.group, entry.editable])).toEqual([
    ['session.new', 'application', true], ['settings.open', 'application', true], ['zeta.custom', 'application', true],
    ['fixed.send', 'input', false], ['fixed.dismiss', 'menus', false],
  ])
})

it('filters by label, id or alias text, and by the commands bound to a searched combination', () => {
  expect(shortcutRows(catalog, fixed, 'PREFER', null).map(entry => entry.id)).toEqual(['settings.open'])
  expect(shortcutRows(catalog, fixed, 'close', null).map(entry => entry.id)).toEqual(['fixed.dismiss'])
  expect(shortcutRows(catalog, fixed, '', ['zeta.custom', 'fixed.send']).map(entry => entry.id)).toEqual(['zeta.custom', 'fixed.send'])
  expect(shortcutRows(catalog, fixed, 'new', [])).toEqual([])
})

it('records physical keys with their modifiers and skips lone modifiers and composition', () => {
  const key = (init: Partial<KeyboardEvent>) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, isComposing: false, keyCode: 0, ...init }) as KeyboardEvent
  expect(bindingFromEvent(key({ code: 'KeyK', metaKey: true, shiftKey: true }))).toEqual({ code: 'KeyK', modifiers: ['shift', 'meta'] })
  expect(bindingFromEvent(key({ code: 'MetaLeft', metaKey: true }))).toBeNull()
  expect(bindingFromEvent(key({ code: 'KeyA', isComposing: true }))).toBeNull()
  expect(bindingFromEvent(key({ code: 'KeyA', keyCode: 229 }))).toBeNull()
})
