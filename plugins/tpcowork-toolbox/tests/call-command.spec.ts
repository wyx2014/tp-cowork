import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MockAdapter, textResponse } from '../../../../deepseek-harness/packages/core/agent-loop/tests/mock-adapter.ts'
import { phoneTransport } from '../src/host/skills/native.ts'
import { skillsFixture } from './skills-fixture.ts'

async function fixture(replies: ReturnType<typeof textResponse>[] = []) {
  const { ctx, dir, installer } = await skillsFixture()
  const phone = vi.spyOn(phoneTransport, 'request').mockResolvedValue({ status: 200, body: 'OK' })
  onTestFinished(() => phone.mockRestore())
  const directory = join(dir, 'phone')
  await mkdir(directory)
  await writeFile(join(directory, '内部分机信息表.md'), '| 分机短号 | 显示名称 | 显示名称(英文) |\n| --- | --- | --- |\n| 3737 | 张三 | Zhang San |\n')
  await writeFile(join(dir, 'call-phone.json'), JSON.stringify({ type: 'yealink', caller: '1234', phoneUrl: 'https://phone.test', pbx: 'pbx.test', outgoingPrefix: '9', sourceDirectory: directory }))
  ctx.provide('credentials', { resolve: async () => ({ value: 'fixture', source: 'test' }) } as never)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter(replies)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('call-test'), { provider: 'mock', model: 'mock' })
  await vi.waitFor(() => expect(ctx.commands.find(agent, 'call')).toBeDefined())
  expect(await installer.install({ requestId: 'install-call', source: { kind: 'bundled', resourceId: 'call' }, scope: { kind: 'user' }, conflict: 'reject' })).toMatchObject({ state: 'installed' })
  let request = 0
  const send = (text: string) => agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user', rpcId: `request-${++request}` as SessionRequestId },
  }))
  const results = () => agent.session.snapshotEvents().flatMap(event => event.type === 'command/done' ? [event.data] : [])
  return { ctx, agent, adapter, phone, dir, send, results }
}

describe('Yealink desktop commands', () => {
  it('dials by local directory or number and hangs up with no model request', async () => {
    const { ctx, agent, adapter, phone, send, results } = await fixture()
    send('请帮我给张三打电话！')
    await agent.whenIdle()
    send('$call\n拨打 4567')
    await agent.whenIdle()
    send('挂断电话')
    await agent.whenIdle()
    await ctx.commands.execute(agent, '/call 5678', [], new AbortController().signal)

    expect(adapter.requests).toHaveLength(0)
    expect(phone.mock.calls.map(([url]) => Array.from(url.searchParams))).toEqual([
      [['number', '3737'], ['outgoing_url', '1234@pbx.test']],
      [['number', '4567'], ['outgoing_url', '1234@pbx.test']],
      [['key', 'CALLEND']],
      [['number', '5678'], ['outgoing_url', '1234@pbx.test']],
    ])
    expect(results().map(result => result.text)).toEqual([
      expect.stringContaining('张三（3737）'), expect.stringContaining('拨打 4567'),
      expect.stringContaining('发送挂断指令'), expect.stringContaining('拨打 5678'),
    ])
  })

  it('passes queued conversation to the model after one unresolved phone request settles', async () => {
    const { agent, adapter, phone, send, results } = await fixture([textResponse('model reply')])
    const started = Promise.withResolvers<void>()
    const reply = Promise.withResolvers<{ status: number; body: string }>()
    phone.mockImplementationOnce(() => { started.resolve(); return reply.promise })
    send('拨打 3737')
    await started.promise
    send('为什么拨打失败？')
    reply.resolve({ status: 200, body: 'OK' })
    await agent.whenIdle()

    expect(phone).toHaveBeenCalledOnce()
    expect(results()).toHaveLength(1)
    expect(adapter.requests).toHaveLength(1)
    const messages = adapter.requests[0]!.messages
    expect(JSON.stringify(messages)).toContain('为什么拨打失败？')
    expect(JSON.stringify(messages)).not.toContain('拨打 3737')
  })

  it('reports directory misses and request timeouts locally without trying the phone twice', async () => {
    const { agent, adapter, phone, send, results } = await fixture()
    send('呼叫不在通讯录')
    await agent.whenIdle()
    expect(phone).not.toHaveBeenCalled()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementationOnce(() => AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')))
    onTestFinished(() => timeout.mockRestore())
    phone.mockImplementationOnce(async (_url, _authorization, signal) => { throw signal.reason })
    send('拨打 3737')
    await agent.whenIdle()
    expect(phone).toHaveBeenCalledOnce()
    expect(timeout).toHaveBeenCalledWith(8000)
    expect(results().map(result => result.text)).toEqual([expect.stringContaining('通讯录里没有'), expect.stringContaining('先查看话机状态')])
    expect(adapter.requests).toHaveLength(0)
  })

  it('keeps Cisco chat on the normal model route', async () => {
    const { agent, adapter, dir, phone, send, results } = await fixture([textResponse('model reply')])
    await writeFile(join(dir, 'call-phone.json'), '{"type":"cisco"}')
    send('给张三打电话')
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(phone).not.toHaveBeenCalled()
    expect(results()).toEqual([])
  })

  it('returns the disabled-skill error without sending a request', async () => {
    const { ctx, agent, adapter, phone, send, results } = await fixture()
    const catalog = await ctx.toolboxSkills.inventory({})
    const call = catalog.items.find(skill => skill.name === 'call')!
    await ctx.toolboxSkills.setEnabled({ id: call.id, enabled: false, expectedRevision: catalog.revision })
    send('拨打 3737')
    await agent.whenIdle()

    expect(results()).toMatchObject([{ kind: 'error', text: '请在工具箱中启用办公电话技能。' }])
    expect(phone).not.toHaveBeenCalled()
    expect(adapter.requests).toHaveLength(0)
  })
})
