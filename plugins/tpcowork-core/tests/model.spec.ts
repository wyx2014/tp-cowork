import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '../../../../deepseek-harness/vendor/cordis/src/index.ts'
import { applyEntryPatches, entryListSchema } from '../../../../deepseek-harness/vendor/include/src/index.ts'
import LlmRuntime, { createToolResultMessage, createUserMessage } from '../../../../deepseek-harness/packages/llm/llm/src/index.ts'
import * as PiAi from '../../../../deepseek-harness/packages/llm/llm-pi-ai/src/index.ts'
import * as CoreModel from '../src/model.ts'
import { MemoryCredentials } from '../../../../deepseek-harness/packages/credentials/credentials/tests/memory.ts'
import { assemble } from '../../../../deepseek-harness/packages/llm/llm-pi-ai/tests/assemble.ts'
import { textEvents } from '../../../../deepseek-harness/packages/llm/llm-pi-ai/tests/mock-server.ts'
import { credentialReference, deploymentPatch, resolveDeployment } from '../deployment.js'

const requireHarness = createRequire(process.cwd() + '/package.json')
const { load } = requireHarness('js-yaml')
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllGlobals()
})

/** Exercise the actual HTTP serialization and SSE parser without opening a listening socket. */
function transport(responses: string[][]) {
  const requests: Record<string, unknown>[] = []
  const headers: Headers[] = []
  const paths: string[] = []
  const urls: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    urls.push(request.url)
    paths.push(new URL(request.url).pathname)
    headers.push(request.headers)
    requests.push(JSON.parse(await request.text()))
    const events = responses.shift()
    if (!events) throw new Error('Unexpected provider request')
    return new Response(events.map(event => `data: ${event}\n\n`).join(''), {
      headers: { 'content-type': 'text/event-stream' },
    })
  })
  return { requests, headers, paths, urls }
}

it('composes the shipped core model defaults over DSH and restores upstream selections when the bundle is removed', async () => {
  const base = load(await readFile(resolve('packages/bundle/base/cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
  const original = applyEntryPatches([], base, () => {})
  const manifest = JSON.parse(await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8'))
  const layers = await Promise.all(manifest.dsh.bundle.patch.map(async (file: string) =>
    load(await readFile(resolve(import.meta.dirname, '..', file), 'utf8'), { schema: entryListSchema })))
  const warnings: string[] = []
  const rows = applyEntryPatches(original, layers.flat(), message => warnings.push(message))
  expect(warnings).toEqual([])
  expect(rows.find(row => row.id === 'agent-default-model')?.config).toEqual({
    provider: 'asset-deepseek', model: 'deepseek_v4_flash',
  })
  for (const id of ['llm-pi-ai', 'llm-deepseek-account', 'deepseek-account']) {
    expect(rows.find(row => row.id === id)).toEqual(original.find(row => row.id === id))
  }
  // The upstream "DeepSeek" (official, API-key) route is disabled; only asset-deepseek ships.
  expect(original.find(row => row.id === 'llm-deepseek')?.disabled).toBeFalsy()
  expect(rows.find(row => row.id === 'llm-deepseek')?.disabled).toBe(true)
  expect(rows.find(row => row.id === 'tpcowork-core-model')?.name).toBe('@tpcowork/dsh-core/model')
  const restored = applyEntryPatches([], base, () => {})
  expect(restored).toEqual(original)
  expect(restored.find(row => row.id === 'agent-default-model')?.config).toMatchObject({ provider: 'deepseek-official' })
  const user = applyEntryPatches(rows, [
    { id: 'agent-default-model', config: { provider: 'user', model: 'chosen' } },
    { id: 'llm-pi-ai', config: { providers: { 'existing-deepseek': { baseURL: 'https://existing.test/v1' } } } },
  ], () => {})
  expect(user.find(row => row.id === 'agent-default-model')?.config).toEqual({ provider: 'user', model: 'chosen' })
  expect(user.find(row => row.id === 'tpcowork-core-model')).toEqual(rows.find(row => row.id === 'tpcowork-core-model'))
})

it('streams a tool call and its follow-up through the intranet Chat Completions route without reasoning fields', async () => {
  const toolEvents = [
    JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] }),
    JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: {
      name: 'read_document', arguments: '{"path":"report.txt"}',
    } }] }, index: 0, finish_reason: null }] }),
    JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
    '[DONE]',
  ]
  const server = transport([toolEvents, textEvents])
  const deployment = resolveDeployment({ apiBase: 'http://gateway.test/v1' }, {})
  const rows = deploymentPatch(deployment)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime).await()
  await ctx.plugin(MemoryCredentials, { [credentialReference]: 'intranet-test-key' }).await()
  await ctx.plugin(CoreModel, rows[0].insert[0].config).await()
  expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['asset-deepseek'])
  expect(await ctx.llm.listModels('asset-deepseek')).toMatchObject([{ id: 'deepseek_v4_flash' }])
  expect(await ctx.llm.resolveModelInfo('asset-deepseek', 'deepseek_v4_flash')).toMatchObject({
    context: { contextWindow: 128000 }, defaultMaxTokens: 8192,
  })
  const tools = [{ name: 'read_document', description: 'Read a document.', parameters: {
    type: 'object' as const, properties: { path: { type: 'string' as const } }, required: ['path'],
  } }]
  const user = createUserMessage({ content: [{ type: 'text', text: 'Read my report.' }] })
  const first = await assemble(ctx, { provider: deployment.providerId, model: deployment.modelId, messages: [user], tools })
  expect(first.message.content).toContainEqual({ type: 'tool-call', id: 'call_1', name: 'read_document', arguments: '{"path":"report.txt"}' })
  const result = await assemble(ctx, {
    provider: deployment.providerId, model: deployment.modelId, tools,
    messages: [user, first.message, createToolResultMessage({
      callId: 'call_1' as never, content: [{ type: 'text', text: 'Report data' }], isError: false,
    })],
  })
  expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
  expect(server.paths).toEqual(['/v1/chat/completions', '/v1/chat/completions'])
  expect(server.urls).toEqual(['http://gateway.test/v1/chat/completions', 'http://gateway.test/v1/chat/completions'])
  expect(server.headers.map(headers => headers.get('authorization'))).toEqual(['Bearer intranet-test-key', 'Bearer intranet-test-key'])
  for (const body of server.requests as Record<string, unknown>[]) {
    expect(body.model).toBe('deepseek_v4_flash')
    expect(body.max_tokens).toBe(8192)
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('max_completion_tokens')
    expect(body).not.toHaveProperty('store')
  }
})

it('reports a missing product credential before sending a request', async () => {
  const server = transport([])
  const deployment = resolveDeployment({ apiBase: 'http://gateway.test/v1' }, {})
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime).await()
  await ctx.plugin(MemoryCredentials).await()
  await ctx.plugin(CoreModel, deploymentPatch(deployment)[0].insert[0].config).await()
  await expect(assemble(ctx, { provider: deployment.providerId, model: deployment.modelId, messages: [] }))
    .resolves.toMatchObject({ finish: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } } })
  expect(server.paths).toEqual([])
})

it('keeps an existing DeepSeek source and credential working while core registers and removes its independent source', async () => {
  const server = transport([textEvents, textEvents])
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime).await()
  await ctx.plugin(MemoryCredentials, {
    EXISTING_DEEPSEEK_KEY: 'existing-key', [credentialReference]: 'intranet-key',
  }).await()
  await ctx.plugin(PiAi, { providers: { 'existing-deepseek': {
    api: 'openai-completions', baseURL: 'https://existing.test/v1', apiKeyEnv: 'EXISTING_DEEPSEEK_KEY',
    models: [{ id: 'deepseek-chat' }],
  } } }).await()
  const deployment = resolveDeployment({}, {})
  const core = await ctx.plugin(CoreModel, deploymentPatch(deployment)[0].insert[0].config).await()
  expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['existing-deepseek', 'asset-deepseek'])
  expect(ctx.llm.listConfigurableProviders().find(provider => provider.provider === 'asset-deepseek')?.settingsNs)
    .toBe('tpcowork-core-model')
  const request = { provider: 'existing-deepseek', model: 'deepseek-chat', messages: [] }
  expect((await assemble(ctx, request)).message.content).toEqual([{ type: 'text', text: 'hello' }])
  await core.dispose()
  expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['existing-deepseek'])
  expect((await assemble(ctx, request)).message.content).toEqual([{ type: 'text', text: 'hello' }])
  expect(server.headers.map(headers => headers.get('authorization'))).toEqual(['Bearer existing-key', 'Bearer existing-key'])
  expect(server.urls).toEqual(['https://existing.test/v1/chat/completions', 'https://existing.test/v1/chat/completions'])
})
