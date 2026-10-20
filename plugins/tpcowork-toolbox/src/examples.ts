/** Compiled downstream fixtures: T2/T3 supply these facts; T4 supplies only the draft. */
import type { Catalog, McpItem, SelectionDraft, SkillItem, TeamItem } from './contracts/index.ts'
import { pinTaskContext } from './task-context.ts'
const ready = { state: 'ready' as const, reasons: [] }
export const skillCatalog = {
  revision: 1, complete: true, items: [{
    id: 'bundled:office-docx', name: 'office-docx', description: '办公文稿', origin: 'bundled', provider: 'dsh-office',
    version: '1.0.0', fingerprint: 'sha256:example', installed: true, enabled: true,
    invocation: { modelInvocable: true, userInvocable: true }, readiness: ready, resources: ['SKILL.md'],
  }],
} satisfies Catalog<SkillItem>
export const mcpCatalog = {
  revision: 1, complete: true, items: [{
    id: 'juyuan', label: '聚源', origin: 'bundled', configRevision: 2, installed: true, enabled: true,
    readiness: ready, connection: 'connected', generation: 1, toolCount: 3,
    credentials: [{ ref: 'JUYUAN_MCP_TOKEN', configured: true, writable: false }],
  }],
} satisfies Catalog<McpItem>
export const teamCatalog = {
  revision: 1, complete: true, items: [{
    id: 'asset-research-team', version: '1.0.0', workflowId: 'investment-team', name: '资产投研团队', enabled: true,
    members: [{ id: 'business-analyst', name: '商业分析师' }], requiredSkillIds: [], optionalMcpIds: ['juyuan', 'caihui_mcp'], readiness: ready,
  }],
} satisfies Catalog<TeamItem>
export const draft = {
  expectedRevision: 1, team: { id: 'asset-research-team', version: '1.0.0', workflowId: 'investment-team' },
  skillIds: ['bundled:office-docx'], mcpIds: ['juyuan'],
} satisfies SelectionDraft
export const contextExample = pinTaskContext({ taskId: 'task-example', sessionId: 'session-example', submittedAt: 1 }, draft,
  { revision: 1, skills: skillCatalog, mcp: mcpCatalog, teams: teamCatalog })
