/** Host-only deployment settings; never publish these through skill resources or Remote APIs. */
import { readFile } from 'node:fs/promises'

export const imageExtractCredentialRef = 'DSH_IMAGE_EXTRACT_API_KEY'
export interface ImageExtractDeployment {
  apiUrl: string
  model: string
  apiKey?: string
}
const defaults = {
  apiUrl: 'http://192.168.0.228:1025/v1/chat/completions',
  model: 'qwen-vl',
}
const invalid = () => new Error('图片提取部署配置无效，请检查服务地址、模型和凭证。')

export function resolveImageExtractDeployment(input: unknown = {}, env: NodeJS.ProcessEnv = process.env): ImageExtractDeployment {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid()
  const values = input as Record<string, unknown>
  const apiUrl = env.DSH_IMAGE_EXTRACT_URL?.trim() || env.TPCOWORK_IMAGE_EXTRACT_API_URL?.trim() || values.apiUrl || defaults.apiUrl
  const model = env.DSH_IMAGE_EXTRACT_MODEL?.trim() || env.TPCOWORK_IMAGE_EXTRACT_MODEL?.trim() || values.model || defaults.model
  const apiKey = env.TPCOWORK_IMAGE_EXTRACT_API_KEY?.trim() || values.apiKey
  try {
    if (typeof apiUrl !== 'string' || typeof model !== 'string' || !model.trim()) throw invalid()
    const url = new URL(apiUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw invalid()
    if (apiKey !== undefined && (typeof apiKey !== 'string' || !/^[\x21-\x7e]+$/.test(apiKey))) throw invalid()
    return { apiUrl: url.href, model: model.trim(), ...(apiKey === undefined ? {} : { apiKey }) }
  } catch { throw invalid() }
}

/** Bundled chunks live beside this file in lib; builds supply the source directory explicitly. */
export async function loadImageExtractDeployment(directory = new URL('./', import.meta.url), env: NodeJS.ProcessEnv = process.env): Promise<ImageExtractDeployment> {
  let content: string
  try { content = await readFile(new URL('image-extract.local.json', directory), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取图片提取部署配置。')
    return resolveImageExtractDeployment({}, env)
  }
  let input: unknown
  try { input = JSON.parse(content) }
  catch { throw invalid() }
  return resolveImageExtractDeployment(input, env)
}

/** Seed once through DSH, preserving user/environment credentials and custom references. */
export async function initializeImageExtractCredential(
  credentials: { resolve(ref: string): Promise<unknown>; set(ref: string, value: string): Promise<unknown> },
  ref: string,
  deployment: ImageExtractDeployment,
): Promise<void> {
  if (ref !== imageExtractCredentialRef || deployment.apiKey === undefined || await credentials.resolve(ref)) return
  await credentials.set(ref, deployment.apiKey)
}
