/** Native DSH tool adapters for Yealink control and the managed vision endpoint. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-working-directory'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { loadImageExtractDeployment } from './image-extract-deployment.ts'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { activeCallSettings, directoryExtension, directoryTable, phoneEndpoint } from './call-settings.ts'
export interface NativeOptions {
  requestTimeoutMs: number; imageMaxBytes: number; visionMaxTokens: number
  callUsernameRef: string; callPasswordRef: string; visionKeyRef: string
}
async function secret(ctx: Context, ref: string): Promise<string | undefined> {
  try { return (await ctx.get('credentials')?.resolve(credentialRef(ref)))?.value }
  catch { throw new Error('凭证服务暂不可用，请检查 TP Cowork 凭证配置。') }
}
/** Presence checks only: readiness never dials or sends user images to an external service. */
export async function nativeMissing(ctx: Context, name: string, config: NativeOptions): Promise<string[]> {
  if (name === 'call') {
    return (await activeCallSettings(ctx, config)).missing
  }
  if (name === 'image-extract') {
    await loadImageExtractDeployment()
    const missing: string[] = []
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
/**
 * One request to the desk phone. Yealink phones serve HTTPS with their own self-signed certificate, so, as the previous
 * desktop did, the phone's certificate is not verified; the request goes straight to the phone on the LAN, never
 * through a proxy. Replaceable for tests.
 */
export const phoneTransport = {
  request(url: URL, authorization: string, signal: AbortSignal, maxBytes = 2048): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const options = { headers: { Authorization: authorization }, signal, agent: false as const }
      const done = (response: import('node:http').IncomingMessage) => {
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= maxBytes) chunks.push(chunk); else response.destroy() })
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
        response.on('close', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
        response.on('error', reject)
      }
      const request = url.protocol === 'https:' ? httpsRequest(url, { ...options, rejectUnauthorized: false }, done) : httpRequest(url, options, done)
      request.on('error', reject)
      request.end()
    })
  },
}
export async function sendCall(ctx: Context, args: { action: string; number?: string | undefined; name?: string | undefined }, signal: AbortSignal, config: NativeOptions): Promise<string> {
  const active = await activeCallSettings(ctx, config)
  if (active.missing.length || !active.settings) throw new Error('电话尚未配置；请打开工具箱 → 技能 → call → 设置电话，确认自己的办公分机号。')
  if (!['dial','hangup'].includes(args.action)) throw new Error('电话操作只能是拨号或挂断。')
  let number = args.number?.replace(/[\s()（）-]/g, '')
  if (args.action === 'dial' && !number && args.name?.trim()) {
    // A name is looked up in this machine's extension table; several or no matches are reported, never guessed.
    const found = directoryExtension(await directoryTable(active.settings.sourceDirectory), args.name)
    if ('error' in found) throw new Error(found.error)
    number = found.number
  }
  if (args.action === 'dial' && !/^\d{3,20}$/.test(number ?? '')) throw new Error('拨号需要明确的数字号码或通讯录中的姓名。')
  const url = new URL('/cgi-bin/ConfigManApp.com', phoneEndpoint(active.settings.phoneUrl)!)
  if (args.action === 'hangup') url.searchParams.set('key', 'CALLEND')
  else {
    const prefix = active.settings.outgoingPrefix
    if (!/^\d*$/.test(prefix)) throw new Error('电话拨出前缀配置无效。')
    url.searchParams.set('number', number!.length === 4 || number!.startsWith(prefix) ? number! : prefix + number!)
    url.searchParams.set('outgoing_url', `${active.settings.caller}@${active.settings.pbx}`)
  }
  const { username: user, password } = active
  let reply: { status: number; body: string }
  try {
    reply = await phoneTransport.request(url, `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`, AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)]))
  } catch {
    throw new Error(signal.aborted ? '电话操作已取消。' : `无法连接话机 ${url.host}；请确认电脑在内网，且话机地址正确。`)
  }
  if (reply.status === 401 || reply.status === 403) throw new Error('话机拒绝了登录；请在“设置电话”中重新填写话机登录账号和密码。')
  if (reply.status !== 200 || /\b(?:error|failed|invalid|login)\b|<html/i.test(reply.body)) throw new Error(`话机未接受指令（HTTP ${String(reply.status)}）；请检查话机登录账号和密码。`)
  if (args.action === 'hangup') return `已向主叫分机 ${active.settings.caller} 的话机发送挂断指令。`
  return `已向主叫分机 ${active.settings.caller} 的话机发送拨打 ${args.name?.trim() && !args.number ? `${args.name.trim()}（${number!}）` : number!} 的指令；是否接通请以话机状态为准。`
}
export async function extractImage(ctx: Context, args: { image_path: string; prompt?: string | undefined }, signal: AbortSignal, config: NativeOptions, cwd?: string): Promise<string> {
  if ((await nativeMissing(ctx, 'image-extract', config)).length) throw new Error('图片提取尚未配置；请补充多模态服务和 TP Cowork 凭证引用。')
  const deployment = await loadImageExtractDeployment()
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
    const response = await fetch(deployment.apiUrl, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)]),
      body: JSON.stringify({ model: deployment.model, stream: false, max_tokens: config.visionMaxTokens, temperature: 0.01,
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
    name: 'call', description: 'Send a dial or hangup command to the user\'s configured Yealink desk phone, only on the user\'s explicit request. Dial a number, or a colleague by name from the local extension table. Delivery is not proof of connection.',
    parameters: { action: { type: 'string', enum: ['dial','hangup'], required: true }, number: { type: 'string', description: 'Numeric phone number or extension the user gave, for dial.' },
      name: { type: 'string', description: 'Colleague name the user gave, for dial without a number; looked up in this machine\'s extension table.' } },
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
