/** One-shot Host client for the Cisco proxy, which uses three POSTs per tool call. */
import { z } from 'zod'
import { SkillError } from '../installer/errors.ts'

export interface CiscoDeployment {
  ciscoQueryUrl?: string
  ciscoDialUrl?: string
}
export interface CiscoEndpoints { query: URL; dial: URL }
export interface CiscoContact { number?: string | undefined; name?: string | undefined }

const extension = /^1121\d{4}$/
const protocol = '2024-11-05'
const maxResponseBytes = 1024 * 1024
const rpcResult = z.object({
  jsonrpc: z.literal('2.0'), id: z.literal(3),
  result: z.object({ isError: z.boolean().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })) }),
})
const directoryResult = z.object({ data: z.array(z.object({ VC_IP_PHONE: z.union([z.string(), z.number()]).nullish() })).nullish() })
const resultCode = z.object({ code: z.number() })

function endpoint(value: string | undefined): URL | undefined {
  try {
    const url = new URL(value?.trim() ?? '')
    if (url.protocol === 'https:' && !url.username && !url.password && !url.hash) return url
  } catch { /* A missing or invalid URL is reported as a deployment issue. */ }
  return undefined
}

/** Resolve Host-only endpoints. Never send an account token to an HTTP URL or a redirect. */
export function ciscoEndpoints(config: CiscoDeployment): CiscoEndpoints | undefined {
  const query = endpoint(config.ciscoQueryUrl || process.env.TPCOWORK_CISCO_QUERY_URL)
  const dial = endpoint(config.ciscoDialUrl || process.env.TPCOWORK_CISCO_DIAL_URL)
  if (query && dial) return { query, dial }
  return undefined
}

function json(text: string): unknown {
  try {
    const result: unknown = JSON.parse(text)
    return result
  } catch { return undefined }
}

function sseResult(event: string): unknown {
  const data = event.split(/\r?\n/u)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).replace(/^ /u, '')).join('\n')
  const value = json(data)
  if (value && typeof value === 'object' && 'id' in value && value.id === 3) return value
  return undefined
}

/** Read one matching reply and cancel the stream, even if the server keeps the connection open. */
async function readReply(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return undefined
  const sse = response.headers.get('content-type')?.includes('text/event-stream')
  const decoder = new TextDecoder()
  let buffer = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        return sse ? sseResult(buffer) : json(buffer)
      }
      bytes += value.byteLength
      if (bytes > maxResponseBytes) return undefined
      buffer += decoder.decode(value, { stream: true })
      if (sse) {
        const events = buffer.split(/\r?\n\r?\n/u)
        buffer = events.pop() ?? ''
        for (const event of events) {
          const reply = sseResult(event)
          if (reply !== undefined) return reply
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function callMcp(url: URL, name: '用户查询' | '打电话', args: Record<string, string>, bearer: string, signal: AbortSignal): Promise<unknown> {
  const dialing = name === '打电话'
  let dialSent = false
  const post = async (message: object, session?: string): Promise<Response> => {
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal, body: JSON.stringify({ jsonrpc: '2.0', ...message }),
      headers: {
        Accept: 'application/json, text/event-stream', Authorization: bearer,
        'Content-Type': 'application/json', 'Mcp-Protocol-Version': protocol,
        ...(session ? { 'Mcp-Session-Id': session } : {}),
      },
    })
    if (response.ok) return response
    await response.body?.cancel()
    if (response.status === 401 || response.status === 403) throw new SkillError('skills/cisco-auth-rejected')
    throw new Error('Cisco MCP HTTP response rejected')
  }
  try {
    const initialized = await post({ id: 1, method: 'initialize', params: {
      protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'tp-cowork-office-phone', version: '1.0' },
    } })
    const session = initialized.headers.get('mcp-session-id')
    await initialized.body?.cancel()
    if (!session) throw new Error('Cisco MCP session missing')
    const notification = await post({ method: 'notifications/initialized' }, session)
    await notification.body?.cancel()
    signal.throwIfAborted()
    dialSent = dialing
    // This proxy also passes the Bearer value to the downstream tool in its arguments.
    const response = await post({ id: 3, method: 'tools/call', params: { name, arguments: { ...args, token: bearer } } }, session)
    const reply = rpcResult.parse(await readReply(response)).result
    if (reply.isError) throw new SkillError(dialing ? 'skills/cisco-dial-rejected' : 'skills/cisco-lookup-failed')
    const payload = json(reply.content.find(part => part.type === 'text')?.text ?? '')
    if (payload === undefined) throw new Error('Cisco MCP result is invalid')
    return payload
  } catch (error) {
    if (error instanceof SkillError) throw error
    if (dialSent) throw new SkillError('skills/cisco-dial-uncertain')
    signal.throwIfAborted()
    throw new SkillError(dialing ? 'skills/cisco-dial-rejected' : 'skills/cisco-lookup-failed')
  }
}

/** Send one explicit dial request using the current Host account grant. */
export async function dialCisco(endpoints: CiscoEndpoints, target: CiscoContact, token: string, signal: AbortSignal): Promise<string> {
  const number = target.number?.trim()
  const contact = number || target.name?.trim() || ''
  const bearer = `Bearer ${token}`
  let phone = contact
  if (!extension.test(contact)) {
    if (!contact || number || /^[+\d][\d()\s.-]*$/u.test(contact)) throw new SkillError('skills/cisco-invalid-extension')
    const raw = await callMcp(endpoints.query, '用户查询', contact.includes('@') ? { email: contact } : { name: contact }, bearer, signal)
    const code = resultCode.safeParse(raw)
    if (code.success && (code.data.code === 401 || code.data.code === 403)) throw new SkillError('skills/cisco-auth-rejected')
    if (code.success && code.data.code !== 200) throw new SkillError('skills/cisco-lookup-failed')
    const parsed = directoryResult.safeParse(raw)
    if (!parsed.success) throw new SkillError('skills/cisco-lookup-failed')
    const rows = parsed.data.data ?? []
    if (rows.length > 1) throw new SkillError('skills/cisco-contact-ambiguous')
    phone = String(rows[0]?.VC_IP_PHONE ?? '').replace(/\D/gu, '')
    if (!extension.test(phone)) throw new SkillError('skills/cisco-contact-not-found')
  }
  signal.throwIfAborted()
  const result = resultCode.safeParse(await callMcp(endpoints.dial, '打电话', { vc_ip_phone: phone }, bearer, signal))
  if (!result.success) throw new SkillError('skills/cisco-dial-uncertain')
  if (result.data.code === 401 || result.data.code === 403) throw new SkillError('skills/cisco-auth-rejected')
  if (result.data.code >= 500) throw new SkillError('skills/cisco-dial-uncertain')
  if (result.data.code !== 200) throw new SkillError('skills/cisco-dial-rejected')
  return `已向分机 ${phone} 发送 Cisco 拨号指令，请留意话机振铃。是否接通以话机状态为准。`
}
