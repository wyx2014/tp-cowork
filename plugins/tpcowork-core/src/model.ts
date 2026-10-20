/** Independently registers the product's intranet routes on the existing DSH LLM service. */
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import type { Context } from '@deepseek-ai/cordis'
import { Config, PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { Config as ModelConfig, Options } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import { resolveProfiles } from '../../../../deepseek-harness/packages/llm/llm-pi-ai/src/config.ts'
import { authContextFrom, credentialStoreFrom } from '../../../../deepseek-harness/packages/llm/llm-pi-ai/src/auth.ts'
import { discoverModels } from '../../../../deepseek-harness/packages/llm/llm-pi-ai/src/discovery.ts'

export { Config }
export const name = 'tpcowork-core-model'
export const inject = ['llm', 'credentials']

/** Register only this instance's routes and settings, with no changes to other provider instances. */
export function apply(ctx: Context, config: ModelConfig): void {
  const settingsNs = ctx.fiber.entry?.options.id ?? name
  ctx.inject(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  let previous: ReturnType<ModelConfig['providers']['get']> | undefined
  let resolved: Map<string, ResolvedPiAiProviderProfile> | undefined
  const profiles = () => {
    const current = config.providers.get()
    if (resolved === undefined || current !== previous) {
      resolved = resolveProfiles(structuredClone(current) as Options['providers'])
      previous = current
    }
    return resolved
  }
  const resolveApiKey = async (provider: string): Promise<string> => {
    const ref = profiles().get(provider)?.apiKeyEnv
    if (ref === undefined) throw new LlmError(`TP Cowork: missing credential reference for provider "${provider}"`, 'MISSING_CREDENTIAL')
    const credential = await ctx.credentials.resolve(ref)
    if (!credential) throw new LlmError(`TP Cowork: missing credential for provider "${provider}"`, 'MISSING_CREDENTIAL')
    return assertUsableApiKey(credential.value, name, ref)
  }
  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey: provider => resolveApiKey(provider),
    auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
  })
  const entries = (): LlmConfigurableProvider[] => [...profiles()].map(([provider, profile]) => ({
    provider,
    displayName: profile.displayName,
    settingsNs,
    settingsPath: ['providers', provider],
    declared: true,
  }))
  const registration = ctx.llm.registerAdapter([...profiles().keys()], adapter)
  const directory = ctx.llm.registerConfigurableProviders(entries())
  ctx.llm.registerModelDiscovery(settingsNs, (request, signal) => discoverModels(
    { ...request, ...signal === undefined ? {} : { signal } },
    () => {
      const provider = request.provider
      if (provider === undefined || !profiles().has(provider)) return undefined
      return { headers: profiles().get(provider)?.headers, resolveApiKey: () => resolveApiKey(provider) }
    },
  ))
  ctx.on('loader/volatile-update', () => {
    registration.replace([...profiles().keys()])
    directory.replace(entries())
  })
}
