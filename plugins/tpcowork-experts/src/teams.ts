/** Bundled workflow definitions; prompts and roles are loaded from the shipped team resources. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { TeamItem } from '../../tpcowork-toolbox/src/contracts/teams.ts'

const role = z.object({ id: z.string().regex(/^[a-z-]+$/), name: z.string(), phase: z.string(), goal: z.string() }).strict()
const definition = z.object({
  schema_version: z.literal(1), id: z.string(), name: z.string(), version: z.string(), workflowId: z.string(),
  concurrency: z.number().int().min(1).max(4), phases: z.array(z.string()), members: z.array(role),
  optionalMcpIds: z.array(z.enum(['juyuan', 'caihui_mcp'])),
}).strict()
export type TeamDefinition = z.infer<typeof definition> & { adapter: string }
export const bundledTeamIds = ['asset-research-team', 'supply-chain-bottleneck-team'] as const
export const defaultResources = fileURLToPath(new URL('../resources/expert-teams/', import.meta.url))
/** team.yaml uses JSON (a YAML 1.2 subset), avoiding a second YAML parser in the runtime. */
export async function loadTeams(root = defaultResources): Promise<TeamDefinition[]> {
  return Promise.all(bundledTeamIds.map(async id => {
    const parsed = definition.parse(JSON.parse(await readFile(resolve(root, id, 'team.yaml'), 'utf8')))
    if (parsed.id !== id || parsed.members.some(member => !parsed.phases.includes(member.phase))) throw new Error('experts/invalid-team')
    return { ...parsed, adapter: await readFile(resolve(root, id, 'adapter.md'), 'utf8') }
  }))
}
export function teamItem(team: TeamDefinition, ready: boolean): TeamItem {
  return { id: team.id, version: team.version, workflowId: team.workflowId, name: team.name, enabled: true,
    members: team.members.map(({ id, name, phase, goal }) => ({ id, name, phase, goal })), requiredSkillIds: [], optionalMcpIds: team.optionalMcpIds,
    readiness: { state: ready ? 'ready' : 'blocked', reasons: ready ? [] : [{ code: 'runtime_unavailable', message: '请启用 TP Cowork workflow、spawn subagent 和文件交付能力。' }] } }
}
/** The script bounds each phase, carries verified upstream results, then requests independent synthesis/review. */
export function workflowScript(team: TeamDefinition): string {
  return `const results = [];
for (const group of args.phases) {
  phase(group);
  const roles = args.members.filter(member => member.phase === group);
  for (let i = 0; i < roles.length; i += ${team.concurrency}) {
    const batch = roles.slice(i, i + ${team.concurrency});
    const values = await parallel(batch.map(member => () => agent(
      args.policy + '\\n用户任务：' + args.prompt + '\\n角色：' + member.name + '\\n目标：' + member.goal
      + '\\n已完成阶段材料：' + JSON.stringify(results)
      + '\\n将有来源、日期、缺口及置信度的角色报告写入 ' + args.directory + '/' + member.id + '.md，最后返回研究摘要。',
      {label: member.name, phase: group})));
    batch.forEach((member, index) => results.push({id: member.id, result: values[index]}));
  }
}
phase('synthesis');
const synthesis = await agent(args.policy + '\\n用户任务：' + args.prompt + '\\n角色结果：' + JSON.stringify(results)
  + '\\n综合并交叉质证；把缺失角色、来源冲突、缺口及置信度写入报告。写入 ' + args.directory + '/report.md 和 ' + args.directory + '/report.html。返回摘要及路径。', {label: '综合研究结论'});
phase('review');
const review = await agent(args.policy + '\\n审阅用户任务：' + args.prompt + '\\n综合结果：' + JSON.stringify(synthesis)
  + '\\n角色结果：' + JSON.stringify(results) + '\\n读取并审计 ' + args.directory + '/report.md 和 report.html，修正无来源数据、冲突及过度结论。确认两份完整可读文件。把审阅意见写入 ' + args.directory + '/review.md。返回审阅摘要。', {label: '独立审阅报告'});
return {results, synthesis, review};`
}
