import { z } from 'zod'
import type { TpcoworkHubFile, TpcoworkHubSkill } from '../../contracts/tpcoworkhub.ts'
import { fingerprint, safeResource } from '../installer/files.ts'
import { TpcoworkHubError } from './errors.ts'
import { fileSchema } from './remote.ts'

const rawSkill = z.object({
  id: z.string().optional(), _id: z.string().optional(), slug: z.string().nullish(), name: z.string().nullish(), displayName: z.string().nullish(),
  description: z.string().nullish(), summary: z.string().nullish(), version: z.string().nullish(), latestVersionId: z.string().nullish(),
  tags: z.union([z.string(), z.array(z.string())]).nullish(), visibility: z.string().nullish(), approvalStatus: z.string().nullish(),
})
// Deployed Hubs serialize Java Long values as strings so browsers keep their precision.
export const remoteCount = z.union([z.number(), z.string().regex(/^\d{1,16}$/).transform(Number)]).pipe(z.number().int().nonnegative().safe())
// The Hub stores content_type as nullable and nothing here depends on it; path, size and sha256 stay mandatory.
const remoteFile = fileSchema.extend({ size: remoteCount, contentType: z.string().max(200).nullish().transform(value => value || 'application/octet-stream') })
export function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new TpcoworkHubError('protocol', { field: parsed.error.issues[0]?.path.join('.') || 'response' })
  return parsed.data
}
function skill(value: unknown): TpcoworkHubSkill {
  const raw = decode(rawSkill, value)
  const id = raw.id || raw._id
  if (!id || id.length > 200) throw new TpcoworkHubError('protocol')
  return { id, name: raw.slug || raw.name || raw.displayName || id, description: raw.description || raw.summary || '', versionId: raw.latestVersionId || '', version: raw.version || '',
    ...(raw.displayName ? { displayName: raw.displayName } : {}),
    ...(raw.tags != null ? { tags: [...new Set((Array.isArray(raw.tags) ? raw.tags : raw.tags.split(',')).map(tag => tag.trim()).filter(Boolean))] } : {}),
    ...(raw.visibility != null ? { visibility: raw.visibility } : {}), ...(raw.approvalStatus != null ? { approvalStatus: raw.approvalStatus } : {}),
  }
}
export function page(value: unknown) {
  const row = z.object({ skill: rawSkill, latestVersion: z.object({ version: z.string().nullish() }).nullish() })
  const raw = decode(z.object({ page: z.array(row).optional(), items: z.array(row).optional(), continueCursor: z.string().nullable().optional(), isDone: z.boolean().optional() }), value)
  if (!raw.page && !raw.items) throw new TpcoworkHubError('protocol')
  if (raw.isDone === false && !raw.continueCursor) throw new TpcoworkHubError('protocol')
  return { items: (raw.page ?? raw.items!).map(row => skill({ ...row.skill, version: row.latestVersion?.version ?? row.skill.version })), next: raw.isDone === true ? null : raw.continueCursor || null }
}
export function detail(value: unknown, id: string, maxBytes: number, maxFiles: number, allowUnversioned = false) {
  const raw = decode(z.object({ skill: rawSkill, latestVersion: z.object({ id: z.string().min(1).max(200), version: z.string() }).nullish(), files: z.array(remoteFile) }), value)
  const item = { ...skill(raw.skill), versionId: raw.latestVersion?.id ?? '', version: raw.latestVersion?.version ?? '' }
  if (item.id !== id) throw new TpcoworkHubError('protocol', { field: 'skill.id' })
  if (raw.latestVersion) validateMetadata(raw.files, maxBytes, maxFiles)
  else if (!allowUnversioned || raw.files.length) throw new TpcoworkHubError('invalid-package')
  return { skill: item, files: raw.files, fingerprint: fingerprint(raw.files.map(file => ({ ...file, bytes: new Uint8Array() }))) }
}
export function validateMetadata(files: TpcoworkHubFile[], maxBytes: number, maxFiles: number): void {
  try {
    if (!files.length || files.length > maxFiles || !files.some(file => file.path === 'SKILL.md')) throw new Error()
    let total = 0
    const seen = new Set<string>()
    for (const file of files) {
      const key = safeResource(file.path).normalize('NFC').toLowerCase()
      if (seen.has(key) || [...seen].some(other => key.startsWith(other + '/') || other.startsWith(key + '/'))) throw new Error()
      seen.add(key)
      total += file.size
      if (!Number.isSafeInteger(total) || total > maxBytes) throw new Error()
    }
  } catch { throw new TpcoworkHubError('invalid-package') }
}
const userIdSchema = z.union([z.string().min(1).max(200), z.number().int().nonnegative().safe().transform(String)])
export const websiteUserSchema = z.object({
  _id: userIdSchema.optional(), id: userIdSchema.optional(),
  username: z.string().min(1).max(200), name: z.string().max(200).nullish(),
}).refine(value => !!(value._id || value.id)).transform(value => ({
  id: (value._id || value.id)!, username: value.username, ...(value.name ? { name: value.name } : {}),
}))
const accessTokenSchema = z.string().min(1).max(32768).refine(value => value.trim().length > 0)
export const loginResultSchema = z.union([
  z.object({ accessToken: accessTokenSchema, tokenType: z.literal('Bearer').optional(), userInfo: websiteUserSchema })
    .transform(value => ({ token: value.accessToken, user: value.userInfo })),
  z.object({ token: accessTokenSchema, user: websiteUserSchema }),
])
export const fileContentSchema = remoteFile.extend({ content: z.string(), encoding: z.enum(['utf8', 'base64']).optional() })
