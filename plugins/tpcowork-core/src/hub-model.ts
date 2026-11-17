/** Host-only model configuration; neither the renderer nor profile settings receive a usable API key. */
import { Context, Service } from '@deepseek-ai/cordis'
import { PiAiAdapter, type ResolvedPiAiProviderProfile, type Options } from '@deepseek-ai/dsh-llm-pi-ai'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { resolveProfiles } from '../../../../deepseek-harness/packages/llm/llm-pi-ai/src/config.ts'
import { authContextFrom, credentialStoreFrom } from '../../../../deepseek-harness/packages/llm/llm-pi-ai/src/auth.ts'
import type {} from './gateway-contract.ts'

export const name = 'tpcowork-hub-model'
export const inject = ['llm', 'credentials']
export const providerId = 'tpcowork-newapi'

interface DefaultModel {
  currentSelection(): { provider: string; model: string }
  saveSelection(next: { provider: string; model: string }): Promise<void>
}

export class GatewayModels extends Service {
  private profiles = new Map<string, ResolvedPiAiProviderProfile>()
  private key = ''
  private expiresAt = 0
  private registration?: ReturnType<Context['llm']['registerAdapter']>
  private readonly adapter: PiAiAdapter
  private preferred = ''
  private modelIds: string[] = []
  status = 'signed_out'

  constructor(ctx: Context) {
    super(ctx, 'tpcoworkGateway')
    this.adapter = new PiAiAdapter({
      profiles: () => this.profiles,
      resolveApiKey: async (provider, snapshot) => {
        // An operation prepared for a previous account must never acquire the next account's key.
        if (!this.key || Date.now() >= this.expiresAt || this.profiles.get(provider) !== snapshot) throw new LlmError('Sign in to load your model configuration', 'MISSING_CREDENTIAL')
        return this.key
      },
      auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
    })
    ctx.effect(() => () => this.clear())
    // UI routing is not an authorization boundary: even a manually configured provider requires a live Hub grant.
    ctx.on('llm/stream', (_options, next) => {
      if (this.key && Date.now() >= this.expiresAt) this.clear('expired')
      if (!this.key || this.status !== 'active') throw new LlmError('Sign in to TP Cowork before using models', 'MISSING_CREDENTIAL')
      return next()
    })
    ctx.inject(['agentDefaultModel' as never], child => {
      void this.selectDefault().catch(() => child.logger.warn('Cannot select the personal default model.'))
    })
  }

  clear(status = 'signed_out'): void {
    this.status = status
    this.key = ''
    this.expiresAt = 0
    this.preferred = ''
    this.modelIds = []
    this.profiles = new Map()
    this.registration?.replace([])
  }

  async configure(value: unknown, expiresAt = Infinity): Promise<void> {
    this.clear()
    if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) throw new Error('Expired model configuration')
    if (!value || typeof value !== 'object') throw new Error('Invalid model configuration')
    const config = value as Record<string, unknown>
    if (config.quotaStatus !== 'active') {
      if (!['not_configured', 'not_assigned', 'exhausted', 'disabled', 'expired', 'no_models'].includes(String(config.quotaStatus))) throw new Error('Invalid model configuration')
      this.status = config.quotaStatus as string
      return
    }
    if (typeof config.apiKey !== 'string' || !/^sk-[A-Za-z0-9_-]{20,256}$/u.test(config.apiKey)
      || typeof config.baseURL !== 'string' || !Array.isArray(config.models) || !config.models.length || config.models.length > 1000) throw new Error('Invalid model configuration')
    const url = new URL(config.baseURL)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid model configuration')
    const octets = url.hostname.split('.').map(Number)
    const privateAddress = octets.length === 4 && octets.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
      && (octets[0] === 10 || octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31 || octets[0] === 192 && octets[1] === 168)
    if (url.protocol === 'http:' && !privateAddress && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Model gateway requires HTTPS')
    const models = config.models.map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid model configuration')
      const model = item as Record<string, unknown>
      if (typeof model.id !== 'string' || !model.id.trim() || model.id.length > 256) throw new Error('Invalid model configuration')
      return { id: model.id, name: typeof model.name === 'string' ? model.name : model.id, input: ['text'], reasoningEfforts: false }
    })
    const profiles = resolveProfiles({ [providerId]: {
      displayName: 'SkillHub', api: 'openai-completions', baseURL: config.baseURL,
      // Force explicit credential resolution; a signed-out route never falls through to ambient credentials.
      apiKeyEnv: 'TPCOWORK_NEWAPI_KEY', models,
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' },
    } } as Options['providers'])
    this.key = config.apiKey
    this.expiresAt = expiresAt
    this.profiles = profiles
    if (this.registration) this.registration.replace([providerId])
    else this.registration = this.ctx.llm.registerAdapter([providerId], this.adapter)
    this.status = 'active'
    this.preferred = models.some(model => model.id === config.defaultModel) ? config.defaultModel as string : models[0]!.id
    this.modelIds = models.map(model => model.id)
    await this.selectDefault()
  }

  private async selectDefault(): Promise<void> {
    if (!this.preferred) return
    const defaults = this.ctx.get('agentDefaultModel' as never) as DefaultModel | undefined
    const current = defaults?.currentSelection()
    if (defaults && (!current || ['asset-deepseek', 'deepseek-official'].includes(current.provider)
      || current.provider === providerId && !this.modelIds.includes(current.model))) {
      await defaults.saveSelection({ provider: providerId, model: this.preferred })
    }
  }
}

export function apply(ctx: Context): void { new GatewayModels(ctx) }
