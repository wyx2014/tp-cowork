import { describe, expect, it } from 'vitest'
import { generatedMcpId, newPair, previewMcpImport, serverForm, serverValues } from '../src/ui/mcp-editor-form.ts'
import type { McpDefinition } from '../src/contracts/index.ts'

describe('MCP editor values', () => {
  it('keeps stored values and ownership when editing, and stores replacement values under a fresh reference', () => {
    const previous: McpDefinition = { id: 'docs', label: 'Docs', origin: 'bundled', enabled: false, transport: 'streamable-http', endpoint: 'https://example.com/mcp', credentials: [{ ref: 'SHARED_TOKEN', target: 'header', key: 'Authorization' }] }
    const form = serverForm(previous)
    expect(form.headers[0]?.value).toBe('')
    expect(serverValues(form, 'unused', previous).definition).toMatchObject(previous)
    expect(serverValues(form, 'unused', previous).secretValues).toBeUndefined()
    form.headers[0]!.value = 'replacement'
    const entry = serverValues(form, 'unused', previous)
    const ref = entry.definition.credentials[0]!.ref
    expect(ref).toMatch(/^TPCOWORK_MCP_[a-f0-9]{32}$/)
    expect(entry.secretValues).toEqual({ [ref]: 'replacement' })
    expect(JSON.stringify(entry.definition)).not.toContain('replacement')
    form.auth = 'none'
    expect(serverValues(form, 'unused', previous).definition.credentials).toEqual([])
  })
  it('preserves individual arguments, blank arguments and environment pairs and validates timeouts', () => {
    const form = { ...serverForm(), label: '本地服务', transport: 'stdio' as const, args: ['server.mjs', '', 'with spaces'], env: [newPair('API_KEY', 'value')] }
    const entry = serverValues(form, generatedMcpId(form.label, []))
    expect(entry.definition).toMatchObject({ id: 'mcp', args: ['server.mjs', '', 'with spaces'], connectTimeout: 15, toolTimeout: 30, credentials: [{ key: 'API_KEY', target: 'env' }] })
    expect(() => serverValues({ ...form, toolTimeout: '601' }, 'mcp')).toThrow()
    expect(() => serverValues({ ...form, connectTimeout: '1.2' }, 'mcp')).toThrow()
    expect(() => serverValues({ ...form, env: [...form.env, newPair('API_KEY', 'duplicate')] }, 'mcp')).toThrow()
  })
  it('normalizes bearer tokens and rejects missing values', () => {
    const form = { ...serverForm(), label: 'Docs', endpoint: 'https://example.com/mcp', auth: 'bearer' as const, token: 'Bearer private-token' }
    const entry = serverValues(form, 'docs')
    expect(Object.values(entry.secretValues!)).toEqual(['Bearer private-token'])
    expect(() => serverValues({ ...form, token: '' }, 'docs')).toThrow()
  })
  it('previews mixed local and remote configs, reports conflicts and isolates invalid rows without echoing values', () => {
    const rows = previewMcpImport(JSON.stringify({ mcpServers: {
      docs: { url: 'https://example.com/mcp', headers: { Authorization: 'private-token' } },
      local: { command: 'node', args: ['server.mjs'], env: { TOKEN: 'private-env' } },
      legacy: { transport: 'sse', url: 'https://example.com/sse' },
      invalid: { command: 'node', args: [true] },
    } }), [{ id: 'docs' }])
    expect(rows[0]).toMatchObject({ conflict: true, form: { auth: 'headers' } })
    expect(rows[1]).toMatchObject({ conflict: false, form: { transport: 'stdio', args: ['server.mjs'] } })
    expect(rows[2]?.error).toBe('mcpUnsupportedTransport')
    expect(rows[3]?.error).toBe('invalidMcpArgs')
    expect(() => previewMcpImport('{invalid', [])).toThrow('invalid-form')
    expect(() => previewMcpImport('{"mcpServers":{}}', [])).toThrow('invalid-form')
  })
})
