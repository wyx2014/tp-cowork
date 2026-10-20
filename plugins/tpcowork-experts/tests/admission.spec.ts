import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { fixture } from './fixture.ts'
import { contextRecord, selectionRecord } from '../src/schema.ts'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../deepseek-harness/packages/core/agent-loop/tests/mock-adapter.ts'
import { readContext, readSelection } from '../src/host.ts'
import type { SelectionDraft } from '../../tpcowork-toolbox/src/contracts/index.ts'

async function choice(h: Awaited<ReturnType<typeof fixture>>): Promise<SelectionDraft> {
  const inventory = await h.ctx.toolboxTasks.selection({ sessionId: h.agent.id })
  const team = inventory.teams.items[0]!
  return { expectedRevision: inventory.revision, team: { id: team.id, version: team.version, workflowId: team.workflowId }, skillIds: [], mcpIds: [] }
}
const signal = () => new AbortController().signal

it('uses a pending Session model selection for members before the first parent request', async () => {
  const h = await fixture()
  h.ctx.llm.registerAdapter(['selected'], h.adapter)
  h.adapter.listModels = async provider => [{ provider, id: 'selected-model', name: 'Selected model' }]
  await h.ctx.sessionController.selectModel({ sessionId: h.agent.id, provider: 'selected', model: 'selected-model' })
  expect(h.agent.session.requestHeader()).toBeUndefined()
  await h.submit('asset-research-team')
  expect((await h.wait()).status).toBe('completed')
  expect(h.adapter.requests.length).toBeGreaterThan(6)
  expect(h.adapter.requests.every(request => request.provider === 'selected' && request.model === 'selected-model')).toBe(true)
})

it('checks delivery tools in the Session scope before pinning a team', async () => {
  const h = await fixture()
  const release = h.agent.ctx.tools.restrict({ deny: ['present'] })
  expect((await h.ctx.toolboxTasks.selection({ sessionId: h.agent.id })).teams.items.every(team => team.readiness.state === 'blocked')).toBe(true)
  await expect(h.submit('asset-research-team')).rejects.toThrow('prompt rejected')
  expect(await h.ctx.toolboxTasks.context({ sessionId: h.agent.id, taskId: h.agent.id })).toBeNull()
  expect(h.adapter.requests).toHaveLength(0)
  release()
  await h.submit('asset-research-team')
  expect((await h.wait()).status).toBe('completed')
})

it('rejects stale/incomplete catalog admission without pinning or consuming the upload, then accepts the same request', async () => {
  const h = await fixture()
  const upload = await h.ctx.fileUploads.upload(h.agent, { data: '5rWL6K+V5p2Q5paZ', name: '材料.txt' }, signal())
  const selection = await choice(h)
  const message = { sessionId: h.agent.id, requestId: 'receipt-retry' as never, mode: 'steer' as const, clientTimeZone: 'Asia/Shanghai', content: [{ type: 'file' as const, receiptId: upload.receiptId }, { type: 'text' as const, text: '核验材料' }] }
  const submit = () => h.ctx.toolboxTasks.submit({ message, selection }, signal())
  const initial = await h.ctx.get('toolboxTeams')!.inventory()
  const inventory = vi.spyOn(h.ctx.get('toolboxTeams')!, 'inventory')
  inventory.mockResolvedValue({ ...initial, revision: initial.revision + 1 })
  await expect(submit()).rejects.toThrow('prompt rejected')
  expect(h.ctx.fileUploads.resolve(h.agent, upload.receiptId)).toEqual(upload.file)
  expect(h.agent.session.snapshotEvents().some(event => event.type === contextRecord || event.type === selectionRecord)).toBe(false)
  inventory.mockResolvedValue({ ...initial, revision: initial.revision + 2, complete: false })
  selection.expectedRevision = (await h.ctx.toolboxTasks.selection({ sessionId: h.agent.id })).revision
  await expect(submit()).rejects.toThrow('prompt rejected')
  expect(await h.ctx.toolboxTasks.context({ sessionId: h.agent.id, taskId: h.agent.id })).toBeNull()
  inventory.mockRestore()
  selection.expectedRevision = (await h.ctx.toolboxTasks.selection({ sessionId: h.agent.id })).revision
  await Promise.all([submit(), submit()])
  expect((await h.wait()).status).toBe('completed')
  const events = h.agent.session.snapshotEvents()
  const user = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
  expect(user).toHaveLength(1)
  expect(user[0]!.data).toMatchObject({ source: { rpcId: 'receipt-retry', clientTimeZone: 'Asia/Shanghai' }, content: [{ type: 'file', attachment: upload.file }, { type: 'text', text: '核验材料' }] })
  expect(events.filter(event => event.type === selectionRecord)).toHaveLength(1)
  expect(JSON.stringify(h.adapter.requests[0]!.messages)).toContain(upload.file.attachmentId)
  expect(JSON.stringify(h.adapter.requests[0]!.messages)).not.toContain(upload.receiptId)
})

it('invalid native attachments never fix a team selection', async () => {
  const h = await fixture()
  await expect(h.submit('asset-research-team', { content: [{ type: 'file', receiptId: 'missing' as never }] })).rejects.toMatchObject({ code: 'session/attachment-invalid' })
  expect(await h.ctx.toolboxTasks.context({ sessionId: h.agent.id, taskId: h.agent.id })).toBeNull()
  expect(h.adapter.requests).toHaveLength(0)
  await h.submit('supply-chain-bottleneck-team')
  expect((await h.wait()).status).toBe('completed')
  expect((await h.ctx.toolboxTasks.context({ sessionId: h.agent.id, taskId: h.agent.id }))!.team!.id).toBe('supply-chain-bottleneck-team')
})

it('later drafts cannot replace the pinned team and task identity must match', async () => {
  const h = await fixture()
  const initial = await h.submit('asset-research-team')
  await h.wait()
  const later = await h.submit('supply-chain-bottleneck-team', { requestId: 'followup-2' as never })
  expect(later.context).toEqual(initial.context)
  await h.wait()
  await expect(h.ctx.toolboxTasks.context({ sessionId: h.agent.id, taskId: 'other' })).rejects.toThrow('task-identity-mismatch')
})


it('selected native skill content reaches members, and changed content cannot silently replace a pin', async () => {
  const h = await fixture({ skill: true })
  const accepted = await h.submit('asset-research-team')
  expect(accepted.context.skills).toHaveLength(1)
  expect((await h.wait()).status, JSON.stringify(h.agent.session.snapshotEvents().filter(event => event.type === 'turn/end'))).toBe('completed')
  expect(JSON.stringify(h.adapter.requests[0]!.messages)).toContain('固定技能核验_SKILL')
  await appendFile(join(h.root, 'profile/skills/test-skill/SKILL.md'), '\n新内容。\n')
  await vi.waitFor(async () => expect((await h.ctx.get('toolboxSkills')!.inventory({ sessionId: h.agent.id })).items[0]!.fingerprint).not.toBe(accepted.context.skills[0]!.fingerprint), { timeout: 30000 })
  await expect(h.submit('asset-research-team', { requestId: 'changed-skill' as never })).rejects.toThrow('prompt rejected')
  await expect(h.ctx.experts.rerun({ sessionId: h.agent.id }, signal())).rejects.toThrow('pinned-skill-changed')
})


it('starts no members when the native durability barrier is unavailable, then retries the same pin', async () => {
  const h = await fixture()
  const flush = vi.spyOn(h.ctx.sessions, 'flush').mockResolvedValue(false)
  await expect(h.submit('asset-research-team')).rejects.toThrow('prompt rejected')
  expect(h.adapter.requests).toHaveLength(0)
  flush.mockRestore()
  await h.submit('asset-research-team')
  expect((await h.wait()).status).toBe('completed')
})

it('adds and removes skills and MCP in an existing ordinary chat, retaining each request snapshot', async () => {
  const h = await fixture({ skill: true, mcp: true })
  const message = (id: string) => ({ sessionId: h.agent.id, requestId: id as never, mode: 'queue' as const, content: [{ type: 'text' as const, text: id }], clientTimeZone: 'Asia/Shanghai' })
  await h.ctx.sessionController.prompt(message('ordinary-before'), signal())
  await h.agent.whenIdle()
  const inventory = await h.ctx.toolboxTasks.selection({ sessionId: h.agent.id })
  const selection = { expectedRevision: inventory.revision, team: null, skillIds: inventory.skills.items.map(item => item.id), mcpIds: ['local'] }
  const before = h.adapter.requests.length
  const request = { message: message('ordinary-selected'), selection }
  const [accepted, duplicate] = await Promise.all([h.ctx.toolboxTasks.submit(request, signal()), h.ctx.toolboxTasks.submit(request, signal())])
  expect(duplicate.context).toEqual(accepted.context)
  await h.agent.whenIdle()
  expect(accepted.context).toMatchObject({ taskId: 'message:ordinary-selected', team: null })
  expect(accepted.context.skills).toHaveLength(1)
  const selectedRequest = h.adapter.requests[before]!
  expect(JSON.stringify(selectedRequest.messages)).toContain('固定技能核验_SKILL')
  expect(selectedRequest.tools?.map(tool => tool.name)).toContain('mcp__local__ping')
  expect(JSON.stringify(selectedRequest.messages.filter(message => message.role === 'system'))).toContain('TOOLBOX_PRIVATE_INSTRUCTIONS')
  const current = await h.ctx.toolboxTasks.selection({ sessionId: h.agent.id })
  expect(current.revision).toBe(inventory.revision)
  const continuedAt = h.adapter.requests.length
  await h.ctx.toolboxTasks.submit({ message: message('ordinary-continued'), selection }, signal())
  await h.agent.whenIdle()
  expect(h.adapter.requests[continuedAt]!.tools?.map(tool => tool.name)).toContain('mcp__local__ping')
  const after = h.adapter.requests.length
  const cleared = await h.ctx.toolboxTasks.submit({ message: message('ordinary-cleared'), selection: { expectedRevision: current.revision, team: null, skillIds: [], mcpIds: [] } }, signal())
  await h.agent.whenIdle()
  expect(cleared.context).toMatchObject({ taskId: 'message:ordinary-cleared', skills: [], mcp: [] })
  expect(h.adapter.requests[after]!.tools?.map(tool => tool.name)).not.toContain('mcp__local__ping')
  const notices = h.agent.session.snapshotEvents().flatMap(event => event.type === 'user/message' && event.data.source.kind === 'tpcowork-experts' ? [event.data] : [])
  expect(JSON.stringify(notices.at(-1))).toContain('本次消息的技能：无')
  const events = h.agent.session.snapshotEvents()
  expect(events.filter(event => event.type === selectionRecord)).toHaveLength(3)
  expect(readSelection(events, 'ordinary-selected')).toEqual(accepted.context)
  expect(readSelection(events, 'ordinary-cleared')).toEqual(cleared.context)
  expect(readContext(events)).toBeNull()
  expect(await h.ctx.toolboxTasks.context({ sessionId: h.agent.id, taskId: h.agent.id })).toEqual(cleared.context)
})

it('keeps choices current through MCP probes while invalidating failed or disabled connectors', async () => {
  const h = await fixture({ mcp: true })
  const initial = await h.ctx.toolboxTasks.selection({ sessionId: h.agent.id })
  await h.ctx.toolboxMcp.probe({ id: 'local' }, signal())
  const observed = await h.ctx.toolboxTasks.selection({ sessionId: h.agent.id })
  expect(observed.mcp.revision).toBeGreaterThan(initial.mcp.revision)
  expect(observed.revision).toBe(initial.revision)
  const failed = structuredClone(observed.mcp)
  failed.items[0]!.readiness = { state: 'error', reasons: [{ code: 'probe_failed', message: 'Connection failed' }] }
  const inventory = vi.spyOn(h.ctx.toolboxMcp, 'inventory').mockResolvedValue(failed)
  expect((await h.ctx.toolboxTasks.selection({ sessionId: h.agent.id })).revision).toBeGreaterThan(observed.revision)
  inventory.mockRestore()
  await h.ctx.toolboxMcp.setEnabled({ id: 'local', expectedRevision: (await h.ctx.toolboxMcp.inventory()).revision, enabled: false })
  expect((await h.ctx.toolboxTasks.selection({ sessionId: h.agent.id })).revision).toBeGreaterThan(observed.revision)
  await expect(h.ctx.toolboxTasks.submit({
    message: { sessionId: h.agent.id, requestId: 'disabled-connector' as never, mode: 'queue', content: [{ type: 'text', text: '继续' }] },
    selection: { expectedRevision: observed.revision, team: null, skillIds: [], mcpIds: ['local'] },
  }, signal())).rejects.toThrow('prompt rejected')
  expect(h.agent.session.snapshotEvents().filter(event => event.type === selectionRecord)).toHaveLength(0)
})

it('does not apply a queued capability snapshot to the active message before its native claim', async () => {
  const h = await fixture({ mcp: true })
  const adapter = new MockAdapter([toolCallResponse('first-plan', 'todo_write', { todos: [{ content: '当前请求', status: 'completed' }] }), textResponse('当前请求结束'), textResponse('下一请求结束')])
  adapter.listModels = async provider => [{ provider, id: 'mock', name: 'Mock' }]
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const stream = adapter.stream.bind(adapter)
  let entered = false
  adapter.stream = async function* (request) {
    if (!entered) { entered = true; await gate }
    yield* stream(request)
  }
  h.ctx.llm.registerAdapter(['queued-choice'], adapter)
  await h.ctx.sessionController.selectModel({ sessionId: h.agent.id, provider: 'queued-choice', model: 'mock' })
  await h.ctx.sessionController.prompt({ sessionId: h.agent.id, requestId: 'active' as never, mode: 'queue', content: [{ type: 'text', text: '当前请求' }] }, signal())
  await vi.waitFor(() => expect(entered).toBe(true))
  const current = await h.ctx.toolboxTasks.selection({ sessionId: h.agent.id })
  await h.ctx.toolboxTasks.submit({ message: { sessionId: h.agent.id, requestId: 'queued' as never, mode: 'queue', content: [{ type: 'text', text: '排队请求' }] }, selection: { expectedRevision: current.revision, team: null, skillIds: [], mcpIds: ['local'] } }, signal())
  release()
  await h.agent.whenIdle()
  expect(adapter.requests).toHaveLength(3)
  expect(adapter.requests[0]!.tools?.map(tool => tool.name)).not.toContain('mcp__local__ping')
  expect(adapter.requests[1]!.tools?.map(tool => tool.name)).not.toContain('mcp__local__ping')
  expect(adapter.requests[2]!.tools?.map(tool => tool.name)).toContain('mcp__local__ping')
})

it('reads an existing singleton context without rewriting or duplicating its record', async () => {
  const h = await fixture()
  const context = { schemaVersion: 1 as const, taskId: h.agent.id, sessionId: h.agent.id, catalogRevision: 1, submittedAt: 1, team: null, skills: [], mcp: [] }
  appendPluginRecord(h.agent.session, contextRecord, { version: 1, requestId: 'legacy', context })
  expect(readContext(h.agent.session.snapshotEvents())).toEqual(context)
  const inventory = await h.ctx.toolboxTasks.selection({ sessionId: h.agent.id })
  await h.ctx.toolboxTasks.submit({ message: { sessionId: h.agent.id, requestId: 'new-message' as never, mode: 'queue', content: [{ type: 'text', text: '继续' }] }, selection: { expectedRevision: inventory.revision, team: null, skillIds: [], mcpIds: [] } }, signal())
  await h.agent.whenIdle()
  expect(h.agent.session.snapshotEvents().filter(event => event.type === contextRecord)).toHaveLength(1)
  expect(readSelection(h.agent.session.snapshotEvents())!.taskId).toBe('message:new-message')
})
