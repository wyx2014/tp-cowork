import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

declare const __TPCOWORK_BUILD_VERSION__: string | undefined
declare const __TPCOWORK_PACKAGE_VERSION__: string | undefined

export const DEVICE_ID_FILENAME = 'tpcoworkhub-device.json'
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,128}$/
const MAX_APP_VERSION_LENGTH = 64
const MAX_ARCH_LENGTH = 32
const TOOLBOX_PACKAGE_NAME = '@tpcowork/dsh-toolbox'

export type ClientPlatform = 'macos' | 'windows' | 'linux' | 'unknown'

export interface ClientMetadata {
  readonly deviceId: string
  readonly appVersion?: string
  readonly platform: ClientPlatform
  readonly arch: string
}

/** Normalize an application version string by stripping optional leading `v`/`V` and enforcing length limits. */
export function normalizeAppVersion(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined
  const sanitized = raw.replace(/[\r\n]+/g, '').trim()
  if (!sanitized || /^[vV]+$/.test(sanitized)) return undefined
  const withoutPrefix = sanitized.replace(/^[vV]+\s*(?=\d)/, '').trim()
  if (!withoutPrefix) return undefined
  return withoutPrefix.slice(0, MAX_APP_VERSION_LENGTH)
}

/** Map Node/runtime platform identifiers to SkillHub's normalized platform names. */
export function normalizePlatform(raw: string = process.platform): ClientPlatform {
  const normalized = raw.replace(/[\r\n]+/g, '').trim().toLowerCase()
  if (normalized === 'darwin' || normalized === 'macos') return 'macos'
  if (normalized === 'win32' || normalized === 'windows') return 'windows'
  if (normalized === 'linux') return 'linux'
  return 'unknown'
}

/** Normalize CPU architecture identifiers to SkillHub conventions. */
export function normalizeArch(raw: string = process.arch): string {
  const normalized = raw.replace(/[\r\n]+/g, '').trim().toLowerCase()
  if (!normalized) return 'unknown'
  if (normalized === 'aarch64') return 'arm64'
  if (normalized === 'x86_64' || normalized === 'amd64') return 'x64'
  return normalized.slice(0, MAX_ARCH_LENGTH)
}

/** Validate a non-legacy SkillHub device identifier. */
export function isValidDeviceId(raw: unknown): raw is string {
  return typeof raw === 'string'
    && raw.trim() === raw
    && DEVICE_ID_PATTERN.test(raw)
    && raw.toLowerCase() !== 'legacy'
}

/** Read the nearest toolbox or package manifest version from disk without throwing. */
export function readPackageVersion(startDir: string = dirname(fileURLToPath(import.meta.url))): string | undefined {
  let current = startDir
  let fallback: string | undefined
  for (let depth = 0; depth < 6; depth++) {
    try {
      const parsed = JSON.parse(readFileSync(join(current, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
      if (typeof parsed?.version === 'string' && parsed.version.trim()) {
        if (parsed.name === TOOLBOX_PACKAGE_NAME) return parsed.version
        fallback ??= parsed.version
      }
    } catch {
      // Ignore missing or unreadable ancestor manifests.
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return fallback
}

/** Resolve the real client version from runtime environment, build metadata, runtime version, or package manifest. */
export function resolveAppVersion(options?: {
  env?: Readonly<Record<string, string | undefined>>
  buildVersion?: string | undefined
  runtimeVersion?: () => string | undefined
  packageVersion?: string | undefined
}): string | undefined {
  const env = options?.env ?? process.env
  const buildVersion = options && 'buildVersion' in options
    ? options.buildVersion
    : (typeof __TPCOWORK_BUILD_VERSION__ === 'string' ? __TPCOWORK_BUILD_VERSION__ : undefined)
  const runtimeVersion = options?.runtimeVersion ?? (() => {
    try { return getDshRuntimeVersion() }
    catch { return undefined }
  })
  const packageVersion = options && 'packageVersion' in options
    ? options.packageVersion
    : (readPackageVersion() ?? (typeof __TPCOWORK_PACKAGE_VERSION__ === 'string' ? __TPCOWORK_PACKAGE_VERSION__ : undefined))

  const candidates = [
    env.TPCOWORK_APP_VERSION,
    env.DSH_DESKTOP_BUILD_VERSION,
    buildVersion,
    env.DSH_CLIENT_VERSION,
    env.DSH_APP_VERSION,
    runtimeVersion(),
    packageVersion,
  ]
  for (const candidate of candidates) {
    const normalized = normalizeAppVersion(candidate)
    if (normalized !== undefined) return normalized
  }
  return undefined
}

/** Resolve the persistent device-id JSON file path inside the user's application data directory. */
export function deviceIdFilePath(
  profile?: { readonly home?: string; readonly dir?: string },
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const base = profile?.home?.trim() || profile?.dir?.trim() || env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(base, DEVICE_ID_FILENAME)
}

function readStoredDeviceId(filePath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { deviceId?: unknown }
    if (typeof parsed?.deviceId !== 'string') return undefined
    const trimmed = parsed.deviceId.trim()
    return isValidDeviceId(trimmed) ? trimmed : undefined
  } catch {
    return undefined
  }
}

/** Load the persisted anonymous device UUID, or generate and atomically persist a new one (never `legacy`). */
export function loadOrCreateDeviceId(
  filePath: string,
  options: { generate?: () => string; warn?: (message: string) => void } = {},
): string {
  const existing = readStoredDeviceId(filePath)
  if (existing !== undefined) return existing

  const rawCandidate = options.generate?.()
  const trimmedCandidate = typeof rawCandidate === 'string' ? rawCandidate.trim() : ''
  const generated = isValidDeviceId(trimmedCandidate) ? trimmedCandidate : randomUUID()
  const content = JSON.stringify({ deviceId: generated }, null, 2) + '\n'

  try {
    mkdirSync(dirname(filePath), { recursive: true })
    try {
      writeFileSync(filePath, content, { flag: 'wx', mode: 0o600 })
      return generated
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw error
      const raced = readStoredDeviceId(filePath)
      if (raced !== undefined) return raced
      const tempPath = `${filePath}.${randomUUID()}.tmp`
      try {
        writeFileSync(tempPath, content, { flag: 'wx', mode: 0o600 })
        renameSync(tempPath, filePath)
      } finally {
        try { rmSync(tempPath, { force: true }) } catch { /* Best-effort temporary file cleanup. */ }
      }
      return generated
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    options.warn?.(`Failed to persist TP Cowork Hub device ID (${detail}); using an ephemeral device ID.`)
    return generated
  }
}

/** Build the standard metadata headers sent on all SkillHub API requests. */
export function buildClientHeaders(metadata: ClientMetadata): Record<string, string> {
  return {
    'User-Agent': metadata.appVersion
      ? `TPCowork/${metadata.appVersion} (${metadata.platform}; ${metadata.arch})`
      : `TPCowork (${metadata.platform}; ${metadata.arch})`,
    ...(metadata.appVersion !== undefined ? { 'X-Cowork-Version': metadata.appVersion } : {}),
    'X-Cowork-Platform': metadata.platform,
    'X-Cowork-Arch': metadata.arch,
    'X-Cowork-Device-Id': metadata.deviceId,
  }
}

/** Build the JSON request body for `POST /tpcoworkapi/client/heartbeat`. */
export function buildHeartbeatPayload(metadata: ClientMetadata): {
  deviceId: string
  appVersion?: string
  platform: ClientPlatform
  arch: string
} {
  return {
    deviceId: metadata.deviceId,
    ...(metadata.appVersion !== undefined ? { appVersion: metadata.appVersion } : {}),
    platform: metadata.platform,
    arch: metadata.arch,
  }
}

/** Build the JSON request body for `POST /tpcoworkapi/client/offline`. */
export function buildOfflinePayload(metadata: Pick<ClientMetadata, 'deviceId'>): { deviceId: string } {
  return { deviceId: metadata.deviceId }
}
