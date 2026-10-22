/** Yealink setup: reuse the previous desktop's local directory, never package its contacts or secrets. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-app-boot'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { open, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { CallSetup, CallSetupRequest, SaveCallSetup } from '../../contracts/call.ts'
import { userSkillsDirectory } from './user-directory.ts'

type Refs = { callUsernameRef: string; callPasswordRef: string }
const savedSchema = z.object({ caller: z.string(), phoneUrl: z.string(), pbx: z.string(), outgoingPrefix: z.string(), sourceDirectory: z.string() }).strict()
type Saved = z.infer<typeof savedSchema>
const ownNumber = /^\d{4}$/
const pbxPattern = /^[a-zA-Z0-9.:-]+$/
const directoryName = '内部分机信息表.md'

export function phoneEndpoint(value: string): URL | undefined {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return undefined
    return url
  } catch { return undefined }
}
async function readLocal(path: string): Promise<string | undefined> {
  try {
    // Local setup files are small; do not load arbitrary large files through the editor.
    const file = await open(path, 'r')
    try {
      if ((await file.stat()).size > 2 * 1024 * 1024) throw new Error('电话配置文件过大。')
      return await file.readFile('utf8')
    } finally { await file.close() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error('无法读取电话配置，请检查所选目录。')
  }
}
function settingsPath(ctx: Context): string | undefined {
  const profile = ctx.get('profileContext')
  return profile && join(profile.dir, 'call-phone.json')
}
async function savedSettings(ctx: Context): Promise<Saved | undefined> {
  const path = settingsPath(ctx)
  const raw = path && await readLocal(path)
  if (!raw) return undefined
  try { return savedSchema.parse(JSON.parse(raw)) }
  catch { throw new Error('已保存的电话配置无法读取，请重新设置电话。') }
}
async function localSource(directory: string): Promise<Record<string, unknown>> {
  const raw = await readLocal(join(directory, 'config.json'))
  if (!raw) return {}
  try { return z.record(z.string(), z.unknown()).parse(JSON.parse(raw)) }
  catch { throw new Error('旧版电话配置格式无效，请检查 config.json。') }
}
const field = (data: Record<string, unknown>, key: string) => typeof data[key] === 'string' ? data[key] as string : ''

/** Exact extension lookup only; duplicates and placeholder IPs never choose an arbitrary phone. */
export function directoryPhone(table: string, caller: string): string | undefined {
  let header: string[] | undefined
  const matches: string[] = []
  for (const line of table.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(value => value.trim())
    if (!header) { header = cells; continue }
    if (cells.length !== header.length || cells[header.indexOf('分机短号')] !== caller) continue
    matches.push(cells[header.indexOf('终端IP')] ?? '')
  }
  if (matches.length !== 1) return undefined
  const host = matches[0]!
  if (!/^[a-zA-Z0-9.:[\]-]+$/.test(host) || /xxx|none|示例/i.test(host)) return undefined
  return phoneEndpoint(`https://${host}`)?.host
}
async function credential(ctx: Context, ref: string): Promise<string | undefined> {
  return (await ctx.get('credentials')?.resolve(credentialRef(ref)))?.value
}
function sourceDirectory(configured?: string): string {
  return resolve(configured?.trim() || process.env.TPCOWORK_CALL_DIRECTORY?.trim() || join(userSkillsDirectory(), 'call'))
}
function environment(): Saved | undefined {
  if (!process.env.DSH_YEALINK_CALLER) return undefined
  return { caller: process.env.DSH_YEALINK_CALLER.trim(), phoneUrl: process.env.DSH_YEALINK_URL?.trim() ?? '',
    pbx: process.env.DSH_YEALINK_PBX?.trim() ?? '', outgoingPrefix: process.env.DSH_YEALINK_OUTGOING_PREFIX ?? '', sourceDirectory: sourceDirectory() }
}
function issues(value: Pick<CallSetup, 'caller' | 'phoneUrl' | 'pbx' | 'outgoingPrefix' | 'usernameConfigured' | 'passwordConfigured'>): string[] {
  const result: string[] = []
  if (!ownNumber.test(value.caller)) result.push('请确认自己的四位办公分机号。')
  if (!phoneEndpoint(value.phoneUrl)) result.push('未匹配到唯一的话机地址，请补充话机地址或更新分机表。')
  if (!pbxPattern.test(value.pbx)) result.push('请填写电话服务器地址。')
  if (!/^\d*$/.test(value.outgoingPrefix)) result.push('外线前缀只能包含数字。')
  if (!value.usernameConfigured || !value.passwordConfigured) result.push('请首次填写话机登录账号和密码，或导入旧版电话配置。')
  return result
}
async function draft(ctx: Context, refs: Refs, request: CallSetupRequest) {
  const existing = await savedSettings(ctx) ?? environment()
  const directory = sourceDirectory(request.sourceDirectory ?? existing?.sourceDirectory)
  const saved = existing?.sourceDirectory === directory ? existing : undefined
  const source = await localSource(directory)
  const caller = (request.caller ?? saved?.caller ?? field(source, 'caller')).trim()
  const sameSaved = saved?.caller === caller && saved.sourceDirectory === directory
  const sameSource = field(source, 'caller').trim() === caller
  const scheme = field(source, 'scheme') || 'https'
  const tablePath = field(source, 'directory')
  const table = await readLocal(tablePath ? resolve(directory, tablePath) : join(directory, directoryName))
    ?? await readLocal(join(directory, '..', 't46u-dial', directoryName)) ?? ''
  const host = directoryPhone(table, caller)
  const sourceHost = sameSource ? field(source, 'phone_ip') : ''
  const phoneUrl = sameSaved ? saved.phoneUrl : (sourceHost || host) ? `${scheme}://${sourceHost || host}` : ''
  const storedUsername = await credential(ctx, refs.callUsernameRef)
  const storedPassword = await credential(ctx, refs.callPasswordRef)
  const sourceUsername = sameSource ? field(source, 'username').trim() : ''
  const sourcePassword = sameSource ? field(source, 'password') : ''
  // An explicit import for a different phone must use that phone's credentials.
  const username = sameSaved ? storedUsername || sourceUsername : sourceUsername || storedUsername
  const password = sameSaved ? storedPassword || sourcePassword : sourcePassword || storedPassword
  const value: CallSetup = {
    caller, phoneUrl, pbx: saved?.pbx || field(source, 'pbx_ip') || '12.100.10.9',
    outgoingPrefix: saved?.outgoingPrefix ?? (typeof source.outgoing_prefix === 'string' ? source.outgoing_prefix : '9'),
    sourceDirectory: directory, usernameConfigured: !!username, passwordConfigured: !!password,
    confirmed: !!sameSaved, issues: [],
  }
  value.issues = issues(value)
  return { value, username, password }
}
export async function getCallSetup(ctx: Context, refs: Refs, request: CallSetupRequest): Promise<CallSetup> {
  return (await draft(ctx, refs, request)).value
}
/** Called only by the explicit settings form. No phone/network request occurs during setup. */
export async function saveCallSetup(ctx: Context, refs: Refs, request: SaveCallSetup): Promise<CallSetup> {
  const path = settingsPath(ctx)
  if (!path) throw new Error('当前桌面配置不可写。')
  const candidate = await draft(ctx, refs, request)
  const username = request.username?.trim() || candidate.username
  const password = request.password || candidate.password
  const value: CallSetup = { ...candidate.value, caller: request.caller.trim(), phoneUrl: request.phoneUrl.trim() || candidate.value.phoneUrl, pbx: request.pbx.trim(),
    outgoingPrefix: request.outgoingPrefix.trim(), usernameConfigured: !!username, passwordConfigured: !!password }
  const missing = issues(value)
  if (missing.length) return { ...value, issues: missing, confirmed: false }
  const credentials = ctx.get('credentials')
  if (!credentials) throw new Error('凭证服务暂不可用，请稍后重试。')
  // Preserve existing credentials on ordinary confirmation; adopt explicit changes/imports.
  for (const [ref, supplied, fallback] of [[refs.callUsernameRef, request.username?.trim(), username], [refs.callPasswordRef, request.password, password]]) {
    const desired = supplied || fallback!
    if (await credential(ctx, ref!) !== desired) await credentials.set(credentialRef(ref!), desired)
  }
  const settings: Saved = { caller: value.caller, phoneUrl: phoneEndpoint(value.phoneUrl)!.origin, pbx: value.pbx,
    outgoingPrefix: value.outgoingPrefix, sourceDirectory: value.sourceDirectory }
  const temporary = `${path}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true })
  try { await writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
  return { ...value, ...settings, confirmed: true, issues: [] }
}
/** Execution reads only confirmed settings or an explicit deployment, never an unconfirmed suggestion. */
export async function activeCallSettings(ctx: Context, refs: Refs) {
  const settings = await savedSettings(ctx) ?? environment()
  const username = await credential(ctx, refs.callUsernameRef)
  const password = await credential(ctx, refs.callPasswordRef)
  const missing = !settings ? ['请在“设置电话”中确认自己的办公分机号。']
    : issues({ ...settings, usernameConfigured: !!username, passwordConfigured: !!password })
  return { settings, username, password, missing }
}
