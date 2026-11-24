import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, onTestFinished, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { sendCall, type NativeOptions } from '../src/host/skills/native.ts'
import { ciscoEndpoints } from '../src/host/skills/cisco-call.ts'
import { loadCiscoDeployment, readBundledCiscoDeployment, resolveCiscoDeployment } from '../src/host/skills/cisco-deployment.ts'
import { deferred, hubFixture, secret } from './tpcoworkhub-fixture.ts'

const options: NativeOptions = {
  ciscoQueryUrl: 'https://office.test/directory', ciscoDialUrl: 'https://office.test/dial',
  requestTimeoutMs: 3000, imageMaxBytes: 1000, visionMaxTokens: 100,
  callUsernameRef: 'PHONE_USER', callPasswordRef: 'PHONE_PASSWORD', visionKeyRef: 'VISION_KEY',
}

async function fixture() {
  vi.stubEnv('DSH_YEALINK_CALLER', '')
  const hub = await hubFixture()
  const state = {
    users: [{ VC_IP_PHONE: '1121 1234' }],
    query: undefined as (() => Promise<void>) | undefined,
    dialResult: 'ok' as 'ok' | 'forbidden' | 'timeout',
  }
  const operations: { name: string; arguments: Record<string, string> }[] = []
  const fetch = globalThis.fetch
  const cisco = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.hostname !== 'office.test') return fetch(input, init)
    expect(init?.redirect).toBe('error')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${secret}`)
    const rpc = JSON.parse(String(init?.body))
    switch (rpc.method) {
      case 'initialize':
        expect(rpc.params.protocolVersion).toBe('2024-11-05')
        return Response.json({}, { headers: { 'Mcp-Session-Id': 'mcp-session' } })
      case 'notifications/initialized':
        expect(headers.get('mcp-session-id')).toBe('mcp-session')
        return new Response(null, { status: 202 })
      case 'tools/call': {
        expect(headers.get('mcp-session-id')).toBe('mcp-session')
        operations.push(rpc.params)
        const directory = url.pathname === '/directory'
        if (directory) await state.query?.()
        if (!directory && state.dialResult === 'forbidden') return new Response(secret, { status: 403 })
        if (!directory && state.dialResult === 'timeout') {
          const signal = init?.signal
          await new Promise((_, reject) => { signal?.addEventListener('abort', () => reject(signal.reason), { once: true }) })
        }
        const reply = { jsonrpc: '2.0', id: rpc.id, result: { content: [{
          type: 'text', text: JSON.stringify(directory ? { code: 200, data: state.users } : { code: 200, message: secret }),
        }] } }
        return directory
          ? new Response('data: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\ndata: ' + JSON.stringify(reply) + '\r\n\r\n',
            { headers: { 'Content-Type': 'text/event-stream' } })
          : Response.json(reply)
      }
      default:
        throw new Error('Unexpected MCP method')
    }
  })
  onTestFinished(() => { cisco.mockRestore(); vi.unstubAllEnvs() })
  const call = (target: { action?: string; number?: string; name?: string }, config = options) =>
    sendCall(hub.ctx, { action: 'dial', ...target }, new AbortController().signal, config)
  return { ...hub, call, state, operations, cisco }
}

it('uses the existing account session for direct dialing and directory lookup', async () => {
  const { ctx, call, login, operations, requests } = await fixture()
  await expect(call({ number: '11211234' })).rejects.toThrow('登录')
  expect(operations).toEqual([])
  await login()
  vi.stubEnv('TPCOWORK_CISCO_QUERY_URL', options.ciscoQueryUrl)
  vi.stubEnv('TPCOWORK_CISCO_DIAL_URL', options.ciscoDialUrl)
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  await vi.waitFor(() => expect(ctx.tools.get('call')).toBeDefined())
  const direct = await ctx.tools.execute({ name: 'call', arguments: { action: 'dial', number: '11211234' },
    callId: ToolCallId('direct-cisco-dial'), signal: AbortSignal.timeout(3000) })
  expect(direct.value).toContain('已向分机 11211234')
  expect(JSON.stringify(direct)).not.toContain(secret)
  await call({ name: '同事甲' })
  await call({ name: 'colleague@example.test' })
  const token = `Bearer ${secret}`
  expect(operations).toEqual([
    { name: '打电话', arguments: { vc_ip_phone: '11211234', token } },
    { name: '用户查询', arguments: { name: '同事甲', token } },
    { name: '打电话', arguments: { vc_ip_phone: '11211234', token } },
    { name: '用户查询', arguments: { email: 'colleague@example.test', token } },
    { name: '打电话', arguments: { vc_ip_phone: '11211234', token } },
  ])
  expect(requests.filter(row => row.path === '/tpcoworkapi/users/login')).toHaveLength(1)
})

it('only dials a valid, unambiguous extension and refuses public cleartext endpoints', async () => {
  const { call, login, operations, state, cisco } = await fixture()
  await login()
  const before = cisco.mock.calls.length
  expect(ciscoEndpoints({})).toBeUndefined()
  expect(ciscoEndpoints({ ciscoQueryUrl: 'http://10.17.22.116:32300/api/proxy/mcp?api_key=q', ciscoDialUrl: 'http://192.168.1.10:8080/mcp' })).toBeDefined()
  expect(ciscoEndpoints({ ciscoQueryUrl: 'http://172.16.0.5:3000/q', ciscoDialUrl: 'http://127.0.0.1:3000/d' })).toBeDefined()
  expect(ciscoEndpoints({ ciscoQueryUrl: 'http://172.32.0.1/q', ciscoDialUrl: 'https://office.test/d' })).toBeUndefined()
  await expect(call({ number: '13800000000' })).rejects.toThrow('八位办公分机号')
  await expect(call({ action: 'hangup' })).rejects.toThrow('暂不支持挂断')
  await expect(call({ number: '11211234' }, { ...options, ciscoDialUrl: 'http://office.test/dial' })).rejects.toThrow('尚未配置')
  expect(cisco.mock.calls.slice(before).filter(([url]) => String(url).includes('office.test'))).toEqual([])
  state.users.push({ VC_IP_PHONE: '11215678' })
  await expect(call({ name: '重名同事' })).rejects.toThrow('找到多人')
  state.users = [{ VC_IP_PHONE: '1234' }]
  await expect(call({ name: '没有有效分机' })).rejects.toThrow('没有找到有效')
  expect(operations.map(operation => operation.name)).toEqual(['用户查询', '用户查询'])
})

it('loads build-time Cisco endpoints from local file or env and honors override precedence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'toolbox-cisco-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const url = pathToFileURL(directory + '/')
  expect(await loadCiscoDeployment(url, {})).toEqual({})
  expect(readBundledCiscoDeployment(url)).toEqual({})

  const intranet = {
    ciscoQueryUrl: 'http://10.17.22.116:32300/api/proxy/mcp?api_key=query-test',
    ciscoDialUrl: 'http://10.17.22.116:32300/api/proxy/mcp?api_key=dial-test',
  }
  await writeFile(join(directory, 'cisco-call.local.json'), JSON.stringify(intranet))
  expect(await loadCiscoDeployment(url, {})).toEqual(intranet)
  const bundled = readBundledCiscoDeployment(url)
  expect(bundled).toEqual(intranet)
  expect(ciscoEndpoints({}, bundled)).toEqual({
    query: new URL(intranet.ciscoQueryUrl),
    dial: new URL(intranet.ciscoDialUrl),
  })
  expect(ciscoEndpoints({ ciscoQueryUrl: 'https://override.test/q', ciscoDialUrl: 'https://override.test/d' }, bundled)).toEqual({
    query: new URL('https://override.test/q'),
    dial: new URL('https://override.test/d'),
  })
  expect(await loadCiscoDeployment(url, {
    TPCOWORK_CISCO_QUERY_URL: 'https://ci.test/query?api_key=ci-q',
    TPCOWORK_CISCO_DIAL_URL: 'https://ci.test/dial?api_key=ci-d',
  })).toEqual({
    ciscoQueryUrl: 'https://ci.test/query?api_key=ci-q',
    ciscoDialUrl: 'https://ci.test/dial?api_key=ci-d',
  })

  expect(() => resolveCiscoDeployment({ ciscoQueryUrl: 'http://10.17.22.116:32300/mcp?api_key=secret-only-one' }, {}))
    .toThrow('Cisco 办公电话部署配置无效，请同时配置有效的查号和拨号服务地址。')
  expect(() => resolveCiscoDeployment({
    ciscoQueryUrl: 'http://public.example/query?api_key=secret',
    ciscoDialUrl: 'http://public.example/dial?api_key=secret',
  }, {})).toThrow('Cisco 办公电话部署配置无效，请同时配置有效的查号和拨号服务地址。')
})

it('redacts service errors and never retries a dial whose outcome is uncertain', async () => {
  const { call, login, operations, state } = await fixture()
  await login()
  state.dialResult = 'forbidden'
  const failure = await call({ number: '11211234' }).catch((error: Error) => error.message)
  expect(failure).toContain('拒绝了当前账号凭证')
  expect(failure).not.toContain(secret)
  state.dialResult = 'timeout'
  await expect(call({ number: '11211234' }, { ...options, requestTimeoutMs: 100 })).rejects.toThrow('无法确认 Cisco 拨号结果')
  expect(operations.map(operation => operation.name)).toEqual(['打电话', '打电话'])
})

it('does not dial when the account signs out during lookup', async () => {
  const { call, login, operations, service, state } = await fixture()
  await login()
  const entered = deferred()
  const resume = deferred()
  state.query = async () => { entered.resolve(); await resume.promise }
  onTestFinished(() => resume.resolve())
  const result = expect(call({ name: '同事甲' })).rejects.toThrow('已取消')
  await entered.promise
  try { await service.logout() } finally { resume.resolve() }
  await result
  expect(operations.map(operation => operation.name)).toEqual(['用户查询'])
})
