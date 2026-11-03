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
import { chatModels, replacementModel, syncedModels, type ModelEntry } from './model-sync.ts'

/** Ask the model server for its models once per launch, as nanobot-gui does; a failed ask keeps the built-in list. */
const SYNC_TIMEOUT_MS = 15_000
/** The product credential is seeded just after startup; wait this long for it before the one request. */
const CREDENTIAL_WAIT_MS = 10_000
const CREDENTIAL_POLL_MS = 250

/** The part of `@deepseek-ai/dsh-agent-default-model` this plugin uses, read only when it is mounted. */
interface DefaultModel {
  currentSelection(): { provider: string; model: string }
  saveSelection(next: { provider: string; model: string }): Promise<void>
}
type RawProfile = { baseURL?: string; api?: string; models?: ModelEntry[]; [field: string]: unknown }

export { Config }
export const name = 'tpcowork-core-model'
export const inject = ['llm', 'credentials']

/** Register only this instance's routes and settings, with no changes to other provider instances. */
export function apply(ctx: Context, config: ModelConfig): void {
  const settingsNs = ctx.fiber.entry?.options.id ?? name
  ctx.inject(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  let previous: ReturnType<ModelConfig['providers']['get']> | undefined
  let previousKey: string | undefined
  let resolved: Map<string, ResolvedPiAiProviderProfile> | undefined
  /** Models each route's server reported on its last successful listing. */
  const served = new Map<string, ModelEntry[]>()
  let servedRevision = 0
  const defaultModel = () => ctx.get('agentDefaultModel' as never) as DefaultModel | undefined
  const raw = () => structuredClone(config.providers.get()) as unknown as Record<string, RawProfile>
  /** Configured routes with each listed route's models replaced by what its server serves. */
  const effective = (): Record<string, RawProfile> => {
    const providers = raw()
    let selection: { provider: string; model: string } | undefined
    try { selection = defaultModel()?.currentSelection() } catch { selection = undefined }
    for (const [provider, profile] of Object.entries(providers)) {
      const models = served.get(provider)
      if (models) profile.models = structuredClone(models)
      else if (selection?.provider === provider && profile.models?.[0] && !profile.models.some(model => model.id === selection.model)) {
        // Before this launch's first listing, keep the default saved by an earlier one usable.
        profile.models = [...profile.models, ...syncedModels(profile.models, [{ id: selection.model }])]
      }
    }
    return providers
  }
  const profiles = () => {
    const current = config.providers.get()
    let selection = ''
    try { const chosen = defaultModel()?.currentSelection(); selection = chosen ? `${chosen.provider}\0${chosen.model}` : '' } catch { /* unmounted */ }
    const key = `${String(servedRevision)}\0${selection}`
    if (resolved === undefined || current !== previous || key !== previousKey) {
      resolved = resolveProfiles(effective() as unknown as Options['providers'])
      previous = current
      previousKey = key
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
  const republish = () => {
    registration.replace([...profiles().keys()])
    directory.replace(entries())
  }
  ctx.on('loader/volatile-update', republish)

  /** Ask one route's server for its models and adopt them when it answered with at least one chat model. */
  const syncRoute = async (provider: string, profile: RawProfile, signal: AbortSignal): Promise<void> => {
    if (!profile.baseURL || !profile.models?.length) return
    const listing = chatModels(await discoverModels(
      { provider, baseURL: profile.baseURL, ...profile.api === undefined ? {} : { api: profile.api }, signal },
      () => ({ headers: profiles().get(provider)?.headers, resolveApiKey: () => resolveApiKey(provider) }),
    ))
    if (listing.length === 0) return
    const models = syncedModels(profile.models, listing)
    if (JSON.stringify(models) !== JSON.stringify(served.get(provider))) {
      served.set(provider, models)
      servedRevision++
      republish()
    }
    const defaults = defaultModel()
    const selection = defaults?.currentSelection()
    const ids = models.map(model => model.id)
    if (defaults && selection?.provider === provider && !ids.includes(selection.model)) {
      const next = replacementModel(ids, [selection.model, ...profile.models.map(model => model.id)])
      if (next !== undefined) await defaults.saveSelection({ provider, model: next })
    }
  }
  /** Resolve once the route's credential exists, so the launch's single request is not spent before it is seeded. */
  const credentialReady = async (provider: string, signal: AbortSignal): Promise<void> => {
    const deadline = Date.now() + CREDENTIAL_WAIT_MS
    for (;;) {
      try { await resolveApiKey(provider); return }
      catch (error) {
        if (!(error instanceof LlmError) || error.code !== 'MISSING_CREDENTIAL' || Date.now() >= deadline) return
      }
      await new Promise(resolve => setTimeout(resolve, CREDENTIAL_POLL_MS))
      signal.throwIfAborted()
    }
  }
  ctx.effect(() => {
    const lifetime = new AbortController()
    void (async () => {
      for (const [provider, profile] of Object.entries(raw())) {
        try {
          await credentialReady(provider, lifetime.signal)
          await syncRoute(provider, profile, AbortSignal.any([lifetime.signal, AbortSignal.timeout(SYNC_TIMEOUT_MS)]))
        } catch { /* unreachable or refused: keep the built-in list until the next launch */ }
      }
    })()
    return () => { lifetime.abort() }
  })
}
