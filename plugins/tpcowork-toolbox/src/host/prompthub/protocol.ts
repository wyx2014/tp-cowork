import { z } from 'zod'
import type { PromptHubFile, PromptHubSkill } from '../../contracts/prompthub.ts'
import { fingerprint, safeResource } from '../installer/files.ts'
import { PromptHubError } from './errors.ts'
import { fileSchema } from './remote.ts'

const rawSkill = z.object({
  id: z.string().optional(), _id: z.string().optional(), slug: z.string().optional(), name: z.string().optional(), displayName: z.string().optional(),
  description: z.string().optional(), summary: z.string().optional(), version: z.string().optional(), latestVersionId: z.string().optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(), visibility: z.string().optional(), approvalStatus: z.string().optional(),
})
export function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new PromptHubError('protocol')
  return parsed.data
}
function skill(value: unknown): PromptHubSkill {
  const raw = decode(rawSkill, value)
  const id = raw.id || raw._id
  if (!id || id.length > 200) throw new PromptHubError('protocol')
  return { id, name: raw.slug || raw.name || raw.displayName || id, description: raw.description || raw.summary || '', versionId: raw.latestVersionId || '', version: raw.version || '',
    ...(raw.displayName ? { displayName: raw.displayName } : {}),
    ...(raw.tags !== undefined ? { tags: [...new Set((Array.isArray(raw.tags) ? raw.tags : raw.tags.split(',')).map(tag => tag.trim()).filter(Boolean))] } : {}),
    ...(raw.visibility !== undefined ? { visibility: raw.visibility } : {}), ...(raw.approvalStatus !== undefined ? { approvalStatus: raw.approvalStatus } : {}),
  }
}
export function page(value: unknown) {
  const raw = decode(z.object({ page: z.array(z.object({ skill: rawSkill })).optional(), items: z.array(z.object({ skill: rawSkill })).optional(), continueCursor: z.string().nullable().optional(), isDone: z.boolean().optional() }), value)
  if (!raw.page && !raw.items) throw new PromptHubError('protocol')
  if (raw.isDone === false && !raw.continueCursor) throw new PromptHubError('protocol')
  return { items: (raw.page ?? raw.items!).map(row => skill(row.skill)), next: raw.isDone === true ? null : raw.continueCursor || null }
}
export function detail(value: unknown, id: string, maxBytes: number, maxFiles: number, allowUnversioned = false) {
  const raw = decode(z.object({ skill: rawSkill, latestVersion: z.object({ id: z.string().min(1).max(200), version: z.string() }).nullish(), files: z.array(fileSchema) }), value)
  const item = { ...skill(raw.skill), versionId: raw.latestVersion?.id ?? '', version: raw.latestVersion?.version ?? '' }
  if (item.id !== id) throw new PromptHubError('protocol')
  if (raw.latestVersion) validateMetadata(raw.files, maxBytes, maxFiles)
  else if (!allowUnversioned || raw.files.length) throw new PromptHubError('invalid-package')
  return { skill: item, files: raw.files, fingerprint: fingerprint(raw.files.map(file => ({ ...file, bytes: new Uint8Array() }))) }
}
export function validateMetadata(files: PromptHubFile[], maxBytes: number, maxFiles: number): void {
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
  } catch { throw new PromptHubError('invalid-package') }
}
export const loginResultSchema = z.object({ token: z.string().min(1).max(32768), user: z.object({ id: z.string(), username: z.string() }) })
export const websiteUserSchema = z.object({
  _id: z.string().min(1).max(200).optional(), id: z.string().min(1).max(200).optional(),
  username: z.string().min(1).max(200), name: z.string().max(200).optional(),
}).refine(value => !!(value._id || value.id)).transform(value => ({
  id: (value._id || value.id)!, username: value.username, ...(value.name ? { name: value.name } : {}),
}))
export const fileContentSchema = fileSchema.extend({ content: z.string(), encoding: z.enum(['utf8', 'base64']).optional() })
