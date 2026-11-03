import { expect, it } from 'vitest'
import { scaleInterfaceText } from '../src/ui-font-size.js'

it('offsets fixed interface font sizes by the text size delta, leaves code and variables alone, and restores on dispose', async () => {
  const style = document.createElement('style')
  style.textContent = `
    .nav { font-size: 14px; }
    .title { font-size: 30px !important; }
    @media (min-width: 1px) { .hint { font-size: 12px; } }
    .chat { font-size: var(--dsh-content-font-size, 14px); }
    .xterm-rows { font-size: 13px; }
    .diff { font-size: 12px; font-family: ui-monospace, monospace; }
    .icon { width: 16px; }`
  document.head.append(style)
  const dispose = scaleInterfaceText(document)
  const sizes = () => Object.fromEntries([...style.sheet!.cssRules].flatMap(rule => 'cssRules' in rule && !('style' in rule)
    ? [...(rule as CSSMediaRule).cssRules] : [rule]).map(rule => [(rule as CSSStyleRule).selectorText, (rule as CSSStyleRule).style.getPropertyValue('font-size')]))
  const scaled = sizes()
  expect(scaled['.nav']).toBe('calc(14px + var(--dsh-content-font-delta, 0px))')
  expect(scaled['.hint']).toBe('calc(12px + var(--dsh-content-font-delta, 0px))')
  expect(scaled['.title']).toContain('calc(30px')
  expect(scaled['.chat']).toBe('var(--dsh-content-font-size, 14px)')
  expect(scaled['.xterm-rows']).toBe('13px')
  expect(scaled['.diff']).toBe('12px')

  // A stylesheet added later, such as a plugin's, is scaled as it arrives.
  const late = document.createElement('style')
  late.textContent = '.late { font-size: 11px; }'
  document.head.append(late)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect((late.sheet!.cssRules[0] as CSSStyleRule).style.getPropertyValue('font-size')).toContain('calc(11px')

  dispose()
  expect(sizes()['.nav']).toBe('14px')
  expect((late.sheet!.cssRules[0] as CSSStyleRule).style.getPropertyValue('font-size')).toBe('11px')
})
