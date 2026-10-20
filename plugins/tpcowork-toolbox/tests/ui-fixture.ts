import { vi } from 'vitest'
import type { SelectionCatalog } from '../src/contracts/index.ts'
import type { UiActions } from '../src/ui/types.ts'
import { skillCatalog, mcpCatalog, teamCatalog } from '../src/examples.ts'
import { en, type UiKey } from '../src/ui/locales.ts'

export const catalog = (): SelectionCatalog => structuredClone({ revision: 8, skills: skillCatalog, mcp: mcpCatalog, teams: teamCatalog })
export const t = (key: UiKey, params?: Record<string, unknown>): string => en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
export function actions(): UiActions {
  return {
    refresh: vi.fn(async () => {}), refreshSkills: vi.fn(async () => {}), setTab: vi.fn(),
    skillDetail: vi.fn(async () => ({ item: skillCatalog.items[0]!, content: '# Office skill\nFull resources.' })),
    skillEnable: vi.fn(async () => skillCatalog), skillRemove: vi.fn(async () => {}), skillCheck: vi.fn(async () => skillCatalog.items[0]!),
    prepareImport: vi.fn(async () => ({ importId: 'import-1', name: 'office-docx' })), skillInstall: vi.fn(async () => ({ operationId: 'operation-1', state: 'installed' as const })),
    prepareSkillArchive: vi.fn(async () => ({ importId: 'archive-1', name: 'skillhub-sample' })),
    pickSkillDirectory: vi.fn(async () => '/local/skill-folder'), openSkillDirectory: vi.fn(async () => {}),
    prepareManualSkill: vi.fn(async () => ({ importId: 'manual-1', name: 'my-skill' })),
    mcpDefinition: vi.fn(async () => ({ id: 'juyuan', label: 'Juyuan', origin: 'bundled' as const, enabled: true, credentials: [{ ref: 'JUYUAN_MCP_TOKEN', target: 'url-query' as const, key: 'token' }], transport: 'streamable-http' as const, endpoint: 'https://example.test/mcp' })),
    mcpCreate: vi.fn(async () => mcpCatalog.items[0]!), mcpUpdate: vi.fn(async () => mcpCatalog.items[0]!), mcpRemove: vi.fn(async () => {}), mcpEnable: vi.fn(async () => mcpCatalog.items[0]!), mcpProbe: vi.fn(async () => mcpCatalog.items[0]!),
    mcpInventory: vi.fn(async () => mcpCatalog), mcpImport: vi.fn(async () => mcpCatalog), mcpProbeDraft: vi.fn(async () => ({ ok: true, toolCount: 2 })),
    hubAccount: vi.fn(async () => ({ configured: true, writable: true })), hubLogin: vi.fn(async () => ({ configured: true })), hubLogout: vi.fn(async () => {}),
    hubList: vi.fn(async () => ({ items: [{ id: 'hub-1', name: 'Research skill', description: 'Research', versionId: 'v1', version: '1.0' }] })),
    hubDetail: vi.fn(async () => ({ skill: { id: 'hub-1', name: 'Research skill', description: 'Research', versionId: 'v1', version: '1.0' }, fingerprint: 'sha256:1', content: '# Research instructions', files: [{ path: 'SKILL.md', size: 10, sha256: '1', contentType: 'text/markdown' }] })),
    hubInstall: vi.fn(async () => ({ operationId: 'hub-install', state: 'installed' as const })), hubPublish: vi.fn(async () => ({ skillId: 'hub-1', versionId: 'v1', fingerprint: 'sha256:1', fileCount: 1 })),
    prepareTeam: vi.fn(), prepareSkill: vi.fn(), loadChoice: vi.fn(async () => {}), choose: vi.fn(),
  }
}
