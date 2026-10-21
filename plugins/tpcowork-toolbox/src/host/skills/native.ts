/** Native DSH tool adapters for Yealink control and the managed vision endpoint. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-working-directory'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
export interface NativeOptions {
  requestTimeoutMs: number; imageMaxBytes: number; visionMaxTokens: number
  callUsernameRef: string; callPasswordRef: string; visionKeyRef: string
}
async function secret(ctx: Context, ref: string): Promise<string | undefined> {
  try { return (await ctx.get('credentials')?.resolve(credentialRef(ref)))?.value }
  catch { throw new Error('凭证服务暂不可用，请检查 TP Cowork 凭证配置。') }
}
function endpoint(value: string | undefined): URL | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined
    return url
  } catch { return undefined }
}
/** Presence checks only: readiness never dials or sends user images to an external service. */
export async function nativeMissing(ctx: Context, name: string, config: NativeOptions): Promise<string[]> {
  if (name === 'call') {
    const missing: string[] = []
    if (!endpoint(process.env.DSH_YEALINK_URL)) missing.push('DSH_YEALINK_URL')
    if (!/^\d{4}$/.test(process.env.DSH_YEALINK_CALLER ?? '')) missing.push('DSH_YEALINK_CALLER')
    if (!/^[a-zA-Z0-9.:-]+$/.test(process.env.DSH_YEALINK_PBX ?? '')) missing.push('DSH_YEALINK_PBX')
    for (const ref of [config.callUsernameRef, config.callPasswordRef]) if (!await secret(ctx, ref)) missing.push(ref)
    return missing
  }
  if (name === 'image-extract') {
    const missing: string[] = []
    if (!endpoint(process.env.DSH_IMAGE_EXTRACT_URL)) missing.push('DSH_IMAGE_EXTRACT_URL')
    if (!process.env.DSH_IMAGE_EXTRACT_MODEL?.trim()) missing.push('DSH_IMAGE_EXTRACT_MODEL')
    if (!await secret(ctx, config.visionKeyRef)) missing.push(config.visionKeyRef)
    return missing
  }
  return []
}
async function boundedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > maxBytes) throw new Error('服务响应超出允许大小。')
      chunks.push(result.value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally { await reader.cancel(); reader.releaseLock() }
}
export async function sendCall(ctx: Context, args: { action: string; number?: string | undefined }, signal: AbortSignal, config: NativeOptions): Promise<string> {
  if ((await nativeMissing(ctx, 'call', config)).length) throw new Error('电话尚未配置；请补充部署设置和 TP Cowork 凭证引用。')
  if (!['dial','hangup'].includes(args.action) || (args.action === 'dial' && !/^\d{3,20}$/.test(args.number ?? ''))) throw new Error('拨号需要明确的数字号码。')
  const url = new URL('/cgi-bin/ConfigManApp.com', endpoint(process.env.DSH_YEALINK_URL)!)
  if (args.action === 'hangup') url.searchParams.set('key', 'CALLEND')
  else {
    const prefix = process.env.DSH_YEALINK_OUTGOING_PREFIX ?? ''
    if (!/^\d*$/.test(prefix)) throw new Error('电话拨出前缀配置无效。')
    const number = args.number!
    url.searchParams.set('number', number.length === 4 || number.startsWith(prefix) ? number : prefix + number)
    url.searchParams.set('outgoing_url', `${process.env.DSH_YEALINK_CALLER}@${process.env.DSH_YEALINK_PBX}`)
  }
  const user = await secret(ctx, config.callUsernameRef)
  const password = await secret(ctx, config.callPasswordRef)
  try {
    const response = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` }, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)]) })
    const body = await boundedBody(response, 2048)
    if (response.status !== 200 || /\b(?:error|failed|invalid|login)\b|<html/i.test(body)) throw new Error('rejected')
    return args.action === 'hangup' ? '已向话机发送挂断指令。' : '已向话机发送拨号指令；是否接通请以话机状态为准。'
  } catch { throw new Error(signal.aborted ? '电话操作已取消。' : '话机指令失败；请检查网络、TLS 证书和凭证。') }
}
export async function extractImage(ctx: Context, args: { image_path: string; prompt?: string | undefined }, signal: AbortSignal, config: NativeOptions, cwd?: string): Promise<string> {
  if ((await nativeMissing(ctx, 'image-extract', config)).length) throw new Error('图片提取尚未配置；请补充多模态服务和 TP Cowork 凭证引用。')
  const fs = ctx.get('fs')
  if (!fs) throw new Error('当前会话未提供文件读取能力。')
  const target = await fs.resolve(args.image_path, cwd === undefined ? {} : { cwd })
  const info = await fs.stat(target, signal)
  if (info?.type !== 'file') throw new Error('图片不是可读取的文件。')
  const bytes = await fs.readBytes(target, signal, config.imageMaxBytes)
  const prefix = Buffer.from(bytes.subarray(0, 12))
  const mime = prefix.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : prefix.subarray(0,3).equals(Buffer.from([255,216,255])) ? 'image/jpeg'
    : /^GIF8[79]a/.test(prefix.toString('ascii')) ? 'image/gif'
    : prefix.toString('ascii', 0, 4) === 'RIFF' && prefix.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : undefined
  if (!mime) throw new Error('仅支持有效的 PNG/JPEG/GIF/WebP 图片。')
  const key = await secret(ctx, config.visionKeyRef)
  try {
    const response = await fetch(endpoint(process.env.DSH_IMAGE_EXTRACT_URL)!, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)]),
      body: JSON.stringify({ model: process.env.DSH_IMAGE_EXTRACT_MODEL, stream: false, max_tokens: config.visionMaxTokens, temperature: 0.01,
        messages: [{ role: 'user', content: [{ type: 'text', text: args.prompt?.trim() || '提取图中的全部内容' }, { type: 'image_url', image_url: { url: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` } }] }],
      }),
    })
    if (!response.ok) throw new Error('rejected')
    const payload = z.object({ choices: z.array(z.object({ message: z.object({ content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }))]) }) })).min(1) }).parse(JSON.parse(await boundedBody(response, 1024 * 1024)))
    const content = payload.choices[0]!.message.content
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text ?? '').join('\n') : ''
    if (!text.trim()) throw new Error('empty')
    return text.trim()
  } catch { throw new Error(signal.aborted ? '图片提取已取消。' : '图片提取失败；请检查部署服务和凭证，或稍后重试。') }
}
/** Register only when another native adapter does not already own the same tool. */
export function applyNativeTools(ctx: Context, config: NativeOptions): void {
  if (!ctx.tools.get('call')) ctx.tools.register(defineTool({
    name: 'call', description: 'Send a dial or hangup command to the configured Yealink desk phone only on the user\'s explicit request. Delivery is not proof of connection.',
    parameters: { action: { type: 'string', enum: ['dial','hangup'], required: true }, number: { type: 'string', description: 'Explicit numeric phone number for dial.' } },
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    execute: (args, exec) => sendCall(ctx, args, exec.signal, config),
  }))
  if (!ctx.tools.get('extract_image')) ctx.tools.register(defineTool({
    name: 'extract_image', description: 'Extract text, tables and requested fields from a user-provided image through the configured managed multimodal service.',
    parameters: { image_path: { type: 'string', required: true }, prompt: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const working = ctx.get('workingDirectory')
      const cwd = exec.agent && working ? await working.ensure(exec.agent, exec.signal) : undefined
      return extractImage(ctx, args, exec.signal, config, cwd)
    },
  }))
}
