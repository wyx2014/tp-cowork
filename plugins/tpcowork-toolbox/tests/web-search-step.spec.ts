import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, onTestFinished, vi } from 'vitest'
import { boot } from '@deepseek-ai/dsh-app-boot'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import Web from '@deepseek-ai/dsh-web'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as StepSearch from '../src/host/web-search-step/index.ts'

async function fixture() {
  const calls: { path: string; authorization?: string; body: unknown }[] = []
  let status = 200
  let body: unknown = { results: [{ url: 'https://example.com/report', title: '企业年报', snippet: '现金流信息', time: '2026-10-19T00:00:00', content: 'Full page excluded' }] }
  let hang = false
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    calls.push({ path: request.url!, authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') })
    if (hang) return
    response.writeHead(status, { 'content-type': 'application/json', ...(status === 307 ? { location: '/redirect-target' } : {}) })
    response.end(JSON.stringify(body))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing search fixture address')
  const endpoint = `http://127.0.0.1:${address.port}/search`
  const root = await mkdtemp(join(tmpdir(), 'toolbox-step-search-'))
  onTestFinished(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) })
  const config = join(root, 'cordis.yml')
  await writeFile(config, JSON.stringify([
    { name: 'cordis:credentials', config: { path: join(root, 'credentials.yaml') } },
    { name: 'cordis:prompt' }, { name: 'cordis:tools' },
    { name: 'cordis:web', config: { searchProvider: 'step' } },
    { name: 'cordis:stepSearch', config: { endpoint, apiKeyRef: 'TEST_STEP_SEARCH_KEY' } },
    { name: 'cordis:toolWeb', config: { fetch: false, searchMaxResults: 2 } },
  ]))
  const ctx = await boot('test', config, [], ctx => {
    Object.assign(ctx.loader.builtins, { credentials: Credentials, prompt: SystemPrompt, tools: Tools, web: Web, stepSearch: StepSearch, toolWeb: ToolWeb })
  })
  onTestFinished(() => ctx.fiber.dispose())
  const deepseek = vi.fn(async () => ({ sources: [], truncated: false }))
  ctx.web.registerSearchProvider({ id: 'deepseek-official', available: () => true, search: deepseek })
  await ctx.credentials.set(credentialRef('TEST_DEEPSEEK_SEARCH_KEY'), 'different-deepseek-key')
  const key = (value: string) => ctx.credentials.set(credentialRef('TEST_STEP_SEARCH_KEY'), value)
  return { ctx, calls, deepseek, key, respond(code: number, value: unknown) { status = code; body = value }, hang() { hang = true } }
}

it('native web_search uses the Step credential, preserves citation cards and reads rotated keys', async () => {
  const h = await fixture()
  await h.key('step-search-key')
  const result = await h.ctx.tools.execute({ name: 'web_search', callId: ToolCallId('step-search'),
    arguments: { queries: ['企业年报'] }, signal: new AbortController().signal })
  expect(h.calls).toEqual([{ path: '/search', authorization: 'Bearer step-search-key', body: { query: '企业年报', n: 2 } }])
  expect(result).toMatchSnapshot()
  expect(JSON.stringify(result)).not.toContain('Full page excluded')
  expect(JSON.stringify(result)).not.toContain('2026-10-19T00:00:00')
  await h.key('rotated-step-key')
  await h.ctx.web.search({ query: 'second query', maxResults: 99 })
  expect(h.calls[1]).toMatchObject({ authorization: 'Bearer rotated-step-key', body: { n: 20 } })
  expect(h.deepseek).not.toHaveBeenCalled()
})

it('missing Step credentials fail before network access without falling back to DeepSeek', async () => {
  const h = await fixture()
  await expect(h.ctx.web.search({ query: 'report' })).rejects.toMatchObject({ code: 'WEB_MISSING_CREDENTIAL' })
  expect(h.calls).toEqual([])
  expect(h.deepseek).not.toHaveBeenCalled()
})

it('credentialed search rejects redirects without contacting the redirect target', async () => {
  const h = await fixture(); await h.key('step-search-key'); h.respond(307, {})
  await expect(h.ctx.web.search({ query: 'report' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  expect(h.calls.map(call => call.path)).toEqual(['/search'])
  expect(h.deepseek).not.toHaveBeenCalled()
})

it('HTTP and invalid response failures remain visible without another provider request', async () => {
  const h = await fixture(); await h.key('step-search-key'); h.respond(429, { error: 'upstream detail' })
  await expect(h.ctx.web.search({ query: 'report' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('HTTP 429') })
  h.respond(200, { results: [{ url: 'javascript:bad' }] })
  await expect(h.ctx.web.search({ query: 'report' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'Step search returned invalid sources.' })
  expect(h.deepseek).not.toHaveBeenCalled()
})

it('cancellation aborts the active HTTP request', async () => {
  const h = await fixture(); await h.key('step-search-key'); h.hang()
  const controller = new AbortController()
  const pending = h.ctx.web.search({ query: 'report' }, controller.signal)
  const rejection = expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  await vi.waitFor(() => expect(h.calls).toHaveLength(1))
  controller.abort(); await rejection
  expect(h.deepseek).not.toHaveBeenCalled()
})

it('unloading the provider removes its native registration', async () => {
  const h = await fixture(); await h.key('step-search-key')
  await h.ctx.web.search({ query: 'report' })
  const fiber = [...h.ctx.registry.get(StepSearch)!.fibers][0]
  expect(fiber).toBeDefined()
  await fiber!.dispose()
  await expect(h.ctx.web.search({ query: 'report' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  expect(h.calls).toHaveLength(1)
  expect(h.deepseek).not.toHaveBeenCalled()
})
