import { describe, expect, it } from 'vitest'
import { pinTaskContext, taskStatus } from '../src/task-context.ts'
import { draft, skillCatalog, mcpCatalog, teamCatalog } from '../src/examples.ts'
import type { Catalog, McpItem, SkillItem, TaskSettlement, TeamItem } from '../src/contracts/index.ts'

const identity = { taskId: 'task', sessionId: 'session', submittedAt: 100 }
const inventory = (): { revision: number; skills: Catalog<SkillItem>; mcp: Catalog<McpItem>; teams: Catalog<TeamItem> } => structuredClone({ revision: 1, skills: skillCatalog, mcp: mcpCatalog, teams: teamCatalog })
describe('first submission boundary', () => {
  it('copies and freezes the authoritative pins so later composer edits cannot change a task', () => {
    const selection = structuredClone(draft)
    const facts = inventory()
    const context = pinTaskContext(identity, selection, facts)
    selection.mcpIds.length = 0
    facts.mcp.items[0]!.configRevision = 5
    expect(context.mcp).toEqual([{ id: 'juyuan', configRevision: 2 }])
    expect(Object.isFrozen(context.mcp[0])).toBe(true)
    expect(Object.isFrozen(context.team)).toBe(true)
    expect(JSON.parse(JSON.stringify(context))).toEqual(context)
  })
  it('rejects stale, incomplete, disabled and unavailable selections before execution', () => {
    expect(() => pinTaskContext(identity, { ...draft, expectedRevision: 0 }, inventory())).toThrow('stale-selection')
    const incomplete = inventory(); incomplete.skills.complete = false
    expect(() => pinTaskContext(identity, draft, incomplete)).toThrow('incomplete-inventory')
    const disabled = inventory(); disabled.skills.items[0]!.enabled = false
    expect(() => pinTaskContext(identity, draft, disabled)).toThrow('skill-unavailable')
    const missing = inventory(); missing.mcp.items[0]!.readiness = { state: 'blocked', reasons: [] }
    expect(() => pinTaskContext(identity, draft, missing)).toThrow('mcp-unavailable')
    const dependency = inventory(); dependency.teams.items[0]!.requiredSkillIds = ['missing']
    expect(() => pinTaskContext(identity, draft, dependency)).toThrow('team-dependency-missing')
  })
})
describe('business settlement', () => {
  it.each([
    ['running', 'delivered', 'reconciled', 'running'],
    ['succeeded', 'pending', 'reconciled', 'awaiting_delivery'],
    ['succeeded', 'delivered', 'open', 'awaiting_plan'],
    ['succeeded', 'delivered', 'reconciled', 'completed'],
    ['partial', 'delivered', 'reconciled', 'partial'],
    ['succeeded', 'failed', 'reconciled', 'failed'],
    ['failed', 'delivered', 'open', 'failed'],
    ['cancelled', 'delivered', 'open', 'cancelled'],
    ['interrupted', 'pending', 'open', 'interrupted'],
  ])('%s + %s + %s => %s', (execution, delivery, plan, expected) => {
    expect(taskStatus({ execution, delivery, plan } as TaskSettlement)).toBe(expected)
  })
})
