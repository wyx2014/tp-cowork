import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fixture } from './fixture.ts'
import { bundledTeamIds, loadTeams } from '../src/teams.ts'
import { selectionRecord } from '../src/schema.ts'

describe('native team submission and delivery', () => {
  it.each(bundledTeamIds)('%s uses real workflow phases, child sessions, files, present and plan', async teamId => {
    const h = await fixture()
    let peak = 0, concurrent = 0
    const phases: string[] = []
    h.ctx.on('workflow/agent-start', () => { peak = Math.max(peak, ++concurrent) })
    h.ctx.on('workflow/agent-end', () => { concurrent-- })
    h.ctx.on('workflow/phase', (_, phase) => { phases.push(phase) })
    const accepted = await h.submit(teamId)
    expect(accepted.context.taskId).toBe(h.agent.id)
    const settled = await h.wait()
    expect(settled.status, JSON.stringify(settled.run)).toBe('completed')
    const definition = (await loadTeams()).find(team => team.id === teamId)!
    expect(phases).toEqual([...definition.phases, 'synthesis', 'review'])
    expect({ phases, settlement: settled.run!.settlement, roles: settled.run!.events.filter(event => event.type === 'member_finished').map(({ memberId, status }) => ({ memberId, status })).sort((a, b) => a.memberId!.localeCompare(b.memberId!)), outputs: settled.run!.artifacts.map(item => item.kind).sort() }).toMatchSnapshot()
    expect(peak).toBe(teamId === 'asset-research-team' ? 4 : 3)
    expect(settled.run!.artifacts.filter(item => item.kind === 'member')).toHaveLength(definition.members.length)
    expect(settled.run!.artifacts.filter(item => item.sessionEventId)).toHaveLength(2)
    for (const artifact of settled.run!.artifacts) expect(await readFile(artifact.path, 'utf8')).toContain('缺少实时')
    expect(settled.run!.events.some(event => event.type === 'member_progress')).toBe(true)
    const log = h.agent.session.snapshotEvents()
    const workflowStart = log.find(event => event.type === 'tool-workflow/run-start')!
    const workflowMembers = log.filter(event => event.type === 'tool-workflow/agent-start')
    expect(workflowStart.data).toMatchObject({ name: definition.name })
    expect(workflowMembers).toHaveLength(definition.members.length + 2)
    expect(workflowMembers.map(event => event.data.label).sort()).toEqual([...definition.members.map(member => member.name), '综合研究结论', '独立审阅报告'].sort())
    expect(log.findLast(event => event.type === 'tool-workflow/run-end')!.data).toMatchObject({ stopReason: 'completed' })
    const initialPlan = log.find(event => event.type === 'todo/write')!
    expect(initialPlan.seq).toBeLessThan(workflowStart.seq)
    expect(initialPlan.data).toMatchObject({ todos: expect.arrayContaining(definition.members.map(member => ({ content: member.name, status: 'pending' }))) })
    const catalog = log.filter(event => event.type === 'subagent/catalog')
    expect(catalog.map(event => [event.data.childId, event.data.label]).sort()).toEqual(workflowMembers.map(event => [event.data.childId, event.data.label]).sort())
    expect({ plan: initialPlan.data, members: workflowMembers.map(event => ({ label: event.data.label, phase: event.data.phase })).sort((a, b) => a.label.localeCompare(b.label)) }).toMatchSnapshot('native presentation')
    expect(log.find(event => event.type === 'session/title')!.data).toMatchObject({ source: { kind: 'user' }, title: expect.stringContaining('测试公司') })
    const original = log.find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
    expect(original.data).toMatchObject({ source: { rpcId: 'request-1', clientTimeZone: 'Asia/Shanghai' } })
    expect(log.filter(event => event.type === selectionRecord)).toHaveLength(1)
    await h.submit(teamId)
    expect(h.agent.session.snapshotEvents().filter(event => event.type === selectionRecord)).toHaveLength(1)
    expect((await h.ctx.experts.snapshot({ sessionId: h.agent.id })).run!.runId).toBe(settled.run!.runId)
    expect(h.ctx.agents.list().map(agent => agent.id)).toEqual([h.agent.id])
    const replay = []
    for await (const event of h.ctx.experts.watch({ runId: settled.run!.runId, afterSequence: 2 }, new AbortController().signal)) replay.push(event)
    expect(replay.map(event => event.sequence)).toEqual(settled.run!.events.slice(2).map(event => event.sequence))
    expect(replay.at(-1)).toMatchObject({ type: 'settled', status: 'succeeded' })
    expect(await Array.fromAsync(h.ctx.experts.watch({ runId: settled.run!.runId, afterSequence: settled.run!.events.length }, new AbortController().signal))).toEqual([])
  })
  it('a failed member remains visible while available reports produce partial delivery', async () => {
    const h = await fixture({ fail: '财务分析师' })
    await h.submit('asset-research-team')
    const result = await h.wait()
    expect(result.status, JSON.stringify(result.run)).toBe('partial')
    expect(result.run!.events).toContainEqual(expect.objectContaining({ memberId: 'financial-analyst', type: 'member_finished', status: 'failed' }))
    expect(result.run!.settlement).toMatchObject({ execution: 'partial', delivery: 'delivered', plan: 'reconciled' })
    const plan = h.agent.session.snapshotEvents().findLast(event => event.type === 'todo/write')!
    expect(plan.data).toMatchObject({ todos: expect.arrayContaining([{ content: expect.stringContaining('财务分析师'), status: 'pending' }]) })
  })
  it('turn completion without present or todo_write cannot report completed', async () => {
    const missingDelivery = await fixture({ noDelivery: true })
    await missingDelivery.submit('asset-research-team')
    expect((await missingDelivery.wait()).status).toBe('awaiting_delivery')
    const missingPlan = await fixture({ noPlan: true })
    await missingPlan.submit('supply-chain-bottleneck-team')
    expect((await missingPlan.wait()).status).toBe('awaiting_plan')
  })
  it.each(bundledTeamIds)('cancel %s propagates to workflow and every live child', async teamId => {
    const h = await fixture({ hang: true })
    await h.submit(teamId)
    await vi.waitFor(() => expect(h.adapter.requests.length).toBeGreaterThan(0), { timeout: 30000 })
    const running = await h.ctx.experts.snapshot({ sessionId: h.agent.id })
    await h.ctx.experts.cancel({ runId: running.run!.runId })
    await h.agent.whenIdle()
    expect((await h.ctx.experts.snapshot({ sessionId: h.agent.id })).status).toBe('cancelled')
    expect(h.ctx.agents.list().map(agent => agent.id)).toEqual([h.agent.id])
    expect(h.ctx.experts.active.size).toBe(0)
    const events = h.agent.session.snapshotEvents()
    expect(events.findLast(event => event.type === 'tool-workflow/run-end')!.data).toMatchObject({ stopReason: 'cancelled' })
    const plan = events.findLast(event => event.type === 'todo/write')!
    expect(plan.type === 'todo/write' && plan.data.todos.every(item => item.status !== 'in_progress')).toBe(true)
  })
})


describe('failure evidence and delivery cancellation', () => {
  it.each(bundledTeamIds)('all failed members cannot complete %s', async teamId => {
    const h = await fixture({ allFail: true })
    await h.submit(teamId)
    const value = await h.wait()
    expect(value.status).toBe('failed')
    expect(value.run!.artifacts.filter(item => item.sessionEventId)).toHaveLength(0)
    expect(h.ctx.agents.list().map(agent => agent.id)).toEqual([h.agent.id])
  })
  it('a completed member without its file is a visible partial result', async () => {
    const h = await fixture({ gap: '财务分析师' })
    await h.submit('asset-research-team')
    const value = await h.wait()
    expect(value.status).toBe('partial')
    expect(value.run!.artifacts.some(item => item.id.endsWith('/financial-analyst'))).toBe(false)
    const events = h.agent.session.snapshotEvents()
    const member = events.find(event => event.type === 'tool-workflow/agent-start' && event.data.label.includes('财务分析师'))!
    expect(events.findLast(event => event.type === 'tool-workflow/agent-end' && event.data.seq === member.data.seq)!.data).toMatchObject({ outcome: 'failed' })
  })
  it('cancel during lead delivery ends the team and releases its native plan', async () => {
    const h = await fixture({ hangLead: true })
    await h.submit('asset-research-team')
    await vi.waitFor(async () => expect((await h.ctx.experts.snapshot({ sessionId: h.agent.id })).status).toBe('awaiting_delivery'), { timeout: 30000 })
    h.agent.session.append('todo/write', { todos: [{ content: '已研究', status: 'completed' }, { content: '交付 Markdown/HTML 报告', status: 'in_progress' }] })
    const { run } = await h.ctx.experts.snapshot({ sessionId: h.agent.id })
    await h.ctx.experts.cancel({ runId: run!.runId })
    expect((await h.wait()).status).toBe('cancelled')
    expect(h.agent.session.snapshotEvents().findLast(event => event.type === 'todo/write')!.data).toMatchObject({ todos: [{ status: 'completed' }, { status: 'pending' }] })
  })
  it('native cancellation during lead delivery also settles cancelled', async () => {
    const h = await fixture({ hangLead: true })
    await h.submit('supply-chain-bottleneck-team')
    await vi.waitFor(async () => expect((await h.ctx.experts.snapshot({ sessionId: h.agent.id })).status).toBe('awaiting_delivery'), { timeout: 30000 })
    await h.ctx.sessionController.cancel({ sessionId: h.agent.id })
    expect((await h.wait()).status).toBe('cancelled')
  })
})
