/** Client half: mounts the remote endpoint and registers the Usage stats section into the Settings panel. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { en, zh, type UsageKey } from './locales.ts'
import { remoteContribution } from './remote.ts'
import { UsagePage, type UsagePageProps } from './ui.tsx'
import { usageSnapshotSchema, type UsageRange, type UsageRequest, type UsageServiceApi } from './types.ts'
export type * from './types.ts'

const namespace = 'settings.usage'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'settings.usage': UsageKey } }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertClientRemote { usage: { get(request: UsageRequest): Promise<RemoteResult<unknown>> } }
}
export const name = 'tpcowork-usage-client'
export const inject = ['remote']

/** The reference's Z.ai light and dark palettes: model series colours, heatmap levels and the hint surface. */
const heatmap = (levels: Array<[accent: string, amount: number]>) => Object.fromEntries(levels.map(([accent, amount], index) =>
  [`--tpu-heatmap-${index + 1}`, `color-mix(in srgb, ${accent} ${amount}%, color-mix(in oklab, var(--dsw-alias-label-primary) 3%, transparent))`]))
const pair = (light: Record<string, string>, dark: Record<string, string>) =>
  Object.fromEntries(Object.keys(light).map(key => [key, { light: light[key]!, dark: dark[key]! }]))
export const themeTokens = pair({
  '--tpu-chart-1': '#0b7fff', '--tpu-chart-2': '#1e8a3e', '--tpu-chart-3': '#9e77ed', '--tpu-chart-4': '#e03131', '--tpu-chart-5': '#e07b00', '--tpu-chart-6': '#0aa7a7',
  ...heatmap([['#0b7fff', 18], ['#0b7fff', 36], ['#0b7fff', 58], ['#0066dd', 82]]),
  '--tpu-tooltip': '#f0f0f0', '--tpu-tooltip-foreground': '#0d0d0d',
}, {
  '--tpu-chart-1': '#4099ff', '--tpu-chart-2': '#46bf72', '--tpu-chart-3': '#7b5ce5', '--tpu-chart-4': '#ff5c5c', '--tpu-chart-5': '#ff8a30', '--tpu-chart-6': '#42c8c8',
  ...heatmap([['#4099ff', 24], ['#4099ff', 42], ['#4099ff', 62], ['#80beff', 78]]),
  '--tpu-tooltip': '#2b2b2b', '--tpu-tooltip-foreground': '#f8f8f8',
})

/** Registrations are withdrawn with the Client plugin fiber. */
export async function apply(ctx: Context): Promise<void> {
  const dispose = await ctx.remote.$mount(remoteContribution)
  ctx.effect(() => dispose)
  ctx.inject(['theme'], themeCtx => themeCtx.effect(() => themeCtx.theme.overrideTokens('@tpcowork/dsh-usage', themeTokens), 'tpcowork-usage: palette'))
  ctx.inject(['remote.usage', 'slots', 'locale'], uiCtx => {
    uiCtx.effect(() => uiCtx.locale.register(namespace, { en, zh }))
    const t = uiCtx.locale.bind(namespace)
    const api: UsageServiceApi = {
      async get(request) {
        const result = await uiCtx.remote.usage.get(request)
        if (!result.ok) throw result.error
        return usageSnapshotSchema.parse(result.value)
      },
    }
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const load = (range: UsageRange) => api.get({ range, timeZone })
    uiCtx.slots.inject('settings.section', () => uiCtx.slots.register({
      name: 'settings.section', id: 'usage', order: 200, label: () => t('nav'), locale: namespace,
      inject: () => ({ load, locale: uiCtx.locale.getSnapshot().active }),
    }, UsagePage as (props: UsagePageProps) => ReturnType<typeof UsagePage>))
  })
}
