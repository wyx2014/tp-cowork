import { afterEach, expect, it, vi } from 'vitest'
import { Context, Service } from '../../../../deepseek-harness/vendor/cordis/src/index.ts'
import LlmRuntime from '../../../../deepseek-harness/packages/llm/llm/src/index.ts'
import { MemoryCredentials } from '../../../../deepseek-harness/packages/credentials/credentials/tests/memory.ts'
import * as CoreModel from '../src/model.ts'
import { chatModels, replacementModel, syncedModels } from '../src/model-sync.ts'
import { credentialReference, deploymentPatch, resolveDeployment } from '../deployment.js'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('picks the server\'s chat models and keeps configured capacities for ids it still serves', () => {
  const configured = [{ id: 'deepseek_v4_flash', name: 'deepseek_v4_flash', contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoningEfforts: false }]
  const listing = chatModels([{ id: 'bge-m3' }, { id: 'deepseek_v4_flash_api' }, { id: 'text-embedding-3' }, { id: 'deepseek_v4_flash' }, { id: 'deepseek_v4_flash' }])
  expect(listing.map(model => model.id)).toEqual(['deepseek_v4_flash_api', 'deepseek_v4_flash'])
  expect(syncedModels(configured, [...listing, { id: 'qwen3', contextWindow: 32000, maxTokens: 64000 }])).toEqual([
    { id: 'deepseek_v4_flash_api', name: 'deepseek_v4_flash_api', contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoningEfforts: false },
    configured[0],
    // A reported output cap larger than the window is not trusted; the build's cap is clamped to the window.
    { id: 'qwen3', name: 'qwen3', contextWindow: 32000, maxTokens: 8192, input: ['text'], reasoningEfforts: false },
  ])
})

it('moves a default the server no longer serves to its renamed model, else the server\'s first model', () => {
  expect(replacementModel(['deepseek_v4_flash_api', 'qwen3'], ['deepseek_v4_flash'])).toBe('deepseek_v4_flash_api')
  expect(replacementModel(['qwen3', 'deepseek_v4_pro'], ['deepseek_v4_flash', 'deepseek_v4_pro'])).toBe('deepseek_v4_pro')
  expect(replacementModel(['glm-5', 'qwen3'], ['deepseek_v4_flash'])).toBe('glm-5')
  expect(replacementModel([], ['deepseek_v4_flash'])).toBeUndefined()
})

/** A stand-in for @deepseek-ai/dsh-agent-default-model that records saved selections. */
class DefaultModel extends Service {
  saved: { provider: string; model: string }[] = []
  constructor(ctx: Context, private selection: { provider: string; model: string }) { super(ctx, 'agentDefaultModel' as never) }
  currentSelection() { return { ...this.selection } }
  async saveSelection(next: { provider: string; model: string }) { this.saved.push(next); this.selection = next }
}

async function mount(listing: () => Response, selection = { provider: 'asset-deepseek', model: 'deepseek_v4_flash' }) {
  const calls: { url: string; authorization: string | null }[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    calls.push({ url: request.url, authorization: request.headers.get('authorization') })
    return listing()
  })
  const deployment = resolveDeployment({ apiBase: 'http://gateway.test/v1', modelId: 'deepseek_v4_flash' }, {})
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime).await()
  await ctx.plugin(MemoryCredentials, { [credentialReference]: 'intranet-test-key' }).await()
  let defaults!: DefaultModel
  await ctx.plugin({ name: 'default-model', apply: (child: Context) => { defaults = new DefaultModel(child, selection) } }).await()
  await ctx.plugin(CoreModel, deploymentPatch(deployment)[0].insert[0].config).await()
  return { ctx, calls, defaults }
}

it('follows the server\'s model list at startup and moves the default off a model it renamed, with no rebuild', async () => {
  const { ctx, calls, defaults } = await mount(() => Response.json({ object: 'list', data: [{ id: 'deepseek_v4_flash_api' }, { id: 'bge-m3' }, { id: 'qwen3' }] }))
  await vi.waitFor(() => expect(defaults.saved).toEqual([{ provider: 'asset-deepseek', model: 'deepseek_v4_flash_api' }]))
  expect(calls[0]).toEqual({ url: 'http://gateway.test/v1/models', authorization: 'Bearer intranet-test-key' })
  expect((await ctx.llm.listModels('asset-deepseek')).map(model => model.id)).toEqual(['deepseek_v4_flash_api', 'qwen3'])
  expect(await ctx.llm.resolveModelInfo('asset-deepseek', 'deepseek_v4_flash_api')).toMatchObject({ context: { contextWindow: 128000 }, defaultMaxTokens: 8192 })
})

it('keeps the built-in model and the user\'s own default when the server is unreachable or serves it', async () => {
  const offline = await mount(() => { throw new TypeError('fetch failed') })
  await vi.waitFor(() => expect(offline.calls.length).toBeGreaterThan(0))
  expect((await offline.ctx.llm.listModels('asset-deepseek')).map(model => model.id)).toEqual(['deepseek_v4_flash'])
  expect(offline.defaults.saved).toEqual([])
  // Once per launch: a failed ask is not retried until the next start.
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(offline.calls).toHaveLength(1)

  const chosen = await mount(() => Response.json({ data: [{ id: 'deepseek_v4_flash' }, { id: 'qwen3' }] }), { provider: 'asset-deepseek', model: 'qwen3' })
  await vi.waitFor(async () => expect((await chosen.ctx.llm.listModels('asset-deepseek')).map(model => model.id)).toEqual(['deepseek_v4_flash', 'qwen3']))
  expect(chosen.defaults.saved).toEqual([])

  const custom = await mount(() => Response.json({ data: [{ id: 'qwen3' }] }), { provider: 'my-provider', model: 'gpt-x' })
  await vi.waitFor(async () => expect((await custom.ctx.llm.listModels('asset-deepseek')).map(model => model.id)).toEqual(['qwen3']))
  expect(custom.defaults.saved).toEqual([])
})

it('keeps a default saved by an earlier launch usable before this launch has asked the server', async () => {
  const { ctx } = await mount(() => new Response('', { status: 503 }), { provider: 'asset-deepseek', model: 'deepseek_v4_flash_api' })
  expect((await ctx.llm.listModels('asset-deepseek')).map(model => model.id)).toEqual(['deepseek_v4_flash', 'deepseek_v4_flash_api'])
})

it('asks the server once per launch, after the product credential has been seeded', async () => {
  const calls: (string | null)[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new Request(input, init).headers.get('authorization'))
    return Response.json({ data: [{ id: 'deepseek_v4_flash_api' }] })
  })
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime).await()
  await ctx.plugin(MemoryCredentials).await()
  await ctx.plugin(CoreModel, deploymentPatch(resolveDeployment({ apiBase: 'http://gateway.test/v1' }, {}))[0].insert[0].config).await()
  await new Promise(resolve => setTimeout(resolve, 600))
  expect(calls).toEqual([])
  await ctx.credentials.set(credentialReference, 'late-key')
  await vi.waitFor(() => expect(calls).toEqual(['Bearer late-key']))
  await new Promise(resolve => setTimeout(resolve, 600))
  expect(calls).toEqual(['Bearer late-key'])
})
