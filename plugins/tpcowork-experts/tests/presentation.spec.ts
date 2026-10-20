import { expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { loadTeams } from '../src/teams.ts'
import { runSchema } from '../src/schema.ts'
import { nameTeamSession, restoreTeamPresentation } from '../src/native-presentation.ts'

it('opens a legacy stopped run with its real child links and completed work exactly once', async () => {
  const team = (await loadTeams())[0]!
  const session = Session.create(SessionId('legacy-team'))
  session.append('session/title', { title: '用户命名的研究', source: { kind: 'user' }, messageSeqs: [] })
  const base = { taskId: session.id, runId: 'legacy-run', at: 1 }
  const run = runSchema.parse({
    version: 1, runId: base.runId, workflowId: 'legacy-workflow', startSeq: 0, directory: 'reports/legacy', researchDone: false,
    context: { schemaVersion: 1, taskId: session.id, sessionId: session.id, submittedAt: 1, catalogRevision: 1,
      team: { id: team.id, version: team.version, workflowId: team.workflowId }, skills: [], mcp: [] },
    settlement: { execution: 'cancelled', delivery: 'pending', plan: 'open' }, artifacts: [],
    events: [
      { ...base, sequence: 1, type: 'member_started', memberId: 'business-analyst', phaseId: 'analysis', sessionEventId: 'business-child:0' },
      { ...base, sequence: 2, type: 'member_finished', memberId: 'business-analyst', status: 'succeeded', sessionEventId: 'business-child:42' },
      { ...base, sequence: 3, type: 'member_started', memberId: 'financial-analyst', phaseId: 'analysis', sessionEventId: 'financial-child:0' },
      { ...base, sequence: 4, type: 'member_finished', memberId: 'financial-analyst', status: 'cancelled', sessionEventId: 'financial-child:10' },
    ],
  })
  restoreTeamPresentation(session, team, run)
  const events = session.snapshotEvents()
  expect(events.filter(event => event.type === 'session/title')).toHaveLength(1)
  expect(events.filter(event => event.type === 'tool-workflow/agent-start').map(event => event.data.childId)).toEqual(['business-child', 'financial-child'])
  expect(events.findLast(event => event.type === 'tool-workflow/run-end')!.data).toMatchObject({ stopReason: 'cancelled' })
  const plan = events.findLast(event => event.type === 'todo/write')!
  expect(plan.data).toMatchObject({ todos: expect.arrayContaining([
    { content: team.members[0]!.name, status: 'completed' },
    { content: team.members[1]!.name, status: 'pending' },
    { content: '交付 Markdown/HTML 报告', status: 'pending' },
  ]) })
  restoreTeamPresentation(session, team, run)
  expect(session.snapshotEvents()).toEqual(events)
})

it('names a task from the request after composer references and preserves manual names', async () => {
  const team = (await loadTeams())[0]!
  const session = Session.create(SessionId('reference-title'))
  nameTeamSession(session, team, '@资产投研团队 · 个股研究 @财汇\n\n分析贵州茅台的现金流')
  expect(session.snapshotEvents().find(event => event.type === 'session/title')!.data).toMatchObject({ title: '个股研究 · 分析贵州茅台的现金流' })
  session.append('session/title', { title: '我的研究', source: { kind: 'user' }, messageSeqs: [] })
  nameTeamSession(session, team, '再次研究')
  expect(session.snapshotEvents().findLast(event => event.type === 'session/title')!.data).toMatchObject({ title: '我的研究' })
  const inline = Session.create(SessionId('inline-title'))
  nameTeamSession(inline, team, '@资产投研团队 · 个股研究 请研究贵州茅台')
  expect(inline.snapshotEvents().findLast(event => event.type === 'session/title')!.data).toMatchObject({ title: '个股研究 · 请研究贵州茅台' })
})
