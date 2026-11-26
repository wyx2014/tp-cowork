/** In-memory gateway configuration and the key for the current Hub grant. */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { PiAiAdapter, type ResolvedPiAiProviderProfile, type Options } from '@deepseek-ai/dsh-llm-pi-ai'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { resolveProfiles } from '../../../../deepseek-harness/packages/llm/llm-pi-ai/src/config.ts'
import { authContextFrom, credentialStoreFrom } from '../../../../deepseek-harness/packages/llm/llm-pi-ai/src/auth.ts'
import type { GatewayModelConnection } from './gateway-contract.ts'

export const name = 'tpcowork-hub-model'
export const inject = ['llm', 'credentials']
export const providerId = 'tpcowork-newapi'

interface DefaultModel {
  currentSelection(): { provider: string; model: string }
  saveSelection(next: { provider: string; model: string }): Promise<void>
}

export class GatewayModels extends Service {
  private profiles = new Map<string, ResolvedPiAiProviderProfile>()
  private profileSignature = ''
  private key = ''
  private grantId: string | undefined
  private expiresAt = 0
  private authExpiresAt = 0
  private loader: ((signal?: AbortSignal) => Promise<void>) | undefined
  private registration: ReturnType<Context['llm']['registerAdapter']> | undefined
  private readonly registerGatewayAdapter: () => ReturnType<Context['llm']['registerAdapter']>
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
        if (!this.key || Date.now() >= this.expiresAt || this.profiles.get(provider) !== snapshot) throw new LlmError('请先登录 TP Cowork 后再加载模型配置', 'MISSING_CREDENTIAL')
        return this.key
      },
      auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
    })
    // Cordis binds service effects to the caller. Own this adapter in the model plugin.
    this.registerGatewayAdapter = () => ctx.llm.registerAdapter([providerId], this.adapter)
    ctx.effect(() => () => {
      this.loader = undefined
      this.registration = undefined
      this.clear()
    })
    // UI routing is not an authorization boundary: even a manually configured provider requires a live Hub grant.
    ctx.on('llm/stream', (options, next) => {
      if (this.isStreamAllowed(options.provider)) return next()
      const loader = this.loader
      if (loader && ['loading', 'unavailable', 'signed_out'].includes(this.status)) {
        return (async function* (this: GatewayModels) {
          await loader(options.signal)
          this.assertStreamAllowed(options.provider)
          yield* next()
        }).call(this)
      }
      this.assertStreamAllowed(options.provider)
      return next()
    })
    ctx.inject(['agentDefaultModel' as never], child => {
      void this.selectDefault().catch(() => child.logger.warn('Cannot select the personal default model.'))
    })
  }

  setLoader(loader: ((signal?: AbortSignal) => Promise<void>) | undefined): void {
    this.loader = loader
  }

  private expireIfNeeded(): void {
    const now = Date.now()
    if ((this.key && now >= this.expiresAt) || (this.authExpiresAt > 0 && now >= this.authExpiresAt)) {
      this.clear('expired')
    }
  }

  private isStreamAllowed(provider: string): boolean {
    this.expireIfNeeded()
    if (provider === providerId) return !!this.key && this.status === 'active'
    return (!!this.key && this.status === 'active') || this.authExpiresAt > 0
  }

  private assertStreamAllowed(provider: string): void {
    if (this.isStreamAllowed(provider)) return
    if (provider === providerId) {
      if (this.status === 'exhausted') throw new LlmError('个人模型额度已用尽，请联系管理员充值或切换其他模型', 'MISSING_CREDENTIAL')
      if (['not_assigned', 'no_models', 'not_configured'].includes(this.status)) {
        throw new LlmError('当前账号暂未分配平台模型权限，请联系管理员或切换其他模型', 'MISSING_CREDENTIAL')
      }
      if (this.status === 'disabled') throw new LlmError('当前账号的模型权限已被停用，请联系管理员', 'MISSING_CREDENTIAL')
      if (this.status === 'unavailable') throw new LlmError('暂时无法获取平台模型配置，请检查网络连接后重试', 'MISSING_CREDENTIAL')
    } else {
      if (this.status === 'disabled') throw new LlmError('当前账号已被停用，请联系管理员', 'MISSING_CREDENTIAL')
      if (this.status === 'unavailable') throw new LlmError('暂时无法验证 TP Cowork 登录状态，请检查网络连接后重试', 'MISSING_CREDENTIAL')
    }
    if (this.status === 'expired') throw new LlmError('TP Cowork 登录已过期，请重新登录后再使用模型', 'MISSING_CREDENTIAL')
    throw new LlmError('请先登录 TP Cowork 后再使用模型', 'MISSING_CREDENTIAL')
  }

  modelConnection(): GatewayModelConnection | null {
    const grantId = this.grantId
    if (!grantId || this.status !== 'active' || Date.now() >= this.expiresAt) return null
    const profile = this.profiles.get(providerId)
    return profile?.baseURL && profile.api ? { baseURL: profile.baseURL, api: profile.api, grantId } : null
  }

  readModelKey(grantId: string): string | undefined {
    if (this.grantId === grantId && this.status === 'active' && Date.now() < this.expiresAt) return this.key
  }

  clear(status = 'signed_out'): void {
    this.status = status
    this.key = ''
    this.profileSignature = ''
    this.grantId = undefined
    this.expiresAt = 0
    this.authExpiresAt = 0
    this.preferred = ''
    this.modelIds = []
    this.profiles = new Map()
    this.registration?.replace([])
  }

  async configure(value: unknown, expiresAt = Infinity): Promise<void> {
    if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
      this.clear()
      throw new Error('Expired model configuration')
    }
    if (!value || typeof value !== 'object') {
      this.clear()
      throw new Error('Invalid model configuration')
    }
    const config = value as Record<string, unknown>
    if (config.quotaStatus !== 'active') {
      const quotaStatus = String(config.quotaStatus)
      if (!['not_configured', 'not_assigned', 'exhausted', 'disabled', 'expired', 'no_models'].includes(quotaStatus)) {
        this.clear()
        throw new Error('Invalid model configuration')
      }
      this.clear(quotaStatus)
      if (quotaStatus !== 'expired' && quotaStatus !== 'disabled') {
        this.authExpiresAt = expiresAt
      }
      return
    }
    if (typeof config.apiKey !== 'string' || !/^[\x21-\x7e]{1,2048}$/u.test(config.apiKey)
      || typeof config.baseURL !== 'string' || !Array.isArray(config.models) || !config.models.length || config.models.length > 1000) {
      this.clear()
      throw new Error('Invalid model configuration')
    }
    let url: URL
    try { url = new URL(config.baseURL) } catch { this.clear(); throw new Error('Invalid model configuration') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      this.clear()
      throw new Error('Invalid model configuration')
    }
    const octets = url.hostname.split('.').map(Number)
    const privateAddress = octets.length === 4 && octets.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
      && (octets[0] === 10 || octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31 || octets[0] === 192 && octets[1] === 168)
    const testFallback = typeof config.fallbackRevision === 'string' && url.origin === 'http://isptest.tpasset.com:54905'
      && url.pathname === '/tpcoworkapi/tpcoworkapi/model-fallback/v1'
    if (url.protocol === 'http:' && !privateAddress && !testFallback && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      this.clear()
      throw new Error('Model gateway requires HTTPS')
    }
    const models = config.models.map((item: unknown) => {
      if (!item || typeof item !== 'object') { this.clear(); throw new Error('Invalid model configuration') }
      const model = item as Record<string, unknown>
      if (typeof model.id !== 'string' || !model.id.trim() || model.id.length > 256) { this.clear(); throw new Error('Invalid model configuration') }
      return { id: model.id, name: typeof model.name === 'string' ? model.name : model.id, input: ['text'], reasoningEfforts: false }
    })
    const preferred = models.some(model => model.id === config.defaultModel) ? config.defaultModel as string : models[0]!.id
    const signature = JSON.stringify({ baseURL: config.baseURL, models, preferred })
    if (this.status === 'active' && this.key === config.apiKey && this.profileSignature === signature && this.profiles.has(providerId)) {
      this.expiresAt = expiresAt
      this.authExpiresAt = expiresAt
      return
    }
    const profiles = resolveProfiles({ [providerId]: {
      displayName: 'SkillHub', api: 'openai-completions', baseURL: config.baseURL,
      // Force explicit credential resolution; a signed-out route never falls through to ambient credentials.
      apiKeyEnv: 'TPCOWORK_NEWAPI_KEY', models,
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' },
    } } as Options['providers'])
    this.key = config.apiKey
    this.profileSignature = signature
    this.grantId = randomUUID()
    this.expiresAt = expiresAt
    this.authExpiresAt = expiresAt
    this.profiles = profiles
    if (this.registration) this.registration.replace([providerId])
    else this.registration = this.registerGatewayAdapter()
    this.status = 'active'
    this.preferred = preferred
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
