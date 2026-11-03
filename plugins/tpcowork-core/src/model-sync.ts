/**
 * Keeps the built-in route's model list in step with what the intranet model server actually serves, so a renamed
 * or replaced model needs no rebuild. The server's `GET {baseURL}/models` reply is the list; the build's model
 * entry only supplies capacities the listing does not disclose, and stays the list while the server is unreachable.
 */
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'

/** One configured model entry, as the deployment patch writes it. */
export interface ModelEntry {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: readonly string[]
  [field: string]: unknown
}

/** Listing rows that are not chat models: gateways often serve embeddings and rerankers beside them. */
const NOT_CHAT = /embed|rerank|whisper|tts|bge|m3e/iu

/** The chat models of a listing, in server order, without duplicates. */
export function chatModels(listing: readonly LlmDiscoveredModel[]): LlmDiscoveredModel[] {
  const seen = new Set<string>()
  return listing.filter(model => {
    if (!model.id.trim() || NOT_CHAT.test(model.id) || seen.has(model.id)) return false
    seen.add(model.id)
    return true
  })
}

/**
 * The route's models after a successful listing: server ids, keeping a configured entry's metadata when its id is
 * still served, otherwise the listing's own capacities over the first configured entry's.
 */
export function syncedModels(configured: readonly ModelEntry[], listing: readonly LlmDiscoveredModel[]): ModelEntry[] {
  const template = configured[0] ?? { id: '' }
  return listing.map(model => {
    const known = configured.find(entry => entry.id === model.id)
    if (known) return structuredClone(known)
    const contextWindow = model.contextWindow ?? template.contextWindow
    const maxTokens = model.maxTokens !== undefined && (contextWindow === undefined || model.maxTokens <= contextWindow)
      ? model.maxTokens
      : template.maxTokens !== undefined && contextWindow !== undefined ? Math.min(template.maxTokens, contextWindow) : template.maxTokens
    const { id: _id, name: _name, contextWindow: _context, maxTokens: _max, input: _input, ...rest } = structuredClone(template)
    return {
      ...rest,
      id: model.id,
      name: model.name ?? model.id,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
      input: model.inputModalities ? [...model.inputModalities] : [...template.input ?? ['text']],
    }
  })
}

function commonPrefix(left: string, right: string): number {
  let length = 0
  while (length < left.length && length < right.length && left[length]!.toLowerCase() === right[length]!.toLowerCase()) length++
  return length
}

/**
 * The model a default that the server no longer serves moves to: the first still-served preference, else the
 * served id sharing the longest prefix with a preference (`deepseek_v4_flash` → `deepseek_v4_flash_api`), else the
 * server's first model.
 */
export function replacementModel(served: readonly string[], preferences: readonly string[]): string | undefined {
  for (const preference of preferences) if (served.includes(preference)) return preference
  let best: { id: string; length: number } | undefined
  for (const preference of preferences) {
    for (const id of served) {
      const length = commonPrefix(preference, id)
      if (length >= 4 && (best === undefined || length > best.length)) best = { id, length }
    }
  }
  return best?.id ?? served[0]
}
