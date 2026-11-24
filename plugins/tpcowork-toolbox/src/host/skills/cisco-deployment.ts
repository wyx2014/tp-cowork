/** Host-only Cisco office phone endpoints; never bundle into client code or commit secrets to Git. */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export interface CiscoDeployment {
  ciscoQueryUrl?: string
  ciscoDialUrl?: string
}
export interface CiscoEndpoints { query: URL; dial: URL }

const deploymentFile = 'cisco-call.local.json'
const invalid = () => new Error('Cisco 办公电话部署配置无效，请同时配置有效的查号和拨号服务地址。')

function privateIntranetHost(host: string): boolean {
  if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return true
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host)
  if (!octets) return false
  const parts = octets.slice(1).map(Number)
  if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 10 || (a === 172 && b !== undefined && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** Allow HTTPS or private intranet HTTP endpoints without embedded credentials or fragments. */
export function ciscoEndpointUrl(value: string | undefined): URL | undefined {
  try {
    const url = new URL(value?.trim() ?? '')
    if (url.username || url.password || url.hash) return undefined
    if (url.protocol === 'https:') return url
    if (url.protocol === 'http:' && privateIntranetHost(url.hostname)) return url
  } catch { /* A missing or invalid URL is reported as a deployment issue. */ }
  return undefined
}

export function resolveCiscoDeployment(input: unknown = {}, env: NodeJS.ProcessEnv = process.env): CiscoDeployment {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid()
  const values = input as Record<string, unknown>
  if (values.ciscoQueryUrl !== undefined && typeof values.ciscoQueryUrl !== 'string') throw invalid()
  if (values.ciscoDialUrl !== undefined && typeof values.ciscoDialUrl !== 'string') throw invalid()
  const rawQuery = env.TPCOWORK_CISCO_QUERY_URL?.trim() || (values.ciscoQueryUrl?.trim() ?? '')
  const rawDial = env.TPCOWORK_CISCO_DIAL_URL?.trim() || (values.ciscoDialUrl?.trim() ?? '')
  if (!rawQuery && !rawDial) return {}
  const query = ciscoEndpointUrl(rawQuery)
  const dial = ciscoEndpointUrl(rawDial)
  if (!query || !dial) throw invalid()
  return { ciscoQueryUrl: query.href, ciscoDialUrl: dial.href }
}

/** Bundled chunks live beside this file in lib; builds supply the source directory explicitly. */
export async function loadCiscoDeployment(directory = new URL('./', import.meta.url), env: NodeJS.ProcessEnv = process.env): Promise<CiscoDeployment> {
  let content: string
  try { content = await readFile(fileURLToPath(new URL(deploymentFile, directory)), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取 Cisco 办公电话部署配置。')
    return resolveCiscoDeployment({}, env)
  }
  let input: unknown
  try { input = JSON.parse(content) }
  catch { throw invalid() }
  return resolveCiscoDeployment(input, env)
}

let cachedBundled: CiscoDeployment | undefined

/** Read the build-time bundled endpoints next to the compiled Host bundle (`lib/cisco-call.local.json`). */
export function readBundledCiscoDeployment(directory?: URL): CiscoDeployment {
  if (directory === undefined && cachedBundled !== undefined) return cachedBundled
  let result: CiscoDeployment = {}
  try {
    const content = readFileSync(fileURLToPath(new URL(deploymentFile, directory ?? new URL('./', import.meta.url))), 'utf8')
    result = resolveCiscoDeployment(JSON.parse(content), {})
  } catch { /* Unconfigured or unreadable bundled file falls back to runtime config/env checks. */ }
  if (directory === undefined) cachedBundled = result
  return result
}
