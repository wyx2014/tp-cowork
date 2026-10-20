import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'docs/automation-tasks');
const manifestPath = resolve(directory, 'manifest.json');
const roles = {
  coordinator: /coordinator|orchestrat|manager|lead|协调|统筹|负责人|架构/i,
  backend: /backend|server|storage|后端|服务端|存储/i,
  runtime: /runtime|agent.?loop|execution|运行时|执行|集成/i,
  tools: /tools?|mcp|工具|能力/i,
  frontend: /frontend|react|\bui\b|前端|界面/i,
  desktop: /desktop|electron|桌面|通知/i,
  integration: /integration|build|release|集成|构建|打包|发布/i,
  qa: /\bqa\b|test|quality|测试|验收|质量/i,
};

export function validateManifest(manifest) {
  if (manifest.version !== 1 || manifest.project !== 'tpcowork-dsh') throw new Error('Unexpected task manifest.');
  if (manifest.tasks.length !== 10) throw new Error('Expected ten sub-issues.');
  const entries = [manifest.parent, ...manifest.tasks];
  const byKey = new Map(entries.map(task => [task.key, task]));
  if (byKey.size !== entries.length || new Set(entries.map(task => task.title)).size !== entries.length) {
    throw new Error('Duplicate task key or title.');
  }
  for (const task of entries) {
    if (!roles[task.role] || !task.scope.length || !task.acceptance.length) throw new Error(`Incomplete task ${task.key}.`);
    if (task !== manifest.parent && (!Number.isInteger(task.stage) || task.stage < 1 || task.stage > 5)) {
      throw new Error(`Invalid stage: ${task.key}.`);
    }
    for (const key of task.dependsOn) {
      if (!byKey.has(key) || byKey.get(key).stage >= task.stage) throw new Error(`Invalid dependency ${task.key} -> ${key}.`);
    }
  }
  return entries;
}

export function rowsOf(payload, key) {
  if (Array.isArray(payload)) return payload;
  for (const value of [payload?.[key], payload?.items, payload?.data, payload?.data?.[key], payload?.data?.items]) {
    if (Array.isArray(value)) return value;
  }
  throw new Error(`Unrecognized CLI response for ${key}; no writes were attempted by this read.`);
}

export function selectAgents(agents, project, issues, overrides = {}) {
  const active = agents.filter(agent => !agent.archived_at && !agent.is_archived && agent.status !== 'archived');
  const projectAssignees = new Set(issues.filter(issue => issue.assignee_type === 'agent').map(issue => issue.assignee_id));
  const associated = active.filter(agent => projectAssignees.has(agent.id)
    || agent.project_id === project.id || agent.project_ids?.includes(project.id)
    || `${agent.name ?? ''} ${agent.description ?? ''}`.toLowerCase().includes('tpcowork-dsh'));
  const selected = {};
  for (const [role, pattern] of Object.entries(roles)) {
    if (overrides[role]) {
      const agent = active.find(value => value.id === overrides[role]);
      if (!agent) throw new Error(`Role ${role} does not identify an active workspace Agent.`);
      selected[role] = agent;
      continue;
    }
    const candidates = associated.filter(agent => pattern.test(`${agent.name ?? ''} ${agent.description ?? ''}`));
    if (candidates.length === 1) selected[role] = candidates[0];
    else if (associated.length === 1) selected[role] = associated[0];
    else throw new Error(`Cannot resolve ${role}. Project Agents: ${associated.map(agent => `${agent.name} (${agent.id})`).join(', ') || 'none identified'}. Supply --agents with exact IDs; no arbitrary Agent will be chosen.`);
  }
  return selected;
}

const marker = task => `<!-- tpcowork-automation:${task.key}:v1 -->`;

export function findExisting(issues, task, projectId, parentId = null) {
  const matches = issues.filter(issue => issue.title === task.title);
  if (matches.length > 1) throw new Error(`Multiple issues match ${task.title}; refusing duplicate creation.`);
  if (!matches.length) return undefined;
  const issue = matches[0];
  if (issue.project_id !== projectId || (issue.parent_issue_id || null) !== parentId
    || (issue.stage ?? null) !== task.stage || !issue.description?.includes(marker(task))) {
    throw new Error(`Existing title belongs to a different task tree: ${task.title}.`);
  }
  if (issue.status_category === 'cancelled' || issue.status === 'cancelled') throw new Error(`Existing task ${task.title} is cancelled; resolve it before dispatch.`);
  return issue;
}

export function descriptionOf(manifest, task) {
  const lines = [marker(task), `# ${task.title}`, '',
    `目标工作区：${manifest.workspace}`, `参考源工程：${manifest.source}`, `参考提交：${manifest.sourceRevision}`,
    `Multica 项目：${manifest.project}；职责：${task.role}；阶段：${task.stage ?? '协调'}`,
    `依赖子任务：${task.dependsOn.join('、') || '无'}`, '', '## 工作范围', ...task.scope.map(value => `- ${value}`), '',
    '## 验收标准', ...task.acceptance.map(value => `- ${value}`), '', '## 共同约束', ...manifest.rules.map(value => `- ${value}`), '',
    '## 参考源码（相对参考源工程）', ...task.references.map(value => `- ${value}`), '',
    '## 执行与交付',
    '- 开始前检查依赖子任务已完成；尚未完成时不得直接开始后续阶段。',
    '- 交付说明需写清修改路径、接口、测试命令与结果、限制及后续集成注意事项。',
    '- 主任务协调 Agent 维护共享入口；不要同时写入其他 Agent 拥有的文件。',
    '- 只使用项目既有 Agent。协调 Agent 通过官方 multica CLI 检查 children 和阶段；分配不等于完成，验收后才能关闭任务。'];
  if (task === manifest.parent) {
    lines.push('', '## 子任务列表', ...manifest.tasks.map(child => `- 阶段 ${child.stage}：${child.title}（${child.role}）`),
      '', '## 阶段推进',
      '- 全部子任务最初为 backlog，已分配但未启动。只将当前阶段的任务改为 todo 来启动。',
      '- 使用 issue children 检查整个阶段，全部子任务完成且证据通过后启动下一阶段。',
      '- 相同 Agent 的任务逐个启动；阶段 2/3/4 中不同 Agent 可在约定模块范围内并行。',
      '- 如需变更共享契约，由协调 Agent 更新契约并通知消费者，再继续执行。不得自动合并、发布或提交未知修改。');
  }
  return `${lines.join('\n')}\n`;
}

function runCli(binary, manifest, args, workspaceId) {
  const globalArgs = ['--profile', manifest.profile, ...(workspaceId ? ['--workspace-id', workspaceId] : [])];
  const result = spawnSync(binary, [...globalArgs, ...args], { cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw new Error(`Multica ${args.slice(0, 2).join(' ')} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Multica ${args.slice(0, 2).join(' ')} failed: ${(result.stderr || result.stdout).trim().slice(0, 700)}`);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`Multica ${args.slice(0, 2).join(' ')} did not return JSON; inspect the live CLI before continuing.`); }
}

function issueOf(payload) {
  const issue = [payload, payload?.issue, payload?.data, payload?.data?.issue].find(value => typeof value?.id === 'string');
  if (!issue) throw new Error('No issue ID in creation result. Stop and inspect the project; rerun will check titles before creating.');
  return issue;
}

function saveState(state) {
  const path = resolve(directory, 'dispatch-state.json');
  writeFileSync(`${path}.tmp`, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

export function main(argv = process.argv.slice(2), internals = {}) {
  const log = internals.log ?? console.log;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entries = validateManifest(manifest);
  const option = name => {
    const index = argv.indexOf(name);
    if (index < 0) return undefined;
    if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}.`);
    return argv[index + 1];
  };
  const modes = ['--preview', '--check', '--dispatch'].filter(value => argv.includes(value));
  if (modes.length !== 1 || (argv.includes('--start') && !argv.includes('--dispatch'))) {
    throw new Error('Usage: node scripts/dispatch-automation.mjs --preview|--check|--dispatch [--start] [--agents path]');
  }
  const agentsPath = option('--agents') ?? (existsSync(resolve(directory, 'agents.local.json')) ? resolve(directory, 'agents.local.json') : undefined);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agents') { i++; continue; }
    if (![...modes, '--start'].includes(argv[i])) throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (modes[0] === '--preview') {
    for (const task of entries) log(`${task.key}\tstage=${task.stage ?? 'parent'}\t${task.role}\t${task.title}`);
    return;
  }
  const packaged = '/Applications/Multica.app/Contents/Resources/app.asar.unpacked/resources/bin/multica';
  const binary = process.env.MULTICA_BIN || (existsSync(packaged) ? packaged : 'multica');
  const cli = internals.cli ?? ((args, workspaceId) => runCli(binary, manifest, args, workspaceId));
  const persist = internals.saveState ?? saveState;
  const workspaces = rowsOf(cli(['workspace', 'list', '--output', 'json']), 'workspaces');
  const matches = [];
  for (const workspace of workspaces) {
    if (!workspace.id) throw new Error('Workspace response is missing an ID.');
    for (const project of rowsOf(cli(['project', 'list', '--output', 'json'], workspace.id), 'projects')) {
      if ((project.name ?? project.title) === manifest.project) matches.push({ workspace, project });
    }
  }
  if (matches.length !== 1) throw new Error(`Expected exactly one tpcowork-dsh project; found ${matches.length}. No tasks were created.`);
  const { workspace, project } = matches[0];
  if (!project.id) throw new Error('Project response is missing an ID.');
  const scoped = args => cli(args, workspace.id);
  const issues = [];
  let offset = 0;
  for (;;) {
    const payload = scoped(['issue', 'list', '--project', project.id, '--limit', '100', '--offset', String(offset), '--output', 'json']);
    const page = rowsOf(payload, 'issues');
    issues.push(...page);
    offset += page.length;
    if (payload.has_more === false || payload.data?.has_more === false || page.length < 100) break;
  }
  const agents = rowsOf(scoped(['agent', 'list', '--output', 'json']), 'agents');
  const mapping = selectAgents(agents, project, issues, internals.agentMapping ?? (agentsPath ? JSON.parse(readFileSync(resolve(root, agentsPath), 'utf8')) : {}));
  const existingParent = findExisting(issues, manifest.parent, project.id);
  const existing = new Map([[manifest.parent.key, existingParent]]);
  for (const task of manifest.tasks) existing.set(task.key, findExisting(issues, task, project.id, existingParent?.id ?? null));
  for (const task of entries) {
    const issue = existing.get(task.key);
    if (issue?.assignee_id && (issue.assignee_id !== mapping[task.role].id || issue.assignee_type !== 'agent')) {
      throw new Error(`Existing ${task.title} has a different owner; no reassignment or creation attempted.`);
    }
  }
  log(`Project: ${project.name ?? project.title} (${project.id}); Workspace: ${workspace.name ?? workspace.id}`);
  for (const [role, agent] of Object.entries(mapping)) log(`${role}: ${agent.name} (${agent.id})`);
  if (modes[0] === '--check') {
    log(`Preflight passed: ${entries.filter(task => existing.get(task.key)).length} existing, ${entries.filter(task => !existing.get(task.key)).length} to create. No changes made.`);
    return;
  }
  const state = { projectId: project.id, workspaceId: workspace.id, status: 'creating', issues: {}, updatedAt: new Date().toISOString() };
  persist(state);
  for (const task of entries) {
    let issue = existing.get(task.key);
    if (!issue) {
      const path = resolve(directory, `${task.key}.md`);
      if (internals.writeDescription) internals.writeDescription(path, descriptionOf(manifest, task));
      else writeFileSync(path, descriptionOf(manifest, task));
      const args = ['issue', 'create', '--title', task.title, '--description-file', path, '--project', project.id, '--status', 'backlog', '--priority', 'high', '--output', 'json'];
      if (task.stage !== null) args.push('--parent', state.issues[manifest.parent.key].id, '--stage', String(task.stage));
      issue = issueOf(scoped(args));
    }
    state.issues[task.key] = { id: issue.id, identifier: issue.identifier, title: task.title, role: task.role, stage: task.stage, assigneeId: issue.assignee_id ?? null };
    persist(state);
    log(`${issue.identifier ?? issue.id}: ${task.title}`);
  }
  state.status = 'assigning'; persist(state);
  for (const task of entries) {
    const issue = state.issues[task.key];
    if (!issue.assigneeId) {
      scoped(['issue', 'assign', issue.id, '--to-id', mapping[task.role].id, '--no-start', '--output', 'json']);
      issue.assigneeId = mapping[task.role].id; persist(state);
    }
  }
  for (const task of entries) {
    const actual = issueOf(scoped(['issue', 'get', state.issues[task.key].id, '--output', 'json']));
    if (actual.project_id !== project.id || (actual.parent_issue_id || null) !== (task.stage === null ? null : state.issues[manifest.parent.key].id)
      || (actual.stage ?? null) !== task.stage || actual.assignee_id !== mapping[task.role].id || actual.assignee_type !== 'agent') {
      throw new Error(`Read-back verification failed for ${task.title}; coordinator was not started.`);
    }
  }
  state.status = 'assigned'; persist(state);
  if (argv.includes('--start')) {
    const id = state.issues[manifest.parent.key].id;
    const current = issueOf(scoped(['issue', 'get', id, '--output', 'json']));
    if (current.status === 'backlog') {
      scoped(['issue', 'status', id, 'todo', '--output', 'json']);
      state.status = 'coordinator-start-requested';
    } else {
      log(`Coordinator is already ${current.status}; no restart requested.`);
      state.status = 'coordinator-existing';
    }
    persist(state);
  }
  log(`Dispatch state saved: ${state.status}. Use the coordinator's stage barriers to advance sub-issues.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
