import { describe, expect, it, vi, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activeCallSettings, directoryPhone, getCallSetup, saveCallSetup } from '../src/host/skills/call-settings.ts'
import { nativeMissing, sendCall, type NativeOptions } from '../src/host/skills/native.ts'
import { skillsFixture } from './skills-fixture.ts'

const refs: NativeOptions = { callUsernameRef: 'CALL_USER', callPasswordRef: 'CALL_PASSWORD', requestTimeoutMs: 1000, imageMaxBytes: 1000, visionMaxTokens: 100, visionKeyRef: 'VISION_KEY' }
const table = '| 分机短号 | 显示名称 | 显示名称(英文) | 终端IP | 分机注册状态 |\n| --- | --- | --- | --- | --- |\n| 1234 | 测试甲 | Test A | 192.0.2.10 | 已注册 |\n| 5678 | 测试乙 | Test B | 192.0.2.20 | 已注册 |\n'
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'call-setup-'))
  const directory = join(root, 'call')
  await mkdir(directory)
  await writeFile(join(directory, '内部分机信息表.md'), table)
  const ctx = new Context()
  ctx.provide('profileContext', { dir: root } as never)
  const secrets = new Map<string, string>()
  const set = vi.fn(async (ref: string, value: string) => { secrets.set(ref, value) })
  ctx.provide('credentials', { resolve: async (ref: string) => secrets.has(ref) ? { value: secrets.get(ref), source: 'test' } : undefined, set } as never)
  vi.stubEnv('TPCOWORK_CALL_DIRECTORY', directory)
  vi.stubEnv('DSH_YEALINK_CALLER', '')
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'))
  onTestFinished(async () => { fetch.mockRestore(); vi.unstubAllEnvs(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  return { ctx, root, directory, secrets, set, fetch }
}
describe('local phone setup', () => {
  it('exposes setup through the real DSH Gateway and installs the updated skill resources', async () => {
    const local = await fixture()
    const { ctx, installer, dir } = await skillsFixture()
    ctx.provide('credentials', local.ctx.credentials)
    const invoke = (method: string, request: unknown) => ctx.typertGateway.invoke({ namespace: 'toolboxSkills', method, args: { request } })
    expect(await invoke('callSetup', { caller: '1234' })).toMatchObject({ phoneUrl: 'https://192.0.2.10', confirmed: false })
    const result = await invoke('saveCallSetup', { caller: '1234', phoneUrl: '', pbx: 'pbx.test', outgoingPrefix: '9', username: 'test-user', password: 'test-password' })
    expect(result).toMatchObject({ confirmed: true, issues: [] })
    expect(JSON.stringify(result)).not.toContain('test-password')
    expect(await readFile(join(dir, 'call-phone.json'), 'utf8')).toContain('1234')
    expect((await installer.install({ requestId: 'call-resource', source: { kind: 'bundled', resourceId: 'call' }, scope: { kind: 'user' }, conflict: 'reject' })).state).toBe('installed')
    expect((await ctx.skills.get('call'))?.content).toContain('设置电话')
    expect(local.fetch).not.toHaveBeenCalled()
  })
  it('does not guess an extension; previews exact matching without saving or networking', async () => {
    const { ctx, fetch, set } = await fixture()
    expect((await getCallSetup(ctx, refs, {})).caller).toBe('')
    const value = await getCallSetup(ctx, refs, { caller: '1234' })
    expect(value.phoneUrl).toBe('https://192.0.2.10')
    expect(value.confirmed).toBe(false)
    expect(value.issues.join('')).toContain('话机登录账号')
    expect((await nativeMissing(ctx, 'call', refs)).join('')).toContain('设置电话')
    expect(fetch).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })
  it('only imports same-caller legacy credentials after confirmation and keeps secrets out of UI/storage', async () => {
    const { ctx, directory, root, secrets, fetch } = await fixture()
    await writeFile(join(directory, 'config.json'), JSON.stringify({ caller: '1234', username: 'private-user', password: 'private-password', outgoing_prefix: '8', pbx_ip: 'pbx.test' }))
    const suggestion = await getCallSetup(ctx, refs, {})
    expect(suggestion).toMatchObject({ caller: '1234', phoneUrl: 'https://192.0.2.10', usernameConfigured: true, passwordConfigured: true, confirmed: false })
    expect(JSON.stringify(suggestion)).not.toContain('private-')
    expect(secrets.size).toBe(0)
    expect((await getCallSetup(ctx, refs, { caller: '5678' })).passwordConfigured).toBe(false)
    const saved = await saveCallSetup(ctx, refs, { caller: '1234', phoneUrl: '', pbx: 'pbx.test', outgoingPrefix: '8' })
    expect(saved.confirmed).toBe(true)
    expect(secrets.get(refs.callPasswordRef)).toBe('private-password')
    expect(await nativeMissing(ctx, 'call', refs)).toEqual([])
    const content = await readFile(join(root, 'call-phone.json'), 'utf8')
    expect(content).not.toMatch(/username|password|private-/)
    if (process.platform !== 'win32') expect((await stat(join(root, 'call-phone.json'))).mode & 0o777).toBe(0o600)
    // Persisted settings and DSH credentials suffice even after removing the old configuration.
    await rm(directory, { recursive: true })
    expect(await activeCallSettings(ctx, refs)).toMatchObject({ settings: { caller: '1234', phoneUrl: 'https://192.0.2.10' }, missing: [] })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('saves first-time credentials once and sends the confirmed phone/protocol through a mocked device', async () => {
    const { ctx, set, fetch } = await fixture()
    const request = { caller: '5678', phoneUrl: '', pbx: 'pbx.test', outgoingPrefix: '9', username: 'test-user', password: 'test-password' }
    expect((await saveCallSetup(ctx, refs, request)).confirmed).toBe(true)
    expect(set).toHaveBeenCalledTimes(2)
    await saveCallSetup(ctx, refs, { caller: '5678', phoneUrl: '', pbx: 'pbx.test', outgoingPrefix: '9' })
    expect(set).toHaveBeenCalledTimes(2)
    fetch.mockResolvedValue(new Response('OK'))
    await sendCall(ctx, { action: 'dial', number: '12345' }, new AbortController().signal, refs)
    const url = fetch.mock.calls[0]![0] as URL
    expect(url.origin).toBe('https://192.0.2.20')
    expect(url.searchParams.get('number')).toBe('912345')
    expect(url.searchParams.get('outgoing_url')).toBe('5678@pbx.test')
    fetch.mockResolvedValue(new Response('OK'))
    await sendCall(ctx, { action: 'hangup' }, new AbortController().signal, refs)
    expect((fetch.mock.calls[1]![0] as URL).search).toBe('?key=CALLEND')
  })
  it('does not use the previous phone when changing the caller, and rejects invalid configuration before writing', async () => {
    const { ctx, set, fetch } = await fixture()
    const request = { caller: '1234', phoneUrl: '', pbx: 'pbx.test', outgoingPrefix: '9', username: 'test-user', password: 'test-password' }
    await saveCallSetup(ctx, refs, request)
    expect((await getCallSetup(ctx, refs, { caller: '5678' })).phoneUrl).toBe('https://192.0.2.20')
    expect((await getCallSetup(ctx, refs, { caller: '9999' })).phoneUrl).toBe('')
    const rejected = await saveCallSetup(ctx, refs, { ...request, phoneUrl: 'https://user:secret@phone.test', password: 'changed' })
    expect(rejected.confirmed).toBe(false)
    expect(rejected.issues.join('')).toContain('话机地址')
    expect(set).toHaveBeenCalledTimes(2)
    expect((await activeCallSettings(ctx, refs)).settings?.caller).toBe('1234')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('imports the selected phone credentials when replacing a different saved phone', async () => {
    const { ctx, directory, secrets } = await fixture()
    await saveCallSetup(ctx, refs, { caller: '1234', phoneUrl: '', pbx: 'pbx.test', outgoingPrefix: '9', username: 'old-user', password: 'old-password' })
    await writeFile(join(directory, 'config.json'), JSON.stringify({ caller: '5678', username: 'new-user', password: 'new-password' }))
    const result = await saveCallSetup(ctx, refs, { caller: '5678', phoneUrl: '', pbx: 'pbx.test', outgoingPrefix: '9' })
    expect(result.confirmed).toBe(true)
    expect(secrets.get(refs.callUsernameRef)).toBe('new-user')
    expect(secrets.get(refs.callPasswordRef)).toBe('new-password')
  })
  it('rejects ambiguous, missing, placeholder and URL-injected directory entries', () => {
    expect(directoryPhone(table, '1234')).toBe('192.0.2.10')
    expect(directoryPhone(table + '| 1234 | 重复 | Duplicate | 192.0.2.99 | 已注册 |', '1234')).toBeUndefined()
    expect(directoryPhone(table, '0000')).toBeUndefined()
    for (const bad of ['xxx.xxx.1.1', 'none', 'good.test@evil.test', 'good.test/path', 'good.test?key=CALLEND']) {
      expect(directoryPhone(table.replace('192.0.2.10', bad), '1234')).toBeUndefined()
    }
  })
})
