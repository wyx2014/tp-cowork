import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import React from 'react'
import { createPortal } from 'react-dom'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTaskDock } from '../src/task-panel.js'

type Todo = { content: string; status: 'completed' | 'in_progress' | 'pending' }
const h = React.createElement
const TaskDock = createTaskDock(React, createPortal)
const labels = JSON.parse(readFileSync(resolve(import.meta.dirname, '../locale/zh.json'), 'utf8')).ui
const t = (key: string, params: Record<string, number> = {}) => labels[key].replace(/\{(\w+)\}/g, (_: string, name: string) => params[name])

class Observer {
  static instances: Observer[] = []
  target?: Element
  disconnected = false
  constructor(readonly callback: ResizeObserverCallback) { Observer.instances.push(this) }
  observe(target: Element) { this.target = target }
  disconnect() { this.disconnected = true }
  resize(width: number) {
    this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
}

beforeEach(() => {
  Observer.instances = []
  vi.stubGlobal('ResizeObserver', Observer)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function projection(initial: Todo[] = []) {
  let todos = initial
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  return {
    listeners,
    useProjection(key: string) {
      expect(key).toBe('todos')
      return React.useSyncExternalStore(subscribe, () => todos)
    },
    update(next: Todo[]) { act(() => { todos = next; for (const listener of listeners) listener() }) },
  }
}

function Pane({ sessionId, store, width = 1400 }: { sessionId: string; store: ReturnType<typeof projection>; width?: number }) {
  return h('div', { 'data-conversation-content': '', 'data-conversation-session': sessionId,
    ref: (node: HTMLDivElement | null) => { if (node) Object.defineProperty(node, 'clientWidth', { configurable: true, value: width }) } },
  h('div', { 'data-composer': '' }, h(TaskDock, { sessionId, useProjection: store.useProjection, t })))
}

it('portals the live projection out of the composer, preserving order, all statuses and completed tasks', () => {
  const store = projection()
  const view = render(h(Pane, { sessionId: 'first', store }))
  expect(view.queryByRole('complementary')).toBeNull()
  const todos: Todo[] = [
    { content: '已梳理需求', status: 'completed' },
    { content: '构建主界面', status: 'in_progress' },
    { content: '同步验证插件', status: 'in_progress' },
    { content: '检查交付结果', status: 'pending' },
  ]
  store.update(todos)
  const panel = view.getByRole('complementary', { name: '任务' })
  expect(panel.parentElement).toBe(view.container.querySelector('[data-conversation-content]'))
  expect(view.container.querySelector('[data-composer]')!.querySelector('aside')).toBeNull()
  expect(within(panel).getAllByRole('listitem').map(row => row.textContent)).toEqual(todos.map(todo => todo.content))
  expect(within(panel).getAllByRole('img', { name: '进行中' })).toHaveLength(2)
  expect(within(panel).getByLabelText('已完成 1 项，共 4 项').textContent).toBe('1/4')
  store.update(todos.map(todo => ({ ...todo, status: 'completed' })))
  expect(view.getByRole('complementary').getAttribute('data-completed')).toBe('true')
  expect(view.getAllByRole('listitem')).toHaveLength(4)
  expect(view.getByLabelText('已完成 4 项，共 4 项').textContent).toBe('4/4')
  fireEvent.click(view.getByRole('button', { name: '收起任务列表' }))
  expect(view.getByText('任务已完成')).toBeTruthy()
  expect(view.queryByRole('list')).toBeNull()
  store.update([])
  expect(view.queryByRole('complementary')).toBeNull()
  expect(Observer.instances.every(observer => observer.disconnected)).toBe(true)
})

it('adapts to pane width, honors manual choices across task updates, and resets on a new session', () => {
  const store = projection([{ content: '当前任务', status: 'in_progress' }])
  const view = render(h(Pane, { sessionId: 'first', store, width: 1279 }))
  const panel = view.getByRole('complementary')
  expect(panel.getAttribute('data-expanded')).toBe('false')
  expect(view.getByText('当前任务', { selector: '.tpcowork-task-title' })).toBeTruthy()
  act(() => Observer.instances[0].resize(1280))
  expect(panel.getAttribute('data-expanded')).toBe('true')
  fireEvent.click(view.getByRole('button', { name: '收起任务列表' }))
  act(() => Observer.instances[0].resize(1500))
  store.update([{ content: '任务内容更新', status: 'pending' }])
  expect(panel.getAttribute('data-expanded')).toBe('false')
  const expand = view.getByRole('button', { name: '展开任务列表' })
  expect(expand.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(expand)
  expect(expand.getAttribute('aria-expanded')).toBe('true')
  expect(view.getByRole('list').id).toBe(expand.getAttribute('aria-controls'))
  view.rerender(h(Pane, { sessionId: 'second', store, width: 600 }))
  expect(view.getByRole('complementary').getAttribute('data-expanded')).toBe('false')
  expect(Observer.instances[0].disconnected).toBe(true)
})

it('keeps simultaneous conversation panes independent and releases portals, observers and subscriptions', () => {
  const first = projection([{ content: '会话一任务', status: 'pending' }])
  const second = projection([{ content: '会话二任务', status: 'completed' }])
  const view = render(h(React.Fragment, null,
    h(Pane, { sessionId: 'first', store: first }),
    h(Pane, { sessionId: 'second', store: second, width: 600 })))
  // Browsers deliver the initial sizes after the parent pane's refs have committed.
  act(() => { Observer.instances[0].resize(1400); Observer.instances[1].resize(600) })
  const firstPane = view.container.querySelector('[data-conversation-session="first"]')! as HTMLElement
  const secondPane = view.container.querySelector('[data-conversation-session="second"]')! as HTMLElement
  expect(within(firstPane).getByRole('complementary').parentElement).toBe(firstPane)
  expect(within(secondPane).getByRole('complementary').parentElement).toBe(secondPane)
  fireEvent.click(within(firstPane).getByRole('button', { name: '收起任务列表' }))
  fireEvent.click(within(secondPane).getByRole('button', { name: '展开任务列表' }))
  expect(within(firstPane).queryByRole('list')).toBeNull()
  expect(within(secondPane).getByRole('list').textContent).toBe('会话二任务')
  first.update([])
  expect(within(secondPane).getByRole('list').textContent).toBe('会话二任务')
  view.unmount()
  expect(document.querySelector('.tpcowork-task-panel')).toBeNull()
  expect(Observer.instances.every(observer => observer.disconnected)).toBe(true)
  expect(first.listeners.size + second.listeners.size).toBe(0)
})
