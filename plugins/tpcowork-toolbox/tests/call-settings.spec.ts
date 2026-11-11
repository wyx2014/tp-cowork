import { describe, expect, it, vi, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activeCallSettings, directoryPhone, getCallSetup, saveCallSetup } from '../src/host/skills/call-settings.ts'
import { nativeMissing, phoneTransport, sendCall, type NativeOptions } from '../src/host/skills/native.ts'
import { skillsFixture } from './skills-fixture.ts'
import { ownerPeer } from '../../../../deepseek-harness/packages/api/gateway/tests/peer.ts'

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
  const phone = vi.spyOn(phoneTransport, 'request').mockRejectedValue(new Error('Unexpected network request'))
  onTestFinished(async () => { phone.mockRestore(); vi.unstubAllEnvs(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  return { ctx, root, directory, secrets, set, phone }
}
describe('local phone setup', () => {
  it('exposes setup through the real DSH Gateway and installs the updated skill resources', async () => {
    const local = await fixture()
    const { ctx, installer, dir } = await skillsFixture()
    ctx.provide('credentials', local.ctx.credentials)
    const invoke = (method: string, request: unknown) => ctx.typertGateway.invoke({ peer: ownerPeer(ctx),  namespace: 'toolboxSkills', method, args: { request } })
    expect(await invoke('callSetup', { caller: '1234' })).toMatchObject({ phoneUrl: 'https://192.0.2.10', confirmed: false })
    const result = await invoke('saveCallSetup', { caller: '1234', phoneUrl: '', pbx: 'pbx.test', outgoingPrefix: '9', username: 'test-user', password: 'test-password' })
    expect(result).toMatchObject({ confirmed: true, issues: [] })
    expect(JSON.stringify(result)).not.toContain('test-password')
    expect(await readFile(join(dir, 'call-phone.json'), 'utf8')).toContain('1234')
    expect((await installer.install({ requestId: 'call-resource', source: { kind: 'bundled', resourceId: 'call' }, scope: { kind: 'user' }, conflict: 'reject' })).state).toBe('installed')
    expect((await ctx.skills.get('call'))?.content).toContain('设置电话')
    expect(local.phone).not.toHaveBeenCalled()
  })
  it('does not guess an extension; previews exact matching without saving or networking', async () => {
    const { ctx, phone, set } = await fixture()
    expect((await getCallSetup(ctx, refs, {})).caller).toBe('')
    const value = await getCallSetup(ctx, refs, { caller: '1234' })
    expect(value.phoneUrl).toBe('https://192.0.2.10')
    expect(value.confirmed).toBe(false)
    expect(value.issues.join('')).toContain('话机登录账号')
    expect((await nativeMissing(ctx, 'call', refs)).join('')).toContain('设置电话')
    expect(phone).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })
  it('only imports same-caller legacy credentials after confirmation and keeps secrets out of UI/storage', async () => {
    const { ctx, directory, root, secrets, phone } = await fixture()
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
    expect(phone).not.toHaveBeenCalled()
  })
  it('saves first-time credentials once and sends the confirmed phone/protocol through a mocked device', async () => {
    const { ctx, set, phone } = await fixture()
    const request = { caller: '5678', phoneUrl: '', pbx: 'pbx.test', outgoingPrefix: '9', username: 'test-user', password: 'test-password' }
    expect((await saveCallSetup(ctx, refs, request)).confirmed).toBe(true)
    expect(set).toHaveBeenCalledTimes(2)
    await saveCallSetup(ctx, refs, { caller: '5678', phoneUrl: '', pbx: 'pbx.test', outgoingPrefix: '9' })
    expect(set).toHaveBeenCalledTimes(2)
    phone.mockResolvedValue({ status: 200, body: 'OK' })
    await sendCall(ctx, { action: 'dial', number: '12345' }, new AbortController().signal, refs)
    const url = phone.mock.calls[0]![0] as URL
    expect(url.origin).toBe('https://192.0.2.20')
    expect(url.searchParams.get('number')).toBe('912345')
    expect(url.searchParams.get('outgoing_url')).toBe('5678@pbx.test')
    phone.mockResolvedValue({ status: 200, body: 'OK' })
    await sendCall(ctx, { action: 'hangup' }, new AbortController().signal, refs)
    expect((phone.mock.calls[1]![0] as URL).search).toBe('?key=CALLEND')
  })
  it('does not use the previous phone when changing the caller, and rejects invalid configuration before writing', async () => {
    const { ctx, set, phone } = await fixture()
    const request = { caller: '1234', phoneUrl: '', pbx: 'pbx.test', outgoingPrefix: '9', username: 'test-user', password: 'test-password' }
    await saveCallSetup(ctx, refs, request)
    expect((await getCallSetup(ctx, refs, { caller: '5678' })).phoneUrl).toBe('https://192.0.2.20')
    expect((await getCallSetup(ctx, refs, { caller: '9999' })).phoneUrl).toBe('')
    const rejected = await saveCallSetup(ctx, refs, { ...request, phoneUrl: 'https://user:secret@phone.test', password: 'changed' })
    expect(rejected.confirmed).toBe(false)
    expect(rejected.issues.join('')).toContain('话机地址')
    expect(set).toHaveBeenCalledTimes(2)
    expect((await activeCallSettings(ctx, refs)).settings?.caller).toBe('1234')
    expect(phone).not.toHaveBeenCalled()
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
describe('dialing a colleague by name', () => {
  it('looks the name up in the local extension table and never picks between several people', async () => {
    const { ctx, directory, phone } = await fixture()
    await writeFile(join(directory, '内部分机信息表.md'), table + '| 2001 | 测试丙一 | Test C | 192.0.2.30 | 已注册 |\n| 2002 | 测试丙二 | Test D | 192.0.2.40 | 已注册 |\n')
    await saveCallSetup(ctx, refs, { caller: '1234', phoneUrl: '', pbx: 'pbx.test', outgoingPrefix: '9', username: 'test-user', password: 'test-password' })
    phone.mockResolvedValue({ status: 200, body: 'OK' })
    expect(await sendCall(ctx, { action: 'dial', name: '测试乙' }, new AbortController().signal, refs)).toContain('测试乙（5678）')
    expect(phone.mock.calls[0]![0].searchParams.get('number')).toBe('5678')
    expect(phone.mock.calls[0]![0].searchParams.get('outgoing_url')).toBe('1234@pbx.test')
    await sendCall(ctx, { action: 'dial', name: 'test b' }, new AbortController().signal, refs)
    expect(phone.mock.calls[1]![0].searchParams.get('number')).toBe('5678')
    await expect(sendCall(ctx, { action: 'dial', name: '测试丙' }, new AbortController().signal, refs)).rejects.toThrow('匹配多个人')
    await expect(sendCall(ctx, { action: 'dial', name: '不存在' }, new AbortController().signal, refs)).rejects.toThrow('通讯录里没有「不存在」')
    expect(phone).toHaveBeenCalledTimes(2)
  })
})
describe('phone transport', () => {
  it('reaches a phone that serves HTTPS with its own self-signed certificate, as Yealink phones do', async () => {
    const { execFileSync } = await import('node:child_process')
    const { createServer } = await import('node:https')
    const dir = await mkdtemp(join(tmpdir(), 'phone-tls-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=yealink',
        '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' })
    } catch { return } // openssl is not available on this machine
    let seen: { url?: string; authorization?: string } = {}
    const server = createServer({ key: await readFile(join(dir, 'key.pem')), cert: await readFile(join(dir, 'cert.pem')) }, (request, response) => {
      seen = { url: request.url, authorization: request.headers.authorization }
      response.end('OK')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    onTestFinished(() => new Promise<void>(resolve => server.close(() => resolve())))
    const url = new URL(`https://127.0.0.1:${(server.address() as { port: number }).port}/cgi-bin/ConfigManApp.com?key=CALLEND`)
    expect(await phoneTransport.request(url, 'Basic dGVzdA==', AbortSignal.timeout(5000))).toEqual({ status: 200, body: 'OK' })
    expect(seen).toEqual({ url: '/cgi-bin/ConfigManApp.com?key=CALLEND', authorization: 'Basic dGVzdA==' })
  })
})
