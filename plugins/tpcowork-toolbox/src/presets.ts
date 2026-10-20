/** Descriptors only: no auto-install, connection, secret or legacy config migration. */
export const defaultMcpPresets = [
  { id: 'juyuan', label: '聚源', transport: 'streamable-http', credentialRefs: ['JUYUAN_MCP_TOKEN'], endpointSetting: 'JUYUAN_MCP_URL' },
  { id: 'caihui_mcp', label: '财汇', transport: 'streamable-http', credentialRefs: ['CAIHUI_MCP_API_KEY'], endpointSetting: 'CAIHUI_MCP_URL' },
  { id: 'playwright', label: 'Playwright', transport: 'stdio', credentialRefs: [], command: '', args: [] },
] as const
