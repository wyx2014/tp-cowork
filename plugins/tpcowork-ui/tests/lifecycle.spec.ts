import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'
import React from 'react'
import * as ReactDOM from 'react-dom'
import * as primitives from '../../../../deepseek-harness/packages/client/ui-primitives/src/index.ts'
import { Context } from '../../../../deepseek-harness/vendor/cordis/src/index.ts'
import Loader from '../../../../deepseek-harness/vendor/loader/src/index.ts'
import { SlotRegistry } from '../../../../deepseek-harness/packages/client/ui-renderer/src/client/index.ts'
import { LocaleRuntime } from '../../../../deepseek-harness/packages/client/locale/src/client/index.ts'
import { ThemeRuntime } from '../../../../deepseek-harness/packages/client/ui-theme/src/client/index.ts'
import { stubConfigForm } from '../../../../deepseek-harness/packages/test-support/client-runtime/src/config-form.ts'
import { apply as layoutApply, inject as layoutInject } from '../../../../deepseek-harness/packages/client/ui-layout/src/client/index.ts'
import { createLayoutStore } from '../../../../deepseek-harness/packages/client/ui-layout/src/client/stores.ts'
import { adaptSidebar } from '../src/layout-adapter.js'
import ShortcutsService from '../../../../deepseek-harness/packages/client/shortcuts/src/client/index.ts'
import { createClientModuleSystem } from '../../../../deepseek-harness/packages/client/modules/src/client/index.ts'
import type { ClientBundleRegistration, ClientModuleLoaderTarget, WebBootGraph } from '../../../../deepseek-harness/packages/client/modules/src/client/index.ts'
const { apply: hostApply } = createRequire(import.meta.url)('../index.js')

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  document.body.removeAttribute('style')
  document.body.removeAttribute('data-ds-dark-theme')
})

it('boots layout without Host config through the browser Loader and retracts the packaged appearance on unload', async () => {
  const root = new Context()
  let ctx: Context
  const owner = root.plugin((child: Context) => { ctx = child })
  await owner.await()
  cleanups.push(() => owner.dispose())
  await ctx!.plugin(SlotRegistry).await()
  ctx!.provide('locale', new LocaleRuntime(ctx!))
  const theme = new ThemeRuntime(ctx!, stubConfigForm().scope)
  ctx!.provide('theme', theme)
  await ctx!.plugin(ShortcutsService).await()
  let entry: ClientBundleRegistration
  vm.runInNewContext(await readFile(resolve(import.meta.dirname, '../client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load(value: ClientBundleRegistration) { entry = value } } }, document, URL,
  })
  expect(entry!.id).toBe('@tpcowork/dsh-ui')
  const layoutId = '@deepseek-ai/dsh-client-ui-layout'
  const graph = (...ids: string[]): WebBootGraph => ({
    rev: ids.join(','),
    entries: ids.map(id => ({ id, rev: 'test', url: `/plugins/??${id}/client.js&rev=test` })),
    batches: ids.map(id => ({ phase: 'application', url: `/plugins/??${id}/client.js&rev=test`, rev: 'test', entries: [id] })),
  })
  const target: ClientModuleLoaderTarget = {
    mode: 'queue', pendingQueue: [], load: () => {},
    create: options => createClientModuleSystem(target, { id: 'bootstrap', exports: {} }, options),
  }
  const modules = target.create({
    boot: graph(layoutId), staticModules: { react: React, 'react-dom': ReactDOM, '@deepseek-ai/dsh-client-ui-primitives': primitives },
    loadBundle: async url => {
      target.load(url.includes(layoutId)
        ? { id: layoutId, factory: () => ({ apply: layoutApply, inject: layoutInject }) }
        : entry!)
    },
  })
  await ctx!.plugin(Loader).await()
  const loader = ctx!.get('loader') as Loader
  loader.internal = modules as never
  await modules.entries.start(loader, modules.manifest)
  const slotsService = ctx!.get('slots') as SlotRegistry
  const handle = slotsService.entries('root')[0]!.store as ReturnType<typeof createLayoutStore>
  const layout = handle.create()
  expect(layout.getSnapshot().layoutInfo.sidebar).toBe(280)
  slotsService.register({ name: 'sidebar', children: {
    'sidebar.brand.name': { kind: 'single', scope: 'root' },
    'sidebar.brand.mark': { kind: 'single', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
    'sidebar.settings': { kind: 'single', scope: 'root' },
  } }, () => null)
  slotsService.register({ name: 'sidebar.settings', children: {
    'settings.launcher': { kind: 'single', scope: 'root' },
  } }, () => null)
  const NativeSettings = () => null
  slotsService.register({ name: 'settings.launcher', locale: 'settings.account' }, NativeSettings)
  slotsService.register({ name: 'main', key: 'conversation', children: {
    'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
    'conversation.input.dock': { kind: 'list', scope: 'session' },
  } }, () => null)
  const NativeTodo = () => null
  slotsService.register({ name: 'conversation.input.dock', id: 'todo', order: 0, locale: 'conversation' }, NativeTodo)
  await modules.entries.sync(graph(layoutId, entry!.id))
  expect(layout.getSnapshot().layoutInfo.sidebar).toBe(264)
  const slots = ['sidebar.brand.name', 'sidebar.brand.mark', 'conversation.hero.brand.mark'] as const
  for (const name of slots) expect(slotsService.entries(name)).toHaveLength(1)
  expect(slotsService.entries('conversation.input.dock').find(entry => entry.options.priority === -10)?.locale).toBe('tpcowork')
  expect(slotsService.entriesOfSlot('conversation.input.dock')).toHaveLength(1)
  expect(slotsService.entriesOfSlot('conversation.input.dock')[0].component).not.toBe(NativeTodo)
  expect(slotsService.entriesOfSlot('settings.launcher')[0].component).not.toBe(NativeSettings)
  expect(slotsService.entriesOfSlot('settings.launcher')[0].locale).toBe('tpcowork')
  expect(document.body.hasAttribute('data-tpcowork-ui')).toBe(true)
  expect(document.head.querySelectorAll('[data-plugin="@tpcowork/dsh-ui"]')).toHaveLength(1)
  expect(theme.getTheme().active.tokens['--dsw-static-neutral-75']).toBe('rgb(248, 248, 248)')
  expect(theme.getTheme().active.tokens['--dsh-sidebar-brand-mark-display']).toBe('none')
  const nativeEntry = slotsService.register({ name: 'sidebar.panellist', id: 'schedules', locale: 'schedule.manager' }, () => null)
  await vi.waitFor(() => expect(slotsService.entries('sidebar.panellist')).toHaveLength(2))
  const automationEntry = slotsService.register({ name: 'sidebar.panellist', id: 'schedules', priority: -20, locale: 'tpcowork.automation' }, () => null)
  await vi.waitFor(() => expect(slotsService.entries('sidebar.panellist').every(entry => entry.options.priority !== -10)).toBe(true))
  expect(slotsService.entries('sidebar.panellist')).toHaveLength(2)
  expect(slotsService.entries('sidebar.panellist').every(entry => entry.options.priority !== -10)).toBe(true)
  nativeEntry()
  expect(slotsService.entries('sidebar.panellist')).toHaveLength(1)
  automationEntry()
  expect(document.body.style.getPropertyValue('--dsh-hero-width')).toBe('672px')
  theme.setTheme('dark')
  expect(theme.getTheme().active.tokens['--dsh-sidebar-brand-mark-display']).toBe('none')
  expect(theme.getTheme().active.tokens['--dsw-specific-input-major']).toBe('var(--dsw-static-neutral-775)')
  expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
  expect(document.body.style.getPropertyValue('--dsw-menu-surface-fill')).toBe('#2b2b2b')
  expect('overrideSidebarWidth' in ctx!.get('layout')).toBe(false)
  layout.actions.setSidebar(400)
  expect(layout.getSnapshot().layoutInfo.sidebar).toBe(400)
  ctx!.get('layout').toggleSidebar()
  expect(layout.getSnapshot().layoutInfo.sidebar).toBe(0)
  ctx!.get('layout').toggleSidebar()
  expect(layout.getSnapshot().layoutInfo.sidebar).toBe(264)
  layout.actions.setViewportWidth(800)
  ctx!.get('layout').toggleSidebar()
  expect(layout.getSnapshot().layoutInfo.narrowExpanded).toBe(true)
  expect(layout.getSnapshot().layoutInfo.sidebar).toBe(264)
  layout.actions.setViewportWidth(1280)
  await modules.entries.sync(graph(layoutId))
  expect(layout.getSnapshot().layoutInfo.sidebar).toBe(280)
  for (const name of slots) expect(slotsService.entries(name)).toHaveLength(0)
  expect(slotsService.entries('conversation.input.dock')).toHaveLength(1)
  expect(slotsService.entries('conversation.input.dock')[0].component).toBe(NativeTodo)
  expect(slotsService.entriesOfSlot('settings.launcher')).toHaveLength(1)
  expect(slotsService.entriesOfSlot('settings.launcher')[0].component).toBe(NativeSettings)
  expect(document.body.hasAttribute('data-tpcowork-ui')).toBe(false)
  expect(document.head.querySelector('[data-plugin="@tpcowork/dsh-ui"]')).toBeNull()
  expect(document.body.style.getPropertyValue('--dsh-hero-width')).toBe('')
  expect(theme.getTheme().preference).toBe('dark')
})

it('preserves dragged widths and closed state when the appearance unloads', () => {
  const handle = createLayoutStore()
  const instance = handle.create()
  instance.actions.setViewportWidth(1280)
  const slots = { entries: () => [{ store: { ...handle, create: () => instance } }] }
  const wide = adaptSidebar(slots, 264, 280)
  instance.actions.setSidebar(400)
  wide()
  expect(instance.getSnapshot().layoutInfo.sidebar).toBe(400)
  instance.actions.toggleSidebar()
  expect(instance.getSnapshot().layoutInfo.sidebar).toBe(0)
  const closed = adaptSidebar(slots, 264, 280)
  expect(instance.getSnapshot().layoutInfo.sidebar).toBe(0)
  instance.actions.toggleSidebar()
  expect(instance.getSnapshot().layoutInfo.sidebar).toBe(264)
  instance.actions.toggleSidebar()
  closed()
  expect(instance.getSnapshot().layoutInfo.sidebar).toBe(0)
  instance.actions.toggleSidebar()
  expect(instance.getSnapshot().layoutInfo.sidebar).toBe(280)
  instance.actions.setSidebar(264)
  closed()
  expect(instance.getSnapshot().layoutInfo.sidebar).toBe(264)
})

it('rejects an upstream layout that no longer exposes the same shared store', () => {
  const handle = createLayoutStore()
  const slots = { entries: () => [{ store: handle }] }
  expect(() => adaptSidebar(slots, 264, 280)).toThrow(/upstream layout store has changed/)
})

it('contributes bootstrap styles only for the Host plugin lifetime', async () => {
  const ctx = new Context()
  const fiber = ctx.plugin({ apply: hostApply })
  await fiber.await()
  cleanups.push(() => fiber.dispose())
  const rows: { kind: string; text: string }[] = []
  ctx.emit('webserver/index-inject', rows)
  expect(rows.map(row => row.kind)).toEqual(['style', 'script'])
  expect(rows[0].text).toContain('body[data-tpcowork-ui][data-ds-dark-theme]')
  await fiber.dispose()
  const after: typeof rows = []
  ctx.emit('webserver/index-inject', after)
  expect(after).toEqual([])
})
