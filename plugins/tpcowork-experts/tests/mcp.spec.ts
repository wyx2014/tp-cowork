import { expect, it, vi } from 'vitest'
import { fixture } from './fixture.ts'
import type { ToolboxMcp } from '../../tpcowork-toolbox/src/host/mcp/index.ts'

it.each(['success', 'cancel', 'revoke'] as const)('native MCP scopes on the lead and children drain after %s', async outcome => {
  const h = await fixture({ mcp: true, hang: outcome !== 'success' })
  const service = h.ctx.get('toolboxMcp')! as ToolboxMcp
  const errors: unknown[] = []
  h.ctx.on('workflow/agent-end', (_, member) => { if (member.outcome !== 'completed') errors.push(member) })
  const opened: string[] = []
  const leases: Awaited<ReturnType<ToolboxMcp['openTask']>>[] = []
  const runtime = h.ctx.get('toolboxMcpRuntime')!
  const open = runtime.openTask.bind(runtime)
  vi.spyOn(runtime, 'openTask').mockImplementation(async (context, ctx, signal) => {
    const lease = await open(context, ctx, signal)
    opened.push(context.sessionId); leases.push(lease)
    return lease
  })
  await h.submit('asset-research-team')
  if (outcome === 'success') {
    const value = await h.wait()
    expect(value.status, JSON.stringify({ run: value.run, errors })).toBe('completed')
    expect(new Set(opened).size).toBe(7)
  } else {
    await vi.waitFor(() => expect(opened.length).toBeGreaterThanOrEqual(5), { timeout: 30000 })
    const { run } = await h.ctx.experts.snapshot({ sessionId: h.agent.id })
    if (outcome === 'revoke') await service.setEnabled({ id: 'local', enabled: false, expectedRevision: (await service.inventory()).revision })
    else await h.ctx.experts.cancel({ runId: run!.runId })
    const value = await h.wait()
    expect(value.status).toBe(outcome === 'revoke' ? 'failed' : 'cancelled')
    if (outcome === 'revoke') expect(value.run!.code).toBe('mcp_revoked')
    expect(h.ctx.agents.list().map(agent => agent.id)).toEqual([h.agent.id])
  }
  await vi.waitFor(() => expect(leases.every(lease => lease.signal.aborted)).toBe(true), { timeout: 30000 })
  expect(h.agent.ctx.tools.get('mcp__local__ping', h.agent)).toBeUndefined()
})

it('a changed pinned MCP configuration rejects later submissions and explicit rerun', async () => {
  const h = await fixture({ mcp: true })
  await h.submit('asset-research-team'); await h.wait()
  const service = h.ctx.get('toolboxMcp')! as ToolboxMcp
  const definition = await service.definition({ id: 'local' })
  await service.update({ id: 'local', definition: { ...definition, label: 'Changed' }, expectedRevision: (await service.inventory()).revision })
  await expect(h.submit('asset-research-team', { requestId: 'changed-config' as never })).rejects.toThrow('prompt rejected')
  await expect(h.ctx.experts.rerun({ sessionId: h.agent.id }, new AbortController().signal)).rejects.toThrow('pinned-mcp-changed')
})
