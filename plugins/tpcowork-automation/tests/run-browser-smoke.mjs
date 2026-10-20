/** Built Client -> real Client Gateway -> HTTP -> built Host Gateway and durable JSON storage. */
import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { readFile, readdir, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const harness = resolve(root, '../../../deepseek-harness');
const requireWeb = createRequire(resolve(harness, 'apps/web/package.json'));
const requireHarness = createRequire(resolve(harness, 'package.json'));
const { chromium } = requireWeb('playwright');
const { build } = createRequire(requireHarness.resolve('tsx/package.json'))('esbuild');
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
      if (target && !key.includes('*')) peers.set(pkg.name + (key === '.' ? '' : key.slice(1)), pathToFileURL(resolve(folder, target)).href);
    }
  }
}
await collect(resolve(harness, 'packages')); await collect(resolve(harness, 'vendor'));
const hook = registerHooks({ resolve(specifier, context, next) { return next(peers.get(specifier) ?? specifier, context); } });
const [{ Context }, { default: Storage }, { DomainFacility }, { JsonStorageBackend }, { default: Registry }, { default: Gateway }, host,
  { default: Llm, LlmAdapter }, { default: Sessions }, { default: Projections }, { default: SystemPrompt }, { default: Tools },
  { default: Agents }, { default: Loop }, { default: Jsonl }, { default: Query }, { default: Workspaces }, { default: Fs },
  { default: WorkingDirectory }, { default: DefaultModel }, { default: Title }, { default: SessionController }, { default: Skills },
  { default: Attachments }] = await Promise.all([
  import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-storage'), import('@deepseek-ai/dsh-storage-domain'), import('@deepseek-ai/dsh-storage-json'),
  import('@deepseek-ai/dsh-typert-registry'), import('@deepseek-ai/dsh-api-gateway'), import(pathToFileURL(resolve(root, 'lib/host.js'))),
  import('@deepseek-ai/dsh-llm'), import('@deepseek-ai/dsh-session'), import('@deepseek-ai/dsh-session-projection'), import('@deepseek-ai/dsh-system-prompt'),
  import('@deepseek-ai/dsh-tools'), import('@deepseek-ai/dsh-agent'), import('@deepseek-ai/dsh-agent-loop'), import('@deepseek-ai/dsh-session-persistence-jsonl'),
  import('@deepseek-ai/dsh-session-query-sqlite'), import('@deepseek-ai/dsh-workspace'), import('@deepseek-ai/dsh-fs-local'),
  import('@deepseek-ai/dsh-working-directory'), import('@deepseek-ai/dsh-agent-default-model'), import('@deepseek-ai/dsh-session-title'),
  import('@deepseek-ai/dsh-api-session-controller'), import('@deepseek-ai/dsh-skill'), import('@deepseek-ai/dsh-attachment-local'),
]);
const output = resolve(root, 'test-results/run-browser'); await mkdir(output, { recursive: true });
const medium = await mkdtemp(resolve(output, '_host-'));
const ctx = new Context(); let browser, server, releaseLive, pauseNext = false, calls = 0;
const errors = [], evidence = [], requests = [], promoted = new Map();
let failCleanup = false, clockOffset = 0;
class Adapter extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(options) {
    calls++;
    const live = pauseNext; pauseNext = false;
    const gate = live ? new Promise((resolveDone, reject) => {
      releaseLive = resolveDone;
      const abort = () => reject(new Error('aborted test stream'));
      if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
    }) : Promise.resolve();
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: live ? 'LIVE_FIRST_CHUNK' : 'DURABLE_HISTORY_RESULT' };
    await gate;
    const text = live ? 'LIVE_FIRST_CHUNK LIVE_FINAL_CHUNK' : 'DURABLE_HISTORY_RESULT';
    if (live) yield { type: 'text-delta', index: 0, text: ' LIVE_FINAL_CHUNK' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
function untilFinished(taskId) {
  let stop, timer;
  const promise = new Promise((resolveDone, reject) => {
    stop = ctx.on('automation/changed', change => { if (change.taskId === taskId && change.reason === 'run_finished') resolveDone(); });
    timer = setTimeout(() => reject(new Error('run did not finish')), 60000);
  });
  return promise.finally(() => { stop(); clearTimeout(timer); });
}
try {
  for (const plugin of [Storage, Registry, Gateway, Llm, Sessions, Projections, SystemPrompt, Tools, Agents, Fs, WorkingDirectory]) await ctx.plugin(plugin);
  const backend = new JsonStorageBackend(resolve(medium, 'storage'));
  ctx.effect(() => ctx.storage.backend.register('runs-browser', backend));
  const domains = new DomainFacility(ctx, { backend: 'runs-browser' }); ctx.provide('storageDomain', domains);
  ctx.effect(() => async () => { await domains.closeAll(); await backend.close(); });
  await ctx.plugin(Jsonl, { root: resolve(medium, 'sessions'), compression: 'zstd' });
  const deleteSession = ctx.sessionPersistence.delete.bind(ctx.sessionPersistence);
  ctx.sessionPersistence.delete = async (...args) => {
    if (failCleanup) { failCleanup = false; throw new Error('injected durable cleanup failure'); }
    return deleteSession(...args);
  };
  await ctx.plugin(Query, { path: resolve(medium, 'query.sqlite'), openAt: 'startup' });
  await ctx.plugin(Workspaces); await ctx.plugin(Skills);
  await ctx.plugin(DefaultModel, { provider: 'existing-user-provider', model: 'existing-user-model' });
  await ctx.plugin(Title, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 });
  await ctx.plugin(Attachments, { dshHome: medium });
  ctx.llm.registerAdapter(['existing-user-provider'], new Adapter());
  await ctx.plugin(Loop, { agents: [] });
  // Capture ordinary cold-resume handles so this test can explicitly release the exact Agents it opens.
  const resume = ctx.agents.resume.bind(ctx.agents);
  ctx.agents.resume = async options => { const handle = await resume(options); promoted.set(handle.agent.id, handle); return handle; };
  // File upload is unused in this suite; production Session history/list/rename and persistence are mounted.
  ctx.provide('fileUploads', { registerAgentResolver: () => () => {} });
  await ctx.plugin(SessionController, { nativeOpen: false });
  let hostFiber = await ctx.plugin(host.default, { clock: { now: () => Date.now() + clockOffset, setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: handle => clearTimeout(handle) } });
  async function create(name, extra = {}) {
    return (await ctx.automation.create({ name, prompt: `Instructions for ${name}`, workspacePath: medium, schedule: { frequency: 'manual' }, ...extra })).tasks.find(task => task.name === name);
  }
  const historyTask = await create('History report', { schedule: { frequency: 'once', at: '2031-01-01T00:00:00Z' } });
  let finished = untilFinished(historyTask.id); await ctx.automation.runNow({ id: historyTask.id }); await finished;
  const historyRun = ctx.automation.getTask(historyTask.id).runs[0];
  assert.equal(ctx.agents.get(historyRun.sessionId), undefined);
  const stored = await ctx.sessionPersistence.open(historyRun.sessionId, 'read');
  try { assert.ok(JSON.stringify((await stored.read()).events).includes('DURABLE_HISTORY_RESULT')); } finally { await stored.close(); }
  const reminder = await create('One reminder', { executionMode: 'reminder', schedule: { frequency: 'once', at: '2031-01-01T00:00:00Z' } });
  finished = untilFinished(reminder.id); await ctx.automation.runNow({ id: reminder.id }); await finished;
  const repeat = await create('Recurring reminder', { executionMode: 'reminder' });
  finished = untilFinished(repeat.id); await ctx.automation.runNow({ id: repeat.id }); await finished;
  for (const reason of ['legacy', 'missing']) {
    clockOffset = reason === 'legacy' ? -2 * 86400000 : 0;
    const task = await create(`${reason} report`);
    const run = await ctx.automation.beginRun({ taskId: task.id, trigger: 'manual' });
    await ctx.automation.finishRun({ taskId: task.id, runId: run.id, status: reason === 'missing' ? 'error' : 'completed',
      resultType: 'conversation', conversationAvailable: false, unavailableReason: reason,
      ...(reason === 'missing' ? { error: 'Historical result is missing' } : {}) });
  }
  clockOffset = 0;
  const phantom = await create('Stale result');
  const phantomRun = await ctx.automation.beginRun({ taskId: phantom.id, trigger: 'manual' });
  await ctx.automation.bindRun({ taskId: phantom.id, runId: phantomRun.id, sessionId: 'does-not-exist', ownsSession: false, conversationAvailable: true });
  await ctx.automation.finishRun({ taskId: phantom.id, runId: phantomRun.id, status: 'completed', resultType: 'conversation', conversationAvailable: true });
  const liveTask = await create('Live report'); pauseNext = true;
  const liveFinished = untilFinished(liveTask.id); await ctx.automation.runNow({ id: liveTask.id });
  // Wait only for this foreground scripted model's first chunk; browser will release it below.
  if (!releaseLive) await new Promise((resolveDone, reject) => {
    const timeout = setTimeout(() => { stop(); reject(new Error('first live chunk unavailable')); }, 10000);
    const stop = ctx.on('agent/assistant-stream', ({ frame }) => { if (frame.type === 'chunk' && releaseLive) { stop(); clearTimeout(timeout); resolveDone(); } });
  });
  const liveRun = ctx.automation.getTask(liveTask.id).runs[0];
  const bundle = await build({ entryPoints: [resolve(root, 'tests/fixtures/ui-run-browser.js')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', write: false, outfile: resolve(output, 'fixture.js'),
    tsconfig: resolve(harness, 'tsconfig.base.json'), loader: { '.css': 'text', '.module.css': 'local-css' }, logLevel: 'warning',
    alias: { react: dirname(requireWeb.resolve('react/package.json')), 'react-dom': dirname(requireWeb.resolve('react-dom/package.json')) },
    nodePaths: [resolve(harness, 'node_modules')],
  });
  const theme = JSON.parse(await readFile(resolve(root, '../tpcowork-ui/theme.json'), 'utf8'));
  const upstreamCss = (await Promise.all(['base.css', 'design-platform.css'].map(file => readFile(resolve(harness, 'packages/client/ui-theme/src/styles', file), 'utf8')))).join('\n');
  const themeCss = ['light', 'dark'].map(mode => `${mode === 'light' ? 'body' : 'body[data-ds-dark-theme]'}{${Object.entries(theme).map(([key, value]) => `${key}:${value[mode]}`).join(';')}}`).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''}\n${upstreamCss}\n${themeCss}\nhtml,body,#app{height:100%;margin:0}body{font:14px/1.6 system-ui}#conversation{padding:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body data-tpcowork-ui><div id="app"></div><div id="conversation"></div><script>if(new URLSearchParams(location.search).get('theme')==='dark')document.body.setAttribute('data-ds-dark-theme','')</script><script type="module" src="/fixture.js"></script></body></html>`;
  server = createServer(async (request, response) => {
    try {
      if (['/rpc', '/stream'].includes(request.url)) {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const { endpoint, args } = JSON.parse(Buffer.concat(chunks).toString()); requests.push(endpoint);
        const [namespace, method] = endpoint.split('/');
        if (request.url === '/stream') {
          response.setHeader('Content-Type', 'application/x-ndjson'); response.flushHeaders();
          const lifetime = new AbortController(); response.on('close', () => lifetime.abort());
          try { for await (const value of await ctx.typertGateway.stream({ namespace, method, args, signal: lifetime.signal })) response.write(JSON.stringify({ value }) + '\n'); }
          catch (error) { if (!lifetime.signal.aborted) response.write(JSON.stringify({ error: { code: error.code ?? 'gateway/internal', message: error.message, details: error.details ?? {} } }) + '\n'); }
          response.end(); return;
        }
        let result;
        try {
          result = { ok: true, value: await ctx.typertGateway.invoke({ namespace, method, args }) };
        } catch (error) { result = { ok: false, error: { code: error.code ?? 'gateway/internal', message: error.message, details: error.details ?? {} } }; }
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result)); return;
      }
      if (request.url === '/projects') { response.setHeader('Content-Type', 'application/json'); response.end('[]'); return; }
      if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); return; }
      if (request.url === '/client.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(resolve(root, 'lib/client.js'))); return; }
      response.setHeader('Content-Type', 'text/html'); response.end(html);
    } catch (error) { errors.push(String(error)); response.statusCode = 500; response.end('fixture failure'); }
  });
  await new Promise(resolveDone => server.listen(0, '127.0.0.1', resolveDone));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1080, height: 940 } }); page.setDefaultTimeout(12000);
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser:', error.message); });
  const row = name => page.locator('tbody tr').filter({ has: page.getByText(name, { exact: true }) });
  const visit = async (locale = 'en', mode = 'light') => {
    await page.goto(`${origin}/?locale=${locale}&theme=${mode}`); await page.waitForFunction(() => window.ready === true);
    await page.getByRole('tab', { name: locale === 'en' ? /Run history/ : /运行记录/ }).click();
    await row('History report').waitFor();
  };
  for (const locale of ['zh', 'en']) for (const mode of ['light', 'dark']) {
    await visit(locale, mode);
    assert.equal(await page.locator('tbody tr').count(), 7);
    assert.equal(await page.getByRole('button', { name: locale === 'en' ? 'Run details' : '运行详情', exact: true }).count(), 0);
    assert.equal(await page.locator('tbody tr').last().locator('.tp-auto-history-task > span').innerText(), 'legacy report');
    await row('Live report').getByRole('button', { name: locale === 'en' ? 'Run actions' : '记录操作', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: locale === 'en' ? 'Delete record' : '删除记录', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: resolve(output, `${locale}-${mode}.png`), fullPage: true });
    evidence.push(`${locale}/${mode}: compact table, seven runs, newest first, direct conversation action, unread excludes live, running deletion disabled`);
    assert.deepEqual(await page.evaluate(() => window.fixture.dispose()), { main: 0, sidebar: 0, styles: 0, intervals: 0 });
  }
  await visit();
  assert.equal(ctx.automation.getTask(liveTask.id).runs[0].viewedAt, undefined);
  await row('Live report').getByRole('button', { name: 'Go to conversation', exact: true }).click();
  await page.getByRole('region', { name: 'Existing result conversation' }).getByText(/LIVE_FIRST_CHUNK/).waitFor();
  assert.equal(await page.evaluate(() => window.openedSession), liveRun.sessionId);
  const refs = await page.evaluate(id => window.fixture.references(id), liveRun.sessionId);
  assert.equal(refs.retainedBy.mainView, 1); assert.equal(refs.retainedBy.automationResult, undefined);
  assert.equal(ctx.automation.getTask(liveTask.id).runs[0].viewedAt, undefined);
  await page.screenshot({ path: resolve(output, 'live-follow.png'), fullPage: true });
  releaseLive(); await liveFinished;
  await page.getByRole('region', { name: 'Existing result conversation' }).getByText(/LIVE_FINAL_CHUNK/).waitFor();
  // Existing five-second poll observes terminal state; it never executes the task.
  await page.waitForFunction(async taskId => {
    const result = await (await fetch('/rpc', { method: 'POST', body: JSON.stringify({ endpoint: 'automation/list', args: {} }) })).json();
    return Boolean(result.value.tasks.find(t => t.id === taskId).runs[0].viewedAt);
  }, liveTask.id);
  await page.evaluate(() => window.fixture.closeConversation());
  evidence.push('Real AgentLoop streamed first/final chunks through Host SessionController follow → HTTP → production ClientSessions; production UiWorkspace retained mainView before automationResult released; running unread preserved, terminal poll persisted read');

  await row('History report').getByRole('button', { name: 'Go to conversation', exact: true }).click();
  await page.getByRole('region', { name: 'Existing result conversation' }).getByText(/DURABLE_HISTORY_RESULT/).waitFor();
  assert.equal(await page.evaluate(() => window.openedSession), historyRun.sessionId);
  assert.ok(ctx.automation.getTask(historyTask.id).runs[0].viewedAt);
  assert.match(await page.getByRole('region', { name: 'Existing result conversation' }).getByRole('heading').innerText(), / - History report$/);
  await page.screenshot({ path: resolve(output, 'cold-history.png'), fullPage: true });
  await page.evaluate(() => window.fixture.closeConversation());
  await page.getByRole('tab', { name: /^Tasks/ }).click(); assert.equal(await page.getByRole('heading', { name: 'History report', exact: true }).count(), 0);
  await page.getByRole('tab', { name: /Run history/ }).click(); await row('History report').waitFor();
  evidence.push('Cold Zstandard JSONL history had no live Agent before open; production controller restored persisted assistant result; standard title durably renamed, once task archived while run remained');

  for (const [name, text] of [['legacy report', 'This older record has no independent result conversation.'], ['missing report', 'The result conversation is missing or no longer available.']]) {
    assert.equal(await row(name).getByRole('button', { name: 'Go to conversation', exact: true }).isDisabled(), true);
    assert.equal(await row(name).getByRole('button', { name: 'Go to conversation', exact: true }).getAttribute('title'), text);
  }
  const createCalls = requests.filter(x => x === 'session/create').length;
  await row('Stale result').getByRole('button', { name: 'Go to conversation', exact: true }).click();
  await page.getByText('Could not open the existing result. It may be missing or temporarily unavailable. Retry or refresh.', { exact: true }).waitFor();
  assert.equal(requests.filter(x => x === 'session/create').length, createCalls);
  assert.equal(await ctx.sessionPersistence.stat('does-not-exist'), undefined);
  await row('One reminder').getByRole('button', { name: 'Confirm', exact: true }).click(); await row('One reminder').waitFor({ state: 'detached' });
  assert.equal((await ctx.automation.list()).tasks.find(t => t.id === reminder.id), undefined);
  await row('Recurring reminder').getByRole('button', { name: 'Confirm', exact: true }).click();
  await row('Recurring reminder').getByRole('button', { name: 'Confirmed', exact: true }).waitFor();
  assert.equal(requests.filter(x => x === 'session/create').length, 0);
  evidence.push('Legacy/missing show reasons without open action; stale explicit result fails visibly without session/create; once reminder removed, recurring reminder confirmed with no conversation');
  await hostFiber.dispose();
  hostFiber = await ctx.plugin(host.default, { clock: { now: () => Date.now() + clockOffset, setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: handle => clearTimeout(handle) } });
  await visit();
  assert.ok(ctx.automation.getTask(historyTask.id).runs[0].viewedAt);
  assert.ok(ctx.automation.getTask(repeat.id).runs[0].viewedAt);
  assert.ok(!(await ctx.automation.list()).tasks.some(t => t.id === reminder.id));
  await row('Recurring reminder').getByRole('button', { name: 'Confirmed', exact: true }).waitFor();
  evidence.push('Automation Host plugin reopened from durable JSON and browser reloaded: read/archive state retained, once reminder stayed removed, recurring confirmation stayed read');


  // Actual active ownership blocks cleanup; after releasing the exact captured Agent the same UI retries.
  assert.ok((await page.evaluate(() => window.fixture.sessionIds())).includes(historyRun.sessionId));
  await row('History report').getByRole('button', { name: 'Run actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete record', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete record', exact: true });
  await dialog.getByRole('button', { name: 'Delete record', exact: true }).click();
  await dialog.getByText('The result conversation is active, its ownership could not be verified, or cleanup failed. The run is kept. Stop related activity and retry; restart the app if needed.', { exact: true }).waitFor();
  assert.ok(await ctx.sessionPersistence.stat(historyRun.sessionId)); assert.ok(ctx.automation.getTask(historyTask.id).runs.length);
  await promoted.get(historyRun.sessionId)?.dispose(); promoted.delete(historyRun.sessionId);
  failCleanup = true;
  const failedDelete = page.waitForResponse(r => r.url().endsWith('/rpc') && r.request().postDataJSON()?.endpoint === 'automation/deleteRun');
  await dialog.getByRole('button', { name: 'Delete record', exact: true }).click();
  await failedDelete;
  assert.ok(await ctx.sessionPersistence.stat(historyRun.sessionId));
  await page.screenshot({ path: resolve(output, 'cleanup-failure.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Delete record', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  await row('History report').waitFor({ state: 'detached' });
  assert.equal(await ctx.sessionPersistence.stat(historyRun.sessionId), undefined);
  assert.ok(!(await page.evaluate(() => window.fixture.sessionIds())).includes(historyRun.sessionId), 'deleted result is removed from the sidebar Session catalog without reloading');
  assert.ok(!(await ctx.sessionQuery.listSessions()).some(item => item.header.id === historyRun.sessionId));
  evidence.push('Actual resumed Agent ownership blocked delete; injected next cleanup failure kept history and Session; retry after releasing captured owner deleted real Zstandard JSONL, query membership, run and the live Client sidebar entry');

  // Editor actions use the same built Client, Gateway and durable Host as global history.
  clockOffset = -3 * 86400000;
  const editorTask = await create('每日 AI 新闻推送', { prompt: '搜索过去 24 小时 AI 领域的重要动态，筛选 5 条真正有影响的信息。每条包含标题、两句摘要、影响判断和来源链接，最后给出今日最值得关注的一条。', schedule: { frequency: 'daily', time: { hour: 9, minute: 0 }, timezone: 'Asia/Shanghai' } });
  const editorSuccess = await ctx.automation.beginRun({ taskId: editorTask.id, trigger: 'manual' });
  await ctx.automation.finishRun({ taskId: editorTask.id, runId: editorSuccess.id, status: 'completed', resultType: 'none', conversationAvailable: false, completedAt: editorSuccess.startedAt + 324000 });
  const editorSkips = [];
  for (const days of [2, 1]) {
    clockOffset = -days * 86400000;
    const run = await ctx.automation.beginRun({ taskId: editorTask.id, trigger: 'manual' }); editorSkips.push(run);
    await ctx.automation.finishRun({ taskId: editorTask.id, runId: run.id, status: 'skipped', resultType: 'none', conversationAvailable: false, skippedReason: 'Computer was asleep', completedAt: run.startedAt });
  }
  clockOffset = 0; await ctx.automation.recomputeSchedules();
  for (const mode of ['light', 'dark']) {
    await page.goto(`${origin}/?locale=zh&theme=${mode}`); await page.waitForFunction(() => window.ready === true);
    await page.getByRole('button', { name: editorTask.name, exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).waitFor();
    await page.screenshot({ path: resolve(output, `editor-settings-${mode}.png`), animations: 'disabled', fullPage: true });
    await page.getByRole('button', { name: '任务操作', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: '暂停', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('menuitem', { name: '删除', exact: true }).isEnabled(), true);
    await page.screenshot({ path: resolve(output, `editor-task-menu-${mode}.png`), animations: 'disabled', fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '历史', exact: true }).click();
    assert.deepEqual(await page.getByRole('columnheader').allTextContents(), ['触发时间', '来源', '状态', '时长', '记录操作']);
    assert.equal(await page.locator('tbody tr').count(), 3);
    assert.equal(await page.getByText('已跳过', { exact: true }).count(), 2);
    assert.equal(await page.getByText('5m 24s', { exact: true }).count(), 1);
    assert.equal(await page.getByRole('searchbox').count(), 0);
    assert.equal(await page.getByRole('button', { name: '立即运行', exact: true }).count(), 0);
    await page.screenshot({ path: resolve(output, `editor-history-${mode}.png`), animations: 'disabled', fullPage: true });
    await page.getByRole('button', { name: '记录操作', exact: true }).first().click();
    assert.equal(await page.getByRole('menuitem', { name: '跳到会话', exact: true }).isDisabled(), true);
    await page.screenshot({ path: resolve(output, `editor-run-menu-${mode}.png`), animations: 'disabled', fullPage: true });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.tp-automation').evaluate(node => node.scrollWidth > node.clientWidth), false);
    await page.screenshot({ path: resolve(output, `editor-history-mobile-${mode}.png`), animations: 'disabled', fullPage: true });
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    assert.equal(await page.locator('.tp-automation').evaluate(node => node.scrollWidth > node.clientWidth), false);
    await page.screenshot({ path: resolve(output, `editor-settings-mobile-${mode}.png`), animations: 'disabled', fullPage: true });
    await page.setViewportSize({ width: 1080, height: 940 });
  }
  await page.getByLabel('任务标题', { exact: true }).fill('每日 AI 新闻推送 · 新指令');
  await page.getByRole('button', { name: '任务操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '暂停', exact: true }).click();
  await page.getByText('已暂停', { exact: true }).waitFor();
  assert.equal(ctx.automation.getTask(editorTask.id).status, 'paused');
  assert.equal(ctx.automation.getTask(editorTask.id).name, editorTask.name);
  await page.getByRole('button', { name: '任务操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '恢复', exact: true }).click();
  await page.getByText('运行中', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('任务标题', { exact: true }).inputValue(), '每日 AI 新闻推送 · 新指令');
  finished = untilFinished(editorTask.id);
  await page.getByRole('button', { name: '立即运行', exact: true }).click(); await finished;
  assert.equal(ctx.automation.getTask(editorTask.id).name, '每日 AI 新闻推送 · 新指令');
  await page.getByRole('tab', { name: '历史', exact: true }).click();
  await page.locator('tbody tr').nth(3).waitFor();
  const executed = ctx.automation.getTask(editorTask.id).runs[0];
  await page.locator(`tr[data-run-id="${executed.id}"]`).getByRole('button', { name: '记录操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '跳到会话', exact: true }).click();
  await page.getByRole('region', { name: 'Existing result conversation' }).getByText(/DURABLE_HISTORY_RESULT/).waitFor();
  assert.equal(await page.evaluate(() => window.openedSession), executed.sessionId);
  assert.ok(ctx.automation.getTask(editorTask.id).runs[0].viewedAt);
  await page.evaluate(() => window.fixture.closeConversation());
  await page.locator(`tr[data-run-id="${editorSkips[0].id}"]`).getByRole('button', { name: '记录操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除记录', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除记录', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(ctx.automation.getTask(editorTask.id).runs.length, 3);
  await page.getByRole('button', { name: '任务操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除任务', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('heading', { name: '已创建任务', exact: true }).waitFor();
  assert.ok(!(await ctx.automation.list()).tasks.some(task => task.id === editorTask.id));
  assert.ok(await ctx.sessionPersistence.stat(executed.sessionId));
  evidence.push('Editor light/dark and 390px screenshots match compact reference table/actions; real pause/resume preserve draft; Run now saves then runs through AgentLoop; row jump opens exact existing Session; row deletion removes one record; task deletion returns to list and retains result conversations');
  assert.deepEqual(ctx.agentDefaultModel.currentSelection(), { provider: 'existing-user-provider', model: 'existing-user-model' });
  assert.deepEqual(await page.evaluate(() => window.fixture.dispose()), { main: 0, sidebar: 0, styles: 0, intervals: 0 });
  for (const handle of promoted.values()) await handle.dispose(); promoted.clear();
  assert.equal(calls, 3); assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: true, evidence, calls, sessionCreateCalls: requests.filter(x => x === 'session/create').length,
    limits: ['External LLM is scripted; native Electron, external MCP, OS restart and offline installation are not exercised.', 'Outer shell/workspace projection, unused file-upload registration and transcript renderer are fixtures; real Host SessionController, ClientSessions and UiWorkspace navigation perform all result opens.', 'Only fault injection simulates persistence failure; active ownership failure and successful deletion use real cleanup/persistence.'] }, null, 2) + '\n');
  console.log(`Run browser checks pass. Evidence: ${output}`);
} catch (error) {
  for (const page of browser?.contexts().flatMap(context => context.pages()) ?? []) {
    console.error((await page.locator('body').innerText()).slice(0, 3500));
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
  }
  throw error;
} finally {
  releaseLive?.(); await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolveDone => server.close(resolveDone)); }
  await ctx.fiber.dispose(); hook.deregister(); await rm(medium, { recursive: true, force: true });
}
