import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import React from 'react'
import { createPortal } from 'react-dom'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as primitives from '../../../../deepseek-harness/packages/client/ui-primitives/src/index.ts'
import { createModelControls, nextThoughtLevel, thoughtProgress } from '../src/model-controls.js'

const ModelControls = createModelControls(React, createPortal, primitives)
const labels = JSON.parse(readFileSync(resolve(import.meta.dirname, '../locale/zh.json'), 'utf8')).ui
const tp = (key: string) => labels[key] ?? key
const t = (key: string, params: Record<string, string> = {}) => `${key}${Object.values(params).map(value => `:${value}`).join('')}`
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const efforts = ['off', 'low', 'high', 'max'].map(id => ({ id, name: id }))
const groups = [
  { id: 'custom', name: 'Custom', models: [{ id: 'plain', name: 'Plain' }, { id: 'single', name: 'Single', reasoning: { efforts: [efforts[0]], defaultEffort: 'off' } }] },
  { id: 'deepseek-official', name: 'DeepSeek', models: [
    { id: 'flash', name: 'DeepSeek-V4-Flash', inputModalities: ['text', 'image'], reasoning: { efforts, defaultEffort: 'high' } },
    { id: 'toggle', name: 'Toggle', reasoning: { efforts: [{ id: 'disabled', name: 'Disabled' }, { id: 'enabled', name: 'Enabled' }], defaultEffort: 'enabled' } },
  ] },
  { id: 'deepseek-account', name: 'Account', models: [{ id: 'pro', name: 'DeepSeek-V4-Pro', reasoning: { efforts, defaultEffort: 'high' } }] },
]

function fixture(current: { provider: string; model: string; reasoningEffort?: string } | null) {
  let state = { current, routable: true, groups, failures: [], status: 'ready', pending: null, error: null }
  const listeners = new Set<() => void>()
  const directory = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  const select = vi.fn(async (selection: { provider: string; model: string; reasoningEffort?: string }) => {
    state = { ...state, current: selection }
    for (const listener of listeners) listener()
    return { ok: true }
  })
  const load = vi.fn()
  render(React.createElement(ModelControls, { locked: false, available: true, directory, load, select, t, tp }))
  return { select, load }
}

const trigger = () => screen.getByRole('button', { expanded: false, name: /DeepSeek|Plain|Single|Toggle|Pro|trigger/ })
const menu = () => screen.getByRole('menu', { name: 'menu.aria' })
const slider = () => screen.getByTestId('composer-thought-slider') as HTMLInputElement

it('names the model and its effort on one trigger and opens the combined menu above it', async () => {
  const { load } = fixture({ provider: 'deepseek-official', model: 'flash' })
  expect(load).toHaveBeenCalledOnce()
  const button = trigger()
  expect(button.getAttribute('aria-label')).toBe('DeepSeek-V4-Flash 高')
  fireEvent.click(button)
  // While open the trigger reads "Select model".
  expect(screen.getByRole('button', { expanded: true }).textContent).toBe('选择模型')
  const body = menu()
  expect(within(body).getByTestId('composer-provider-trigger').textContent).toContain('DeepSeek')
  expect(within(body).getByTestId('composer-provider-trigger').textContent).toContain('API')
  expect(within(body).getByText('模型')).toBeTruthy()
  const rows = within(body).getAllByRole('menuitemradio')
  expect(rows.map(row => [row.textContent, row.getAttribute('aria-checked')])).toEqual([['DeepSeek-V4-Flash视觉', 'true'], ['Toggle', 'false']])
  expect(within(body).getByText('思考强度')).toBeTruthy()
  expect(within(body).getByTestId('composer-thought-value').textContent).toBe('高')
  expect(slider().value).toBe('2')
})

it('changes the effort with the slider, keeps the menu open, and shows bubbles at the greatest level', async () => {
  const { select } = fixture({ provider: 'deepseek-official', model: 'flash' })
  fireEvent.click(trigger())
  expect(screen.queryByTestId('composer-thought-bubbles')).toBeNull()
  await act(async () => { fireEvent.change(slider(), { target: { value: '3' } }) })
  expect(select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'flash', reasoningEffort: 'max' })
  expect(menu()).toBeTruthy()
  expect(screen.getByTestId('composer-thought-value').textContent).toBe('最高')
  expect(screen.getByTestId('composer-thought-bubbles').children).toHaveLength(12)
  // Off leaves the fill empty.
  await act(async () => { fireEvent.change(slider(), { target: { value: '0' } }) })
  expect(document.querySelector<HTMLElement>('.tpcowork-thought-fill')!.style.width).toBe('0px')
})

it('switches models in place and moves to another provider through the provider submenu', async () => {
  const { select } = fixture({ provider: 'deepseek-official', model: 'flash' })
  fireEvent.click(trigger())
  await act(async () => { fireEvent.click(within(menu()).getByRole('menuitemradio', { name: /Toggle/ })) })
  expect(select).toHaveBeenLastCalledWith({ provider: 'deepseek-official', model: 'toggle' })
  expect(within(menu()).getByTestId('composer-thought-value').textContent).toBe('开启')
  fireEvent.mouseEnter(within(menu()).getByTestId('composer-provider-trigger'))
  const providers = screen.getByRole('menu', { name: '供应商' })
  expect(within(providers).getAllByRole('menuitemradio').map(row => row.getAttribute('data-model-provider-key')))
    .toEqual(['deepseek-account', 'deepseek-official', 'custom'])
  await act(async () => { fireEvent.click(within(providers).getByRole('menuitemradio', { name: /Custom/ })) })
  // The selection moves with the provider to its first model; a model without levels has no effort section.
  expect(select).toHaveBeenLastCalledWith({ provider: 'custom', model: 'plain' })
  expect(within(menu()).getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['Plain', 'Single'])
  expect(screen.queryByTestId('composer-thought-slider')).toBeNull()
})

it('shows a single level without a slider and cycles levels for the shortcut', async () => {
  const { select } = fixture({ provider: 'custom', model: 'single' })
  fireEvent.click(trigger())
  expect(screen.getByTestId('composer-thought-value').textContent).toBe('关闭')
  expect(screen.queryByTestId('composer-thought-slider')).toBeNull()
  expect(ModelControls.cycleThought()).toBe(false)
  cleanup()
  const second = fixture({ provider: 'deepseek-official', model: 'flash', reasoningEffort: 'max' })
  await act(async () => { expect(ModelControls.cycleThought()).toBe(true) })
  expect(second.select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'flash', reasoningEffort: 'off' })
  expect(select).not.toHaveBeenCalled()
})

it('fills the compact meter by thinking level and cycles with wrap-around', () => {
  const levels = efforts.map(level => ({ key: level.id, effort: level.id, label: level.name }))
  expect(['off', 'low', 'high', 'max', 'other'].map(effort => thoughtProgress(levels, effort))).toEqual([0, 1 / 3, 2 / 3, 1, 0])
  expect(['max', 'off', 'other'].map(effort => nextThoughtLevel(levels, effort)?.effort)).toEqual(['off', 'low', 'off'])
})
