import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { descriptionOf, findExisting, main, rowsOf, selectAgents, validateManifest } from '../dispatch-automation.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../docs/automation-tasks/manifest.json', import.meta.url), 'utf8'));
const project = { id: 'project-1', name: manifest.project };

test('manifest covers ten children with strictly earlier dependency stages', () => {
  assert.equal(validateManifest(manifest).length, 11);
  const invalid = structuredClone(manifest);
  invalid.tasks[0].dependsOn = ['02'];
  assert.throws(() => validateManifest(invalid), /Invalid dependency/);
  for (const task of [manifest.parent, ...manifest.tasks]) {
    assert.match(descriptionOf(manifest, task), /## 验收标准/);
    assert.match(descriptionOf(manifest, task), /默认选择/);
  }
});

test('CLI envelopes are normalized; unknown output is refused', () => {
  const rows = [{ id: 'one' }];
  for (const payload of [rows, { issues: rows }, { data: { issues: rows } }, { items: rows }]) {
    assert.deepEqual(rowsOf(payload, 'issues'), rows);
  }
  assert.throws(() => rowsOf({ success: true }, 'issues'), /Unrecognized/);
});

test('only project-associated active Agents are automatically selected', () => {
  const agent = { id: 'agent-1', name: '项目编码 Agent' };
  const outsiders = [{ id: 'other', name: 'backend coordinator' }];
  const selected = selectAgents([agent, ...outsiders], project, [{ assignee_type: 'agent', assignee_id: agent.id }]);
  assert.equal(selected.coordinator.id, agent.id);
  assert.equal(selected.frontend.id, agent.id);
  assert.throws(() => selectAgents(outsiders, project, []), /Cannot resolve/);
  assert.throws(() => selectAgents([{ ...agent, archived_at: 'now' }], project, [], { coordinator: agent.id }), /active/);
});

test('resume refuses a same-title issue with different ownership or missing marker', () => {
  const task = manifest.tasks[0];
  const issue = { id: 'one', title: task.title, project_id: project.id, parent_issue_id: 'parent', stage: 1, description: descriptionOf(manifest, task) };
  assert.equal(findExisting([issue], task, project.id, 'parent'), issue);
  assert.throws(() => findExisting([{ ...issue, description: '' }], task, project.id, 'parent'), /different task tree/);
  assert.throws(() => findExisting([{ ...issue, stage: 2 }], task, project.id, 'parent'), /different task tree/);
  assert.throws(() => findExisting([issue, issue], task, project.id, 'parent'), /Multiple issues/);
});

function fixture() {
  const issues = [{ id: 'previous', title: 'Existing project work', project_id: project.id, assignee_type: 'agent', assignee_id: 'agent-1' }];
  const calls = [];
  const descriptions = new Map();
  let created = 0;
  const cli = (args) => {
    calls.push(args);
    const value = flag => args[args.indexOf(flag) + 1];
    if (args[0] === 'workspace') return [{ id: 'workspace-1', name: 'Workspace' }];
    if (args[0] === 'project') return [project];
    if (args[0] === 'agent') return [{ id: 'agent-1', name: 'Project Agent' }];
    if (args[1] === 'list') return { issues, has_more: false };
    if (args[1] === 'create') {
      assert.equal(args.includes('--assignee-id'), false);
      assert.equal(value('--status'), 'backlog');
      const issue = { id: `created-${++created}`, title: value('--title'), description: descriptions.get(value('--description-file')), project_id: value('--project'), parent_issue_id: args.includes('--parent') ? value('--parent') : null, stage: args.includes('--stage') ? Number(value('--stage')) : null, status: 'backlog' };
      issues.push(issue); return issue;
    }
    const issue = issues.find(row => row.id === args[2]);
    assert.ok(issue);
    if (args[1] === 'get') return issue;
    if (args[1] === 'assign') {
      assert.equal(created, 11, 'all issues must exist before assigning');
      assert.ok(args.includes('--no-start'));
      issue.assignee_id = value('--to-id'); issue.assignee_type = 'agent'; return issue;
    }
    if (args[1] === 'status') {
      assert.equal(issues.filter(row => row.id !== 'previous' && row.assignee_id).length, 11);
      issue.status = args[3]; return issue;
    }
    throw new Error(`Unexpected call: ${args.join(' ')}`);
  };
  return { issues, calls, internals: { cli, agentMapping: {}, log() {}, saveState() {}, writeDescription(path, text) { descriptions.set(path, text); } } };
}

test('complete tree is created before assignment; only coordinator starts; repeat is idempotent', () => {
  const f = fixture();
  main(['--dispatch', '--start'], f.internals);
  assert.equal(f.calls.filter(args => args[1] === 'create').length, 11);
  assert.equal(f.calls.filter(args => args[1] === 'status').length, 1);
  assert.equal(f.issues.filter(issue => issue.status === 'todo').length, 1);
  main(['--dispatch', '--start'], f.internals);
  assert.equal(f.calls.filter(args => args[1] === 'create').length, 11);
  assert.equal(f.calls.filter(args => args[1] === 'assign').length, 11);
  assert.equal(f.calls.filter(args => args[1] === 'status').length, 1);
});

test('network failure cannot cause mutations or a success state', () => {
  let saved = false;
  assert.throws(() => main(['--dispatch', '--start'], {
    cli(args) { assert.equal(args[0], 'workspace'); throw new Error('Could not resolve'); },
    saveState() { saved = true; },
  }), /Could not resolve/);
  assert.equal(saved, false);
});

test('partial creation resumes without duplicates', () => {
  const f = fixture();
  const original = f.internals.cli;
  let first = true;
  f.internals.cli = args => {
    if (first && args[1] === 'create' && args.includes(manifest.tasks[2].title)) { first = false; throw new Error('Interrupted'); }
    return original(args);
  };
  assert.throws(() => main(['--dispatch', '--start'], f.internals), /Interrupted/);
  assert.equal(f.calls.filter(args => args[1] === 'assign').length, 0);
  main(['--dispatch', '--start'], f.internals);
  assert.equal(f.calls.filter(args => args[1] === 'create').length, 11);
});

test('read-back mismatch prevents coordinator start', () => {
  const f = fixture();
  const original = f.internals.cli;
  f.internals.cli = args => {
    const result = original(args);
    if (args[1] === 'get') return { ...result, stage: 99 };
    return result;
  };
  assert.throws(() => main(['--dispatch', '--start'], f.internals), /Read-back verification/);
  assert.equal(f.calls.filter(args => args[1] === 'status').length, 0);
});

test('preflight never creates, assigns or starts an issue', () => {
  const f = fixture();
  main(['--check'], f.internals);
  assert.equal(f.calls.some(args => ['create', 'assign', 'status'].includes(args[1])), false);
});
