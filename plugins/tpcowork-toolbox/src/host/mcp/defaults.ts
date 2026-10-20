import type { McpDefinition } from '../../contracts/mcp.ts'

/** T7 supplies its verified, pinned local Playwright launcher. No download or global injection. */
export function defaultMcpDefinitions(options: {
  juyuanEndpoint?: string; caihuiEndpoint?: string
  playwright?: { command: string; args: string[]; cwd?: string }
} = {}): McpDefinition[] {
  return [
    { id: 'juyuan', label: '聚源', origin: 'bundled', enabled: true, transport: 'streamable-http', endpoint: options.juyuanEndpoint ?? 'https://api.gildata.com/mcp-servers/aidata-assistant-srv-api', credentials: [{ ref: 'JUYUAN_MCP_TOKEN', target: 'url-query', key: 'token' }] },
    { id: 'caihui_mcp', label: '财汇', origin: 'bundled', enabled: true, transport: 'streamable-http', endpoint: options.caihuiEndpoint ?? 'https://mcp.finchina.com/finchina-data-mcp-server/mcp', credentials: [{ ref: 'CAIHUI_MCP_API_KEY', target: 'header', key: 'x-api-key' }] },
    { id: 'playwright', label: 'Playwright', origin: 'bundled', enabled: true, transport: 'stdio', command: options.playwright?.command ?? '', args: options.playwright?.args ?? [], ...(options.playwright?.cwd ? { cwd: options.playwright.cwd } : {}), credentials: [] },
  ]
}
