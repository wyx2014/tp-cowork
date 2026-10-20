/** Exercise installable build outputs with DSH peers resolved from this workspace; no profile/config writes. */
import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const harness = resolve(root, '../../../deepseek-harness');
const peers = new Map();
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = resolve(directory, entry.name);
    let pkg;
    try { pkg = JSON.parse(await readFile(resolve(folder, 'package.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') { await collect(folder); continue; } throw error; }
    for (const [key, value] of Object.entries(pkg.exports ?? {})) {
      const target = typeof value === 'string' ? value : value?.default;
      if (!target || key.includes('*')) continue;
      peers.set(pkg.name + (key === '.' ? '' : key.slice(1)), pathToFileURL(resolve(folder, target)).href);
    }
  }
}
await collect(resolve(harness, 'packages'));
await collect(resolve(harness, 'vendor'));
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(peers.get(specifier) ?? specifier, context);
} });
const [{ Context }, { default: Storage }, { DomainFacility }, { JsonStorageBackend }, { default: TypertRegistry }, { default: AutomationService }] = await Promise.all([
  import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-storage'), import('@deepseek-ai/dsh-storage-domain'),
  import('@deepseek-ai/dsh-storage-json'), import('@deepseek-ai/dsh-typert-registry'), import(pathToFileURL(resolve(root, 'lib/host.js'))),
]);
const medium = await mkdtemp(resolve(tmpdir(), 'tpcowork-automation-artifact-'));
const ctx = new Context();
try {
  await ctx.plugin(Storage);
  await ctx.plugin(TypertRegistry);
  const backend = new JsonStorageBackend(medium);
  ctx.effect(() => ctx.storage.backend.register('smoke', backend));
  const facility = new DomainFacility(ctx, { backend: 'smoke' });
  ctx.provide('storageDomain', facility);
  ctx.effect(() => async () => { await facility.closeAll(); await backend.close(); });
  let plugin = await ctx.plugin(AutomationService);
  const created = await ctx.automation.create({ name: '产物测试', prompt: '生成报告', schedule: { frequency: 'manual' } });
  const id = created.tasks[0].id;
  const run = await ctx.automation.beginRun({ taskId: id, trigger: 'manual' });
  await ctx.automation.finishRun({ taskId: id, runId: run.id, status: 'completed', resultType: 'none', conversationAvailable: false });
  await ctx.automation.markRunViewed({ taskId: id, runId: run.id });
  const saved = await ctx.automation.list();
  await plugin.dispose();
  plugin = await ctx.plugin(AutomationService);
  assert.deepEqual(await ctx.automation.list(), saved);
  assert.equal(ctx.typert.local.list().filter(value => value.namespace === 'automation').length, 9);
  assert.equal(ctx.typert.local.list().filter(value => value.namespace === 'automationChanges').length, 1);

  // Exercise the built scheduler/executor contract without a model or external side effects.
  let release, executed;
  const terminal = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { executed = resolve; });
  const detach = await ctx.automation.attachExecutor({
    async execute({ bind }) {
      await bind({ sessionId: 'artifact-independent-session', turnId: 2, ownsSession: true });
      executed();
      return terminal;
    },
    async recover() { return undefined; },
  });
  const admitted = await ctx.automation.runNow({ id });
  assert.equal(admitted.tasks[0].runs[0].status, 'running');
  await started;
  release({ status: 'completed', resultType: 'conversation', conversationAvailable: true });
  await detach(); // waits for the durable terminal commit, not only executor resolution
  const settled = (await ctx.automation.list()).tasks[0].runs[0];
  assert.equal(settled.status, 'completed');
  assert.equal(settled.conversationAvailable, true);
  assert.equal(settled.turnId, 2);

  let registration;
  runInNewContext(await readFile(resolve(root, 'lib/client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { registration = value; } } },
    Intl, Date, AbortController, TextEncoder, TextDecoder, structuredClone,
  });
  assert.equal(registration.id, '@tpcowork/dsh-automation');
  const requireReact = createRequire(resolve(harness, 'packages/client/ui-schedule/package.json'));
  const client = registration.factory(name => {
    // Native primitive rendering is exercised by the browser artifact smoke.
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {};
    assert.equal(name, 'react', 'Client imports only the shared primitives and host React');
    return requireReact(name);
  });
  const catalog = await client.createClient({ list: async () => ({ ok: true, value: { tasks: [], status: { enabled: false, jobs: 0, next_wake_at_ms: null } } }) }).list();
  assert.equal(catalog.tasks.length, 0);
  assert.equal(client.inject.length, 1);
  assert.equal(client.inject[0], 'remote');

  // Production build, real AgentLoop/JSONL/query services; the external model alone is scripted.
  const [{ default: LlmRuntime, LlmAdapter, createUserMessage }, { default: SessionStore }, { default: Projection },
    { default: SystemPrompt }, { default: Tools }, { default: Agents }, { default: Loop },
    { default: JsonlSessions }, { default: Query }, { default: Workspaces }, { default: Fs },
    { default: WorkingDirectory }, { default: DefaultModel }] = await Promise.all([
    import('@deepseek-ai/dsh-llm'), import('@deepseek-ai/dsh-session'), import('@deepseek-ai/dsh-session-projection'),
    import('@deepseek-ai/dsh-system-prompt'), import('@deepseek-ai/dsh-tools'), import('@deepseek-ai/dsh-agent'),
    import('@deepseek-ai/dsh-agent-loop'), import('@deepseek-ai/dsh-session-persistence-jsonl'),
    import('@deepseek-ai/dsh-session-query-sqlite'), import('@deepseek-ai/dsh-workspace'),
    import('@deepseek-ai/dsh-fs-local'), import('@deepseek-ai/dsh-working-directory'), import('@deepseek-ai/dsh-agent-default-model'),
  ]);
  let calls = 0;
  class Adapter extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model }; }
    async *stream(options) {
      calls++;
      if (calls === 3 || calls === 5) {
        const callId = `artifact-followup-${calls}`;
        const argumentsJson = JSON.stringify({ action: 'add', name: calls === 3 ? '产物用户后续提醒' : '产物递归提醒',
          message: 'artifact follow-up reminder', mode: 'reminder', at: new Date(Date.now() + 3_600_000).toISOString() });
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id: callId, name: 'cron', argumentsDelta: argumentsJson };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'cron', arguments: argumentsJson } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
        return;
      }
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'artifact result' };
      if (calls === 2) {
        await new Promise((_, reject) => {
          const abort = () => reject(new Error('aborted'));
          if (options.signal.aborted) abort();
          else options.signal.addEventListener('abort', abort, { once: true });
        });
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'artifact result' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  for (const plugin of [LlmRuntime, SessionStore, Projection, SystemPrompt, Tools, Agents, Fs, WorkingDirectory]) await ctx.plugin(plugin);
  await ctx.plugin(JsonlSessions, { root: resolve(medium, 'sessions'), compression: 'zstd' });
  await ctx.plugin(Query, { path: resolve(medium, 'query.sqlite'), openAt: 'startup' });
  await ctx.plugin(Workspaces);
  await ctx.plugin(DefaultModel, { provider: 'artifact-user', model: 'selected-model' });
  ctx.llm.registerAdapter(['artifact-user'], new Adapter());
  await ctx.plugin(Loop, { agents: [] });
  await plugin.dispose();
  plugin = await ctx.plugin(AutomationService);
  assert.equal((await ctx.automation.list()).status.enabled, true);
  const sourceHandle = await ctx.agents.create({ sessionId: 'artifact-chat-source', meta: { cwd: medium },
    agentOptions: { provider: 'artifact-user', model: 'selected-model' } });
  assert.ok(ctx.tools.schemas(sourceHandle.agent).some(tool => tool.name === 'cron'));
  const chatResult = await ctx.tools.execute({ name: 'cron', callId: 'artifact-chat-create', agent: sourceHandle.agent,
    arguments: { action: 'add', message: 'artifact reminder', mode: 'reminder', at: new Date(Date.now() + 3_600_000).toISOString() },
    signal: new AbortController().signal });
  assert.equal(chatResult.isError, false);
  assert.ok(chatResult.value.includes('Created job'));
  const reminder = (await ctx.automation.list()).tasks.find(task => task.originSessionId === sourceHandle.agent.id);
  assert.equal(reminder.executionMode, 'reminder');
  let reminderTimer, removeReminderListener;
  const reminderDone = new Promise((resolveDone, reject) => {
    removeReminderListener = ctx.on('automation/changed', change => {
      if (change.taskId === reminder.id && change.reason === 'run_finished') { resolveDone(); }
    });
    reminderTimer = setTimeout(() => reject(new Error('built reminder did not settle')), 10000);
  });
  try {
    await ctx.automation.runNow({ id: reminder.id });
    await reminderDone;
  } finally { clearTimeout(reminderTimer); removeReminderListener(); }
  const reminderRun = ctx.automation.getTask(reminder.id).runs[0];
  assert.equal(reminderRun.resultType, 'none');
  assert.equal(reminderRun.sessionId, undefined);
  assert.equal(calls, 0);
  await ctx.automation.markRunViewed({ taskId: reminder.id, runId: reminderRun.id });
  assert.ok(!(await ctx.automation.list()).tasks.some(task => task.id === reminder.id));
  await sourceHandle.dispose();
  const task = (await ctx.automation.create({ name: '真实运行', prompt: 'report', workspacePath: medium,
    schedule: { frequency: 'manual' } })).tasks[0];
  const actualRuns = [];
  for (const cancel of [false, true]) {
    let timer;
    const finished = new Promise((resolveDone, reject) => {
      const remove = ctx.on('automation/changed', change => {
        if (change.taskId !== task.id) return;
        const run = ctx.automation.getTask(task.id).runs[0];
        if (cancel && change.reason === 'run_bound' && run.conversationAvailable) {
          // Cancellation after delivery is scheduled by the first live model chunk below.
          assert.equal(run.resultType, 'conversation');
        }
        if (change.reason === 'run_finished') { remove(); resolveDone(run); }
      });
      timer = setTimeout(() => { remove(); reject(new Error('built executor did not settle')); }, 10000);
    });
    const removeStream = ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (cancel && frame.type === 'chunk' && ctx.automation.getTask(task.id).runs[0]?.sessionId === agent.id) agent.cancel({ kind: 'user' });
    });
    try {
      const catalog = await ctx.automation.runNow({ id: task.id });
      const admitted = catalog.tasks.find(value => value.id === task.id).runs[0];
      assert.equal(admitted.status, 'running');
      const run = await finished;
      assert.equal(run.id, admitted.id);
      assert.equal(run.status, cancel ? 'error' : 'completed');
      if (cancel) assert.equal(run.errorCode, 'run_interrupted');
      assert.equal(run.conversationAvailable, true);
      assert.equal(ctx.agents.get(run.sessionId), undefined);
      const handle = await ctx.sessionPersistence.open(run.sessionId, 'read');
      try {
        const events = (await handle.read()).events;
        assert.ok(events.some(event => event.type === 'turn/end' && event.data.turn === run.turnId));
        assert.ok(events.some(event => event.type === 'request/header' && event.data.header.config.provider === 'artifact-user'));
      } finally { await handle.close(); }
      actualRuns.push(run);
    } finally { clearTimeout(timer); removeStream(); }
  }
  assert.notEqual(actualRuns[0].sessionId, actualRuns[1].sessionId);
  const resumed = await ctx.agents.resume({ resumeSessionId: actualRuns[0].sessionId,
    agentOptions: { provider: 'artifact-user', model: 'selected-model' } });
  try {
    resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: '请创建一小时后的一次提醒。' }], source: { kind: 'user' } }));
    await resumed.agent.whenIdle();
    assert.ok((await ctx.automation.list()).tasks.some(item => item.name === '产物用户后续提醒'));
    resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: '继续自动执行' }],
      source: { kind: 'tpcowork-automation', taskId: task.id, runId: actualRuns[0].id } }));
    await resumed.agent.whenIdle();
    assert.ok(!(await ctx.automation.list()).tasks.some(item => item.name === '产物递归提醒'));
    assert.ok(JSON.stringify(resumed.agent.session.snapshotEvents()).includes('不能在自动化运行'));
    assert.ok(resumed.agent.session.snapshotEvents().some(event => event.type === 'plugin:tpcowork-automation/run' && event.ignorable));
    assert.equal(calls, 6);
  } finally { await resumed.dispose(); }
  // Delete the other independent result; the first now owns the user's follow-up task origin.
  const deletedId = actualRuns[1].sessionId;
  using cached = await ctx.sessionQuery.observeSession(deletedId);
  await ctx.sessionQuery.searchSessions({ query: 'report' });
  const afterDelete = await ctx.automation.deleteRun({ taskId: task.id, runId: actualRuns[1].id });
  assert.ok(!afterDelete.tasks.find(item => item.id === task.id).runs.some(run => run.id === actualRuns[1].id));
  assert.equal(await ctx.sessionPersistence.stat(deletedId), undefined);
  assert.ok(!(await ctx.sessionPersistence.list()).some(item => item.header.id === deletedId));
  assert.ok(!(await ctx.sessionQuery.listSessions()).some(item => item.header.id === deletedId));
  assert.ok(!(await ctx.sessionQuery.searchSessions({ query: 'report' })).items.some(item => item.header.id === deletedId));
  await assert.rejects(ctx.sessionQuery.observeSession(deletedId));
  await assert.rejects(ctx.agents.resume({ resumeSessionId: deletedId }));
  assert.ok(await ctx.sessionPersistence.stat(actualRuns[0].sessionId));
  assert.deepEqual(ctx.agentDefaultModel.currentSelection(), { provider: 'artifact-user', model: 'selected-model' });
  console.log('Artifact smoke passes: built Host/Client and chat tools, real AgentLoop success/cancel, desktop Zstandard JSONL deletion, cache/search/resume removal, independent Sessions, current-turn recursion guard and preserved model choice.');
} finally {
  await ctx.fiber.dispose();
  hook.deregister();
  await rm(medium, { recursive: true, force: true });
}
