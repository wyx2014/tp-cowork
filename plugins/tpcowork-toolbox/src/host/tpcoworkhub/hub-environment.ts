/**
 * Which TP Cowork Hub a build talks to. `hub-environments.json` lists one address per environment; the toolbox build
 * reads `TPCOWORK_HUB_ENV` and bakes the chosen address into the Host, so an installer always uses its own Hub and no
 * address is written into user profiles. Local runs (`npm run dev`) default to `local`, installers to `test`.
 */
import { allowedHubUrl } from './hub-url.ts'

export const HUB_ENVIRONMENTS = ['local', 'test', 'production'] as const
export type HubEnvironment = typeof HUB_ENVIRONMENTS[number]

function parseHubOrigin(value: unknown, environment: HubEnvironment, label = environment): string {
  if (typeof value !== 'string' || !value) throw new Error(`hub-environments.json has no Hub address for "${label}"; fill it in before building for this environment`)
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`hub-environments.json: "${label}" is not a URL: ${value}`) }
  if (url.search || url.hash || url.pathname !== '/' || !allowedHubUrl(url)) {
    throw new Error(`hub-environments.json: "${label}" must be an HTTPS address, or HTTP on this machine or a private intranet address, with no path: ${value}`)
  }
  return url.origin
}

/**
 * @param table - Contents of `hub-environments.json`.
 * @param name - Requested environment; an unset value selects `fallback`.
 * @returns The environment and its Hub address(es) without a trailing slash.
 */
export function resolveHubEnvironment(table: unknown, name: string | undefined, fallback: HubEnvironment = 'local'): { environment: HubEnvironment; endpoint: string; outsourceEndpoint?: string } {
  const environment = (name?.trim() || fallback) as HubEnvironment
  if (!HUB_ENVIRONMENTS.includes(environment)) throw new Error(`TPCOWORK_HUB_ENV must be ${HUB_ENVIRONMENTS.join(', ')}; got "${String(name)}"`)
  const entry = table && typeof table === 'object' ? (table as Record<string, unknown>)[environment] : undefined
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const record = entry as Record<string, unknown>
    const endpoint = parseHubOrigin(record.internal, environment, `${environment}.internal`)
    const outsource = record.outsource === undefined ? endpoint : parseHubOrigin(record.outsource, environment, `${environment}.outsource`)
    return { environment, endpoint, ...(outsource !== endpoint ? { outsourceEndpoint: outsource } : {}) }
  }
  return { environment, endpoint: parseHubOrigin(entry, environment) }
}
