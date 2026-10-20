import { z } from 'zod'
import type { McpDefinition } from '../../contracts/mcp.ts'

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)
const binding = z.object({ ref: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), target: z.enum(['header', 'env', 'url-query']), key: z.string().min(1).max(128) }).strict()
const base = { id: idSchema, label: z.string().min(1).max(120), origin: z.enum(['bundled', 'custom']), enabled: z.boolean(), credentials: z.array(binding).max(32), connectTimeout: z.number().int().min(1).max(300).optional(), toolTimeout: z.number().int().min(1).max(600).optional() }
export const definitionSchema = z.discriminatedUnion('transport', [
  z.object({ ...base, transport: z.literal('stdio'), command: z.string().max(4096), args: z.array(z.string().max(4096)).max(128), cwd: z.string().max(4096).optional() }).strict(),
  z.object({ ...base, transport: z.literal('streamable-http'), endpoint: z.string().max(4096) }).strict(),
])
export const editorEntrySchema = z.object({ definition: definitionSchema, secretValues: z.record(z.string(), z.string().min(1).max(16384)).optional() }).strict()
export const importRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative(), entries: z.array(editorEntrySchema.extend({ replace: z.boolean() })).min(1).max(100) }).strict()
export const draftProbeSchema = z.object({ ok: z.boolean(), toolCount: z.number().int().nonnegative() }).strict()
export function parseDefinition(value: unknown): McpDefinition {
  const parsed = definitionSchema.safeParse(value)
  if (!parsed.success) throw new Error('toolbox/mcp-invalid-definition: 请检查服务器标识、传输及凭证引用。')
  const row = parsed.data
  const targets = new Set<string>()
  for (const credential of row.credentials) {
    const allowed = row.transport === 'stdio' ? credential.target === 'env' : credential.target !== 'env'
    const validKey = credential.target === 'env' ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(credential.key) : /^[A-Za-z0-9_-]+$/.test(credential.key)
    const target = `${credential.target}:${credential.key.toLowerCase()}`
    if (!allowed || !validKey || targets.has(target)) throw new Error('toolbox/mcp-invalid-binding: 凭证目标无效或重复。')
    targets.add(target)
  }
  if (row.transport === 'streamable-http' && row.endpoint) {
    try {
      const url = new URL(row.endpoint)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error()
    } catch { throw new Error('toolbox/mcp-invalid-endpoint: 地址须为无凭证、无 query 的 HTTP(S) URL；凭证请使用引用。') }
  }
  // Env assignments and credential-shaped command-line arguments belong in DSH credentials.
  if (row.transport === 'stdio' && row.args.some(arg => /(?:^|[-_])(?:token|api[-_]?key|password|secret|authorization)(?:$|[=:\s])|^https?:\/\/.*[?@]/i.test(arg))) {
    throw new Error('toolbox/mcp-inline-credential: 启动参数中的凭证请改为环境变量引用。')
  }
  if (row.transport === 'stdio') {
    const { cwd, ...rest } = row
    return { ...rest, ...(cwd === undefined ? {} : { cwd }) }
  }
  return row
}
