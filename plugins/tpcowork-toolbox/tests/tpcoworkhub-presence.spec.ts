import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildClientHeaders,
  buildHeartbeatPayload,
  buildOfflinePayload,
  DEVICE_ID_FILENAME,
  DEVICE_ID_PATTERN,
  deviceIdFilePath,
  isValidDeviceId,
  loadOrCreateDeviceId,
  normalizeAppVersion,
  normalizeArch,
  normalizePlatform,
  readPackageVersion,
  resolveAppVersion,
} from '../src/host/tpcoworkhub/client-metadata.ts'
import {
  DEFAULT_HEARTBEAT_INTERVAL_SEC,
  nextHeartbeatDelayMs,
  parseHeartbeatIntervalSec,
  PresenceController,
  type PresenceSession,
} from '../src/host/tpcoworkhub/presence.ts'

const tempDirs: string[] = []

function makeTempDir(prefix = 'tpcoworkhub-meta-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  vi.useRealTimers()
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('tpcoworkhub client metadata', () => {
  it('normalizes platforms and architectures to SkillHub conventions', () => {
    expect(normalizePlatform('darwin')).toBe('macos')
    expect(normalizePlatform('macos')).toBe('macos')
    expect(normalizePlatform('win32')).toBe('windows')
    expect(normalizePlatform('windows')).toBe('windows')
    expect(normalizePlatform('linux')).toBe('linux')
    expect(normalizePlatform('freebsd')).toBe('unknown')
    expect(normalizePlatform('')).toBe('unknown')

    expect(normalizeArch('arm64')).toBe('arm64')
    expect(normalizeArch('aarch64')).toBe('arm64')
    expect(normalizeArch('x64')).toBe('x64')
    expect(normalizeArch('x86_64')).toBe('x64')
    expect(normalizeArch('AMD64')).toBe('x64')
    expect(normalizeArch('')).toBe('unknown')
  })

  it('normalizes appVersion by stripping optional leading v and enforcing limits', () => {
    expect(normalizeAppVersion('v0.2.2')).toBe('0.2.2')
    expect(normalizeAppVersion('V1.2.3-rc.1')).toBe('1.2.3-rc.1')
    expect(normalizeAppVersion('  0.2.0\r\n')).toBe('0.2.0')
    expect(normalizeAppVersion('')).toBeUndefined()
    expect(normalizeAppVersion('   ')).toBeUndefined()
    expect(normalizeAppVersion('v')).toBeUndefined()
    expect(normalizeAppVersion('V')).toBeUndefined()
    expect(normalizeAppVersion('v' + '1'.repeat(80))).toHaveLength(64)
  })

  it('resolves appVersion from real runtime/build/package sources by precedence without hardcoding', () => {
    expect(resolveAppVersion({
      env: {
        TPCOWORK_APP_VERSION: 'v9.0.0',
        DSH_DESKTOP_BUILD_VERSION: '8.0.0',
        DSH_CLIENT_VERSION: '7.0.0',
        DSH_APP_VERSION: '6.0.0',
      },
      buildVersion: '5.0.0',
      runtimeVersion: () => '4.0.0',
      packageVersion: '3.0.0',
    })).toBe('9.0.0')

    expect(resolveAppVersion({
      env: { DSH_DESKTOP_BUILD_VERSION: 'v0.2.1-rc.3.20261128.1.1', DSH_CLIENT_VERSION: '0.2.1-rc.3' },
      buildVersion: '0.2.1-rc.3',
      runtimeVersion: () => '0.2.1-rc.3',
      packageVersion: '0.2.0',
    })).toBe('0.2.1-rc.3.20261128.1.1')

    expect(resolveAppVersion({
      env: { DSH_CLIENT_VERSION: 'v0.2.1-rc.3', DSH_APP_VERSION: '0.2.1' },
      buildVersion: '',
      runtimeVersion: () => '0.2.1-rc.3',
      packageVersion: '0.2.0',
    })).toBe('0.2.1-rc.3')

    expect(resolveAppVersion({
      env: {},
      buildVersion: undefined,
      runtimeVersion: () => '0.2.1-rc.3',
      packageVersion: '0.2.0',
    })).toBe('0.2.1-rc.3')

    expect(resolveAppVersion({
      env: {},
      buildVersion: undefined,
      runtimeVersion: () => undefined,
      packageVersion: 'v0.2.0',
    })).toBe('0.2.0')

    // Real source resolution with empty env must still return the real toolbox/runtime version without a leading v.
    const realVersion = resolveAppVersion({ env: {}, buildVersion: undefined })
    expect(realVersion).toBeTruthy()
    expect(realVersion).not.toMatch(/^[vV]/)
    expect(readPackageVersion()).toBe('0.2.0')
  })

  it('persists a stable anonymous UUID deviceId, rejects legacy/corrupt values, and degrades gracefully on read-only paths', () => {
    const dir = makeTempDir()
    const filePath = deviceIdFilePath({ home: dir })
    expect(filePath).toBe(join(dir, DEVICE_ID_FILENAME))

    const first = loadOrCreateDeviceId(filePath)
    expect(first).toMatch(DEVICE_ID_PATTERN)
    expect(first.toLowerCase()).not.toBe('legacy')
    expect(isValidDeviceId(first)).toBe(true)
    expect(isValidDeviceId('legacy')).toBe(false)
    expect(isValidDeviceId('LEGACY')).toBe(false)
    expect(isValidDeviceId('bad id with spaces')).toBe(false)

    // Subsequent loads (simulating restart) must return the exact same UUID.
    expect(loadOrCreateDeviceId(filePath)).toBe(first)
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ deviceId: first })

    // Stored "legacy" or corrupt content must be replaced with a new valid UUID.
    writeFileSync(filePath, JSON.stringify({ deviceId: 'legacy' }))
    const replacedLegacy = loadOrCreateDeviceId(filePath)
    expect(replacedLegacy).toMatch(DEVICE_ID_PATTERN)
    expect(replacedLegacy.toLowerCase()).not.toBe('legacy')
    expect(loadOrCreateDeviceId(filePath)).toBe(replacedLegacy)

    writeFileSync(filePath, '{not-json')
    const replacedCorrupt = loadOrCreateDeviceId(filePath)
    expect(replacedCorrupt).toMatch(DEVICE_ID_PATTERN)
    expect(replacedCorrupt.toLowerCase()).not.toBe('legacy')

    // Generator returning "legacy" is rejected.
    const safePath = join(dir, 'nested', DEVICE_ID_FILENAME)
    const nonLegacy = loadOrCreateDeviceId(safePath, { generate: () => 'legacy' })
    expect(nonLegacy.toLowerCase()).not.toBe('legacy')
    expect(nonLegacy).toMatch(DEVICE_ID_PATTERN)

    // Unwritable file path warns and returns an ephemeral non-legacy UUID without throwing.
    const blockingFile = join(dir, 'not-a-directory')
    writeFileSync(blockingFile, 'occupied')
    const warn = vi.fn()
    const ephemeral = loadOrCreateDeviceId(join(blockingFile, DEVICE_ID_FILENAME), { warn })
    expect(ephemeral).toMatch(DEVICE_ID_PATTERN)
    expect(ephemeral.toLowerCase()).not.toBe('legacy')
    expect(warn).toHaveBeenCalledOnce()
  })

  it('formats User-Agent, X-Cowork-* headers, and heartbeat/offline payloads', () => {
    const metadata = {
      deviceId: '8f2a9c40-3e1d-4a5b-9f12-7c8d9e0f1a2b',
      appVersion: '0.2.2',
      platform: 'macos' as const,
      arch: 'arm64',
    }
    expect(buildClientHeaders(metadata)).toEqual({
      'User-Agent': 'TPCowork/0.2.2 (macos; arm64)',
      'X-Cowork-Version': '0.2.2',
      'X-Cowork-Platform': 'macos',
      'X-Cowork-Arch': 'arm64',
      'X-Cowork-Device-Id': '8f2a9c40-3e1d-4a5b-9f12-7c8d9e0f1a2b',
    })
    expect(buildHeartbeatPayload(metadata)).toEqual({
      deviceId: '8f2a9c40-3e1d-4a5b-9f12-7c8d9e0f1a2b',
      appVersion: '0.2.2',
      platform: 'macos',
      arch: 'arm64',
    })
    expect(buildOfflinePayload(metadata)).toEqual({
      deviceId: '8f2a9c40-3e1d-4a5b-9f12-7c8d9e0f1a2b',
    })
    expect(buildClientHeaders({ deviceId: 'dev-1', platform: 'linux', arch: 'x64' })).toEqual({
      'User-Agent': 'TPCowork (linux; x64)',
      'X-Cowork-Platform': 'linux',
      'X-Cowork-Arch': 'x64',
      'X-Cowork-Device-Id': 'dev-1',
    })
  })
})

describe('tpcoworkhub presence lifecycle', () => {
  it('computes jittered heartbeat intervals and clamps server-provided intervals', () => {
    expect(nextHeartbeatDelayMs(DEFAULT_HEARTBEAT_INTERVAL_SEC, () => 0)).toBe(55_000)
    expect(nextHeartbeatDelayMs(DEFAULT_HEARTBEAT_INTERVAL_SEC, () => 0.5)).toBe(60_000)
    expect(nextHeartbeatDelayMs(DEFAULT_HEARTBEAT_INTERVAL_SEC, () => 1)).toBe(65_000)
    expect(nextHeartbeatDelayMs(90, () => 0.5)).toBe(90_000)
    expect(nextHeartbeatDelayMs(1, () => 0.5)).toBe(10_000)
    expect(nextHeartbeatDelayMs(999, () => 0.5)).toBe(300_000)

    expect(parseHeartbeatIntervalSec({ nextIntervalSec: 45 })).toBe(45)
    expect(parseHeartbeatIntervalSec({ nextIntervalSec: 2 })).toBe(10)
    expect(parseHeartbeatIntervalSec({ nextIntervalSec: 900 })).toBe(300)
    expect(parseHeartbeatIntervalSec({ nextIntervalSec: '60' })).toBeUndefined()
    expect(parseHeartbeatIntervalSec(null)).toBeUndefined()
  })

  it('sends immediate and periodic heartbeats, handles account switch/logout/dispose, and silently tolerates errors', async () => {
    vi.useFakeTimers()
    const heartbeats: PresenceSession[] = []
    const offlines: PresenceSession[] = []
    const logs: Array<{ level: 'warn' | 'debug'; message: string }> = []
    let nextIntervalSec = 60
    let failHeartbeat = false
    let failOffline = false
    let expireAuth = false

    const controller = new PresenceController({
      sendHeartbeat: async session => {
        heartbeats.push(session)
        if (expireAuth) throw Object.assign(new Error('expired'), { code: 'tpcoworkhub/session-expired' })
        if (failHeartbeat) throw Object.assign(new Error('network down'), { code: 'tpcoworkhub/network' })
        return { serverTime: Date.now(), nextIntervalSec }
      },
      sendOffline: async session => {
        offlines.push(session)
        if (failOffline) throw new Error('offline timeout')
      },
      isAuthExpiredError: error => (error as { code?: string })?.code === 'tpcoworkhub/session-expired',
      random: () => 0.5,
      log: (level, message) => { logs.push({ level, message }) },
    })

    const user1: PresenceSession = { endpoint: 'https://hub.example.com', token: 'tok-1', userId: 'u1' }
    controller.sync(user1)
    // Idempotent sync with identical session must not duplicate immediate heartbeats.
    controller.sync({ ...user1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(heartbeats).toEqual([user1])

    // Next heartbeat uses server interval (60s with 0.5 random => 60_000ms).
    nextIntervalSec = 40
    await vi.advanceTimersByTimeAsync(60_000)
    expect(heartbeats).toHaveLength(2)

    // Subsequent heartbeat honors updated nextIntervalSec = 40s.
    await vi.advanceTimersByTimeAsync(40_000)
    expect(heartbeats).toHaveLength(3)

    // Transient heartbeat failures warn once, stay silent on UI, and keep scheduling.
    failHeartbeat = true
    await vi.advanceTimersByTimeAsync(40_000)
    expect(heartbeats).toHaveLength(4)
    expect(logs.at(-1)?.level).toBe('warn')
    await vi.advanceTimersByTimeAsync(40_000)
    expect(heartbeats).toHaveLength(5)
    expect(logs.at(-1)?.level).toBe('debug')
    failHeartbeat = false

    // Re-login as the SAME user + endpoint refreshes token without sending /offline.
    const user1Refreshed: PresenceSession = { endpoint: 'https://hub.example.com', token: 'tok-1b', userId: 'u1' }
    controller.sync(user1Refreshed)
    await vi.advanceTimersByTimeAsync(0)
    expect(offlines).toHaveLength(0)
    expect(heartbeats.at(-1)).toEqual(user1Refreshed)

    // Switching to another user sends /offline for previous user and immediately heartbeats for new user.
    const user2: PresenceSession = { endpoint: 'https://hub.example.com', token: 'tok-2', userId: 'u2' }
    controller.sync(user2)
    await vi.advanceTimersByTimeAsync(0)
    expect(offlines).toEqual([user1Refreshed])
    expect(heartbeats.at(-1)).toEqual(user2)

    // 401 expiration stops timers and sends no further heartbeats.
    expireAuth = true
    await vi.advanceTimersByTimeAsync(60_000)
    const countAfterExpiry = heartbeats.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(heartbeats).toHaveLength(countAfterExpiry)

    // Re-syncing and calling goOffline + dispose clears timers and tolerates offline errors.
    expireAuth = false
    failOffline = true
    controller.sync(user1)
    await vi.advanceTimersByTimeAsync(0)
    await expect(controller.goOffline()).resolves.toBeUndefined()
    expect(offlines.at(-1)).toEqual(user1)
    const countAfterOffline = heartbeats.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(heartbeats).toHaveLength(countAfterOffline)

    await expect(controller.dispose()).resolves.toBeUndefined()
    // After dispose, sync is ignored.
    controller.sync(user2)
    await vi.advanceTimersByTimeAsync(0)
    expect(heartbeats).toHaveLength(countAfterOffline)
  })
})
