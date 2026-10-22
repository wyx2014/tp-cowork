import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '../../../../deepseek-harness/vendor/cordis/src/index.ts'
import { LocaleRuntime } from '../../../../deepseek-harness/packages/client/locale/src/client/index.ts'
import { ThemeRuntime } from '../../../../deepseek-harness/packages/client/ui-theme/src/client/index.ts'
import { stubConfigForm } from '../../../../deepseek-harness/packages/test-support/client-runtime/src/config-form.ts'
import { createInterfacePreferences } from '../src/interface-preferences.js'

const disposers: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })

async function fixture() {
  const root = new Context()
  let ctx: Context
  const owner = root.plugin((scope: Context) => { ctx = scope })
  await owner.await()
  disposers.push(() => owner.dispose())
  const host = stubConfigForm<{ preference?: string }>()
  host.publish({ status: 'ready', value: { preference: 'zh' }, writable: true })
  host.set.mockImplementation(async (field: string, value: string) => {
    host.publish({ value: { [field]: value } }); return true
  })
  host.unset.mockImplementation(async () => { host.publish({ value: {} }); return true })
  const locale = new LocaleRuntime(ctx! as never, host.scope)
  const theme = new ThemeRuntime(ctx! as never, stubConfigForm().scope)
  const preferences = createInterfacePreferences({
    locale, theme, configForms: { get: () => host.scope }, on: ctx!.on.bind(ctx!),
  })
  disposers.push(preferences.dispose)
  return { preferences, locale, theme, host }
}

it('adopts durable locale writes and clearing the system override through the real locale service', async () => {
  const { preferences, locale, host } = await fixture()
  expect(preferences.source.getSnapshot().localePreference).toBe('zh')
  await preferences.setInterfacePreference('locale:en')
  expect(host.set).toHaveBeenLastCalledWith('preference', 'en')
  expect(locale.getLocale().active).toBe('en')
  expect(preferences.source.getSnapshot().localePreference).toBe('en')
  await preferences.setInterfacePreference('locale:system')
  expect(host.unset).toHaveBeenCalledWith('preference')
  expect(preferences.source.getSnapshot().localePreference).toBe('system')
  host.set.mockResolvedValueOnce(false)
  await expect(preferences.setInterfacePreference('locale:zh')).rejects.toThrow('refused')
  expect(preferences.source.getSnapshot().localePreference).toBe('system')
})

it('tracks real theme changes, including outside the menu', async () => {
  const { preferences, theme } = await fixture()
  await preferences.setInterfacePreference('theme:dark')
  expect(theme.getTheme().preference).toBe('dark')
  theme.setTheme('light')
  expect(preferences.source.getSnapshot().themePreference).toBe('light')
  await preferences.setInterfacePreference('theme:system')
  expect(theme.getTheme().preference).toBe('system')
})

it('releases all preference listeners when the plugin unloads', async () => {
  const { preferences, host, theme } = await fixture()
  const listener = vi.fn()
  preferences.source.subscribe(listener)
  const before = host.listenerCount()
  preferences.dispose()
  expect(host.listenerCount()).toBe(before - 1)
  theme.setTheme('dark')
  host.publish({ value: { preference: 'en' } })
  expect(listener).not.toHaveBeenCalled()
})
