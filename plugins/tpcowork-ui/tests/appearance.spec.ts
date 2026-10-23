import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import * as ReactDOM from 'react-dom'
import * as primitives from '../../../../deepseek-harness/packages/client/ui-primitives/src/index.ts'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HeroShell } from '../../../../deepseek-harness/packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx'
import { en } from '../../../../deepseek-harness/packages/client/ui-conversation/src/client/locales.ts'
import { en as commonEn } from '../../../../deepseek-harness/packages/client/locale/src/locales/en.ts'
import { makeTranslate } from '../../../../deepseek-harness/packages/test-support/client-runtime/src/index.ts'
import { upstreamStyles } from '../src/upstream-styles.js'
import { upstreamCss } from '../src/upstream-css.js'

vi.mock('../../../../deepseek-harness/packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css', async () => {
  const { readFile } = await import('node:fs/promises')
  const maps = JSON.parse(await readFile(resolve(import.meta.dirname, '../upstream-classes.json'), 'utf8'))
  return { default: maps.hero }
})

const maps: Record<string, Record<string, string>> = JSON.parse(readFileSync(resolve(import.meta.dirname, '../upstream-classes.json'), 'utf8'))
const styles: HTMLStyleElement[] = []
afterEach(() => {
  cleanup()
  for (const style of styles.splice(0)) style.remove()
  document.body.removeAttribute('data-tpcowork-ui')
})

function style(text: string): void {
  const node = document.createElement('style')
  node.textContent = text
  document.head.appendChild(node)
  styles.push(node)
}

it('shows the greeting and sidebar preview badge with shipped upstream styles and restores the Hero when disabled', async () => {
  const upstream = await upstreamCss(pathToFileURL(resolve(import.meta.dirname, '../../../../deepseek-harness/packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css')))
  expect(maps.hero).toEqual(upstream.classes)
  style(upstream.css)
  style(readFileSync(resolve(import.meta.dirname, '../styles.css'), 'utf8'))
  style(readFileSync(resolve(import.meta.dirname, '../upstream.css'), 'utf8'))
  let factory: (require: (id: string) => unknown) => { apply: (ctx: object) => void }
  vm.runInNewContext(readFileSync(resolve(import.meta.dirname, '../client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load(entry: { factory: typeof factory }) { factory = entry.factory } } }, document, URL,
  })
  const plugin = factory!(id => id === 'react-dom' ? ReactDOM : id === 'react' ? React : primitives)
  const entries = new Map<string, React.FunctionComponent<{ t: (key: string) => string }>>()
  const disposers: (() => void)[] = []
  const snapshot = { layoutInfo: { sidebar: 280 } }
  const instance = { getSnapshot: () => snapshot, actions: { setSidebar: (width: number) => { snapshot.layoutInfo.sidebar = width } },
    subscribe: () => () => {} }
  plugin.apply({
    inject: () => () => {},
    effect: (effect: () => () => void) => { disposers.push(effect()) },
    theme: { overrideTokens: () => () => {}, getTheme: () => ({ preference: 'system' }) },
    locale: { register: () => () => {}, bind: () => () => '', getLocale: () => ({ locales: [] }), subscribe: () => () => {} },
    configForms: { get: () => ({ getSnapshot: () => ({}), subscribe: () => () => {} }) }, on: () => () => {},
    slots: {
      entries: (name: string) => name === 'root' ? [{ store: { create: () => instance } }] : [],
      subscribe: () => () => {},
      inject: (_name: string, effect: () => () => void) => { disposers.push(effect()) },
      register: (options: { name: string }, component: React.FunctionComponent<{ t: (key: string) => string }>) => {
        entries.set(options.name, component)
        return () => { entries.delete(options.name) }
      },
    },
  })
  const zh = JSON.parse(readFileSync(resolve(import.meta.dirname, '../locale/zh.json'), 'utf8')).ui
  const Brand = entries.get('sidebar.brand.name')!
  const Mark = entries.get('sidebar.brand.mark')!
  const mark = render(React.createElement(Mark, { t: (key: string) => zh[key] }))
  expect(mark.container.querySelector('img')?.getAttribute('src')).toBe(`data:image/png;base64,${readFileSync(resolve(import.meta.dirname, '../icon.png')).toString('base64')}`)
  const brand = render(React.createElement(Brand, { t: (key: string) => zh[key] }))
  expect(brand.container.querySelector('.tpcowork-preview-badge')?.textContent).toBe('预览版')
  const view = render(React.createElement(HeroShell, {
    t: makeTranslate(en, commonEn),
    renderSlot: (name, _owner, options) => {
      const component = entries.get(name)
      return component === undefined ? options?.fallback ?? null : React.createElement(component, { t: (key: string) => zh[key] })
    },
  }))
  expect(view.getByRole('heading', { name: zh.greeting })).toBeTruthy()
  const original = view.getByText('Into the Unknown').closest(`.${maps.hero.titleGroup}`)!
  expect(getComputedStyle(original).display).toBe('none')
  expect(view.container.textContent).not.toContain('预览版')
  for (const dispose of disposers.reverse()) dispose()
  view.rerender(React.createElement(HeroShell, { t: makeTranslate(en, commonEn),
    renderSlot: (_name, _owner, options) => options?.fallback ?? null }))
  expect(view.queryByRole('heading', { name: zh.greeting })).toBeNull()
  expect(getComputedStyle(view.getByText('Into the Unknown').closest(`.${maps.hero.titleGroup}`)!).display).toBe('flex')
  expect(view.getByText('Preview')).toBeTruthy()
})

it('keeps sidebar rail and hero input rules out of the expanded and docked overrides', () => {
  style(readFileSync(resolve(import.meta.dirname, '../upstream.css'), 'utf8'))
  document.body.setAttribute('data-tpcowork-ui', '')
  const sidebar = document.createElement('div')
  sidebar.className = `${maps.sidebar.root} ${maps.sidebar.collapsed}`
  const button = document.createElement('button')
  button.className = maps.sidebar.newSession
  sidebar.appendChild(button)
  document.body.appendChild(sidebar)
  const selectors = [...styles[0].sheet!.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
  expect(selectors.filter(rule => rule.style.getPropertyValue('height') !== '').some(rule => button.matches(rule.selectorText))).toBe(false)
  sidebar.classList.remove(maps.sidebar.collapsed)
  expect(selectors.some(rule => rule.style.getPropertyValue('height') !== '' && button.matches(rule.selectorText))).toBe(true)
  sidebar.remove()
  const inputRoot = document.createElement('div')
  inputRoot.className = `${maps.input.root} ${maps.input.hero}`
  const input = document.createElement('div')
  input.className = maps.input.input
  inputRoot.appendChild(input)
  document.body.appendChild(inputRoot)
  const minimums = selectors.filter(rule => rule.style.getPropertyValue('min-height') !== '')
  expect(minimums.some(rule => input.matches(rule.selectorText))).toBe(false)
  inputRoot.classList.remove(maps.input.hero)
  expect(minimums.some(rule => input.matches(rule.selectorText))).toBe(true)
  inputRoot.remove()
})

it.each([['input', 'card'], ['input', 'hero'], ['sidebar', 'collapsed']])('fails the plugin build when upstream class %s.%s disappears', (module, local) => {
  const changed = structuredClone(maps)
  delete changed[module][local]
  expect(() => upstreamStyles(changed)).toThrow(`${module}.${local} is missing`)
})
