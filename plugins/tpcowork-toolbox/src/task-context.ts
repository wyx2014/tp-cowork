import { z } from 'zod'
import type { Catalog, McpItem, SelectionDraft, SkillItem, TaskContext, TaskSettlement, TaskStatus, TeamItem } from './contracts/index.ts'
const id = z.string().min(1)
const team = z.object({ id, version: id, workflowId: id }).strict()
const draftSchema = z.object({ expectedRevision: z.number().int().nonnegative(), team: team.nullable(), skillIds: z.array(id), mcpIds: z.array(id) }).strict()
const identitySchema = z.object({ taskId: id, sessionId: id, submittedAt: z.number().int().nonnegative() }).strict()

/** Pin authoritative Host observations once per native request, or once for a team task. */
export function pinTaskContext(identity: Pick<TaskContext, 'taskId' | 'sessionId' | 'submittedAt'>, draft: SelectionDraft,
  inventory: { revision: number; skills: Catalog<SkillItem>; mcp: Catalog<McpItem>; teams: Catalog<TeamItem> }): Readonly<TaskContext> {
  const owner = identitySchema.parse(identity)
  const selection = draftSchema.parse(draft)
  if (selection.expectedRevision !== inventory.revision) throw new Error('toolbox/stale-selection')
  if (!inventory.skills.complete || !inventory.mcp.complete || !inventory.teams.complete) throw new Error('toolbox/incomplete-inventory')
  const unique = (values: string[]) => [...new Set(values)]
  const skills = unique(selection.skillIds).map(id => {
    const row = inventory.skills.items.find(item => item.id === id)
    if (!row?.installed || !row.enabled || row.readiness.state !== 'ready') throw new Error(`toolbox/skill-unavailable: ${id}`)
    return { id, version: row.version, fingerprint: row.fingerprint }
  })
  const mcp = unique(selection.mcpIds).map(id => {
    const row = inventory.mcp.items.find(item => item.id === id)
    if (!row?.installed || !row.enabled || row.readiness.state !== 'ready') throw new Error(`toolbox/mcp-unavailable: ${id}`)
    return { id, configRevision: row.configRevision }
  })
  if (selection.team) {
    const row = inventory.teams.items.find(item => item.id === selection.team?.id)
    if (!row?.enabled || row.readiness.state !== 'ready' || row.version !== selection.team.version || row.workflowId !== selection.team.workflowId) throw new Error('toolbox/team-unavailable')
    if (row.requiredSkillIds.some(id => !skills.some(skill => skill.id === id))) throw new Error('toolbox/team-dependency-missing')
  }
  const context: TaskContext = { schemaVersion: 1, ...owner, catalogRevision: inventory.revision, team: selection.team, skills, mcp }
  for (const row of [...skills, ...mcp]) Object.freeze(row)
  if (context.team) Object.freeze(context.team)
  Object.freeze(skills); Object.freeze(mcp)
  return Object.freeze(context)
}

/** Terminal turns never imply business success. Only confirmed delivery plus reconciled plan completes a task. */
export function taskStatus(state: TaskSettlement): TaskStatus {
  if (state.execution === 'running') return 'running'
  if (state.execution === 'cancelled' || state.execution === 'interrupted' || state.execution === 'failed') return state.execution
  if (state.delivery === 'failed') return 'failed'
  if (state.delivery === 'pending') return 'awaiting_delivery'
  if (state.plan === 'open') return 'awaiting_plan'
  return state.execution === 'partial' ? 'partial' : 'completed'
}
