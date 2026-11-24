import { z } from 'zod'

/** The upstream token stays in the desktop Host's memory. */
export interface GatewayMcpConnection {
  endpoint: string
  label: string
  upstreamToken: string
  expiresAt: number
}

const directConfig = z.object({ success: z.literal(true), data: z.object({
  name: z.enum(['juyuan_api', 'juyuan']),
  display_name: z.string().trim().min(1).max(120),
  endpoint: z.literal('https://api.gildata.com/mcp-servers/aidata-assistant-srv-api'),
  token: z.string().min(1).max(512),
  protocol_type: z.literal('streamableHttp'),
}) })

export async function loadGatewayMcp(baseURL: string, apiKey: string, expiresAt: number, signal: AbortSignal): Promise<GatewayMcpConnection | undefined> {
  const root = new URL(baseURL)
  if (!/\/v1\/?$/.test(root.pathname)) return
  root.pathname = root.pathname.replace(/\/v1\/?$/, '/')
  for (const name of ['juyuan_api', 'juyuan']) {
    const response = await fetch(new URL(`api/mcp/my-servers/${name}/direct-config`, root), {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal, redirect: 'error', cache: 'no-store',
    })
    if (response.status === 403 || response.status === 404) {
      await response.body?.cancel()
      continue
    }
    if (!response.ok) throw new Error('Gateway MCP configuration was unavailable')
    const { data } = directConfig.parse(await response.json())
    if (data.name !== name) throw new Error('Gateway MCP configuration did not match the requested service')
    return { endpoint: data.endpoint, label: data.display_name, upstreamToken: data.token, expiresAt }
  }
}
