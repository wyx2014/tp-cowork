/** Team facts feed DSH's existing title, todo and workflow presentation. */
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import type {} from '@deepseek-ai/dsh-session-title/types'
import type {} from '@deepseek-ai/dsh-tool-workflow/types'
import type { TeamDefinition } from './teams.ts'
import type { RunState } from './schema.ts'

export const deliveryTask = '交付 Markdown/HTML 报告'
const finalTasks: Record<string, string> = { 'lead-synthesis': '综合研究结论', 'lead-review': '独立审阅报告' }
const phaseNames: Record<string, string> = { analysis: '并行研究', discovery: '发现机会', validation: '验证证据', synthesis: '综合研究结论', review: '独立审阅报告' }

export function phaseName(phase: string): string { return phaseNames[phase] ?? phase }
export function memberName(team: TeamDefinition, id: string): string {
  return team.members.find(member => member.id === id)?.name ?? finalTasks[id] ?? id
}
export function memberId(team: TeamDefinition, label: string): string {
  return team.members.find(member => member.name === label)?.id
    ?? Object.entries(finalTasks).find(([, name]) => name === label)?.[0] ?? label
}

/** Name the submitted team task before its first model request; preserve any existing title. */
export function nameTeamSession(session: Session, team: TeamDefinition, prompt: string): void {
  if (session.snapshotEvents().some(event => event.type === 'session/title' && event.data.title.trim())) return
  // The team chip may share the request line; additional chips occupy an initial reference line.
  let prose = prompt.trim()
  if (prose.startsWith(`@${team.name}`)) prose = prose.slice(team.name.length + 1).trimStart()
  prose = prose.replace(/^(?:@[^\n]*\r?\n\s*)+/, '')
  const topic = Array.from(prose.replace(/\s+/g, ' ')).slice(0,48).join('')
  const name = team.id === 'asset-research-team' ? '个股研究' : '供应链研究'
  // DSH permits titles without model-visible message seqs only as explicit application renames.
  session.append('session/title', { title: topic ? `${name} · ${topic}` : team.name, messageSeqs: [], source: { kind: 'user' } })
}

/** The native todo projection remains the sole task list, including parallel members. */
export function beginTeamPlan(session: Session, team: TeamDefinition): void {
  const contents = [...team.members.map(member => member.name), ...Object.values(finalTasks), deliveryTask]
  session.append('todo/write', { todos: contents.map(content => ({ content, status: 'pending' as const })) })
}

/** Change only the matching task in the latest native plan; user/model additions survive. */
export function updateTeamTask(session: Session, content: string, status: TodoItem['status']): void {
  const latest = session.snapshotEvents().findLast(event => event.type === 'todo/write')
  if (latest?.type !== 'todo/write' || !latest.data.todos.some(item => item.content === content && item.status !== status)) return
  session.append('todo/write', { todos: latest.data.todos.map(item => item.content === content ? { ...item, status } : item) })
}

/** Append native views of an older settled run once, using only its recorded members and outcomes. */
export function restoreTeamPresentation(session: Session, team: TeamDefinition, run: RunState): void {
  const events = session.snapshotEvents()
  const original = events.flatMap(event => event.type === 'user/message' ? [event.data]
    : event.type === 'agent/inbox/spliced' ? event.data.inserted ?? [] : []).find(message => message.source.kind === 'user')
  nameTeamSession(session, team, original?.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n') ?? '')
  if (!run.workflowId || ['running', 'interrupted'].includes(run.settlement.execution)
    || events.some(event => event.type === 'tool-workflow/run-start' && event.data.runId === run.workflowId)) return
  const runId = WorkflowRunId(run.workflowId)
  session.append('tool-workflow/run-start', { runId, name: team.name })
  const starts = run.events.filter(event => event.type === 'member_started' && event.memberId && event.sessionEventId)
  for (const [index, event] of starts.entries()) {
    const ref = event.sessionEventId!
    session.append('tool-workflow/agent-start', { runId, seq: index + 1,
      label: memberName(team, event.memberId!), childId: SessionId(ref.slice(0, ref.lastIndexOf(':'))),
      ...(event.phaseId ? { phase: phaseName(event.phaseId) } : {}) })
    const end = run.events.findLast(item => item.type === 'member_finished' && item.memberId === event.memberId)
    if (end) session.append('tool-workflow/agent-end', { runId, seq: index + 1,
      outcome: end.status === 'succeeded' ? 'completed' : end.status === 'cancelled' ? 'cancelled' : 'failed' })
  }
  session.append('tool-workflow/run-end', { runId, stopReason: run.settlement.execution === 'cancelled' ? 'cancelled'
    : run.settlement.execution === 'failed' ? 'error' : 'completed' })
  if (!events.some(event => event.type === 'todo/write' && event.seq >= run.startSeq)) {
    beginTeamPlan(session, team)
    for (const id of [...team.members.map(member => member.id), ...Object.keys(finalTasks)]) {
      const end = run.events.findLast(event => event.type === 'member_finished' && event.memberId === id)
      if (end?.status === 'succeeded') updateTeamTask(session, memberName(team, id), 'completed')
    }
    if (run.settlement.delivery === 'delivered') updateTeamTask(session, deliveryTask, 'completed')
  }
}
