/** Step search provider for DSH's existing web_search tool and citation cards. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { z as schema } from 'zod'

export const name = 'tpcowork-web-search-step'
export const inject = ['web', 'credentials']

export interface Config {
  endpoint: string
  apiKeyRef: string
  defaultMaxResults: number
}
export const Config: z<Config> = z.object({
  endpoint: z.string().default('https://api.stepfun.com/v1/search'),
  apiKeyRef: z.string().role('credential-ref').default('STEP_API_KEY'),
  defaultMaxResults: z.number().step(1).min(1).max(20).default(10),
})

const responseSchema = schema.object({
  results: schema.array(schema.object({
    url: schema.url().refine(value => ['https:', 'http:'].includes(new URL(value).protocol)),
    title: schema.string().optional(),
    snippet: schema.string().optional(),
  })),
})

/** Resolves only the configured Step credential for every request, including after key rotation. */
class StepSearchProvider implements WebSearchProvider {
  readonly id = 'step'
  constructor(private readonly ctx: Context, private readonly config: Config) {}
  available(): boolean { return true }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    signal?.throwIfAborted()
    const key = await this.ctx.credentials.resolve(credentialRef(this.config.apiKeyRef))
    if (!key?.value.trim()) throw new WebError(
      `Step search requires the configured credential ${this.config.apiKeyRef}.`, 'WEB_MISSING_CREDENTIAL',
    )
    let response: Response
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST', redirect: 'error', ...(signal === undefined ? {} : { signal }),
        headers: { authorization: `Bearer ${key.value}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query: request.query, n: Math.min(20, request.maxResults ?? this.config.defaultMaxResults) }),
      })
    } catch (error) {
      if (signal?.aborted) throw new WebError('Step search was cancelled.', 'WEB_ABORTED', { cause: error })
      throw new WebError('Step search could not reach its configured endpoint.', 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new WebError(`Step search failed (HTTP ${response.status}). Check the Step credential and search quota.`, 'WEB_PROVIDER_ERROR')
    }
    let raw: unknown
    try { raw = await response.json() }
    catch (error) {
      if (signal?.aborted) throw new WebError('Step search was cancelled.', 'WEB_ABORTED', { cause: error })
      throw new WebError('Step search returned invalid JSON.', 'WEB_PROVIDER_ERROR', { cause: error })
    }
    const parsed = responseSchema.safeParse(raw)
    if (!parsed.success) throw new WebError('Step search returned invalid sources.', 'WEB_PROVIDER_ERROR')
    // Step's time is an index timestamp, not a publication date. Full page content stays out of search snippets.
    return { sources: parsed.data.results.map(({ url, title, snippet }) => ({
      url, ...(title === undefined ? {} : { title }), ...(snippet === undefined ? {} : { snippet }),
    })), truncated: false }
  }
}

/** Register the provider; select it explicitly with the native web.searchProvider setting. */
export function apply(ctx: Context, config: Config): void {
  const endpoint = new URL(config.endpoint)
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Step search endpoint must be an HTTP(S) URL without credentials, query or fragment.')
  }
  credentialRef(config.apiKeyRef)
  ctx.web.registerSearchProvider(new StepSearchProvider(ctx, config))
}
