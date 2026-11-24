const TEST_HUB_ORIGIN = 'http://isptest.tpasset.com:54905'
const PRODUCTION_HUB_ORIGINS = new Set(['https://isp.tpasset.com', 'https://api.isp.tpasset.com'])
const API_PREFIX = '/tpcoworkapi'

/** Whether `url` may serve as the TP Cowork Hub address (login page and API).
 * HTTPS is always accepted. Plain HTTP is accepted only on this machine (localhost) or a private intranet address
 * (10/8, 172.16/12, 192.168/16), plus the explicitly configured HTTP test deployment. */
export function allowedHubUrl(url: URL): boolean {
  if (url.username || url.password) return false
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  // This test deployment explicitly uses HTTP; keep its exception scoped to the exact origin and port.
  if (url.origin === TEST_HUB_ORIGIN) return true
  const host = url.hostname
  if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return true
  const octets = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/u.exec(host)
  if (!octets) return false
  const [a, b] = [Number(octets[1]), Number(octets[2])]
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}
/** The test and production gateways strip one leading API prefix before routing to SkillHub. */
export function hubApiUrl(input: string): string {
  const url = new URL(input)
  if (url.origin !== TEST_HUB_ORIGIN && !PRODUCTION_HUB_ORIGINS.has(url.origin)) return input
  if (!url.pathname.startsWith(`${API_PREFIX}/`)
    || url.pathname.startsWith(`${API_PREFIX}${API_PREFIX}/`)) return input
  url.pathname = API_PREFIX + url.pathname
  return url.href
}
