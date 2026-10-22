/** Built Host and Client over HTTP/JSON streams, plus optional real Electron native notification delivery. */
import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { readFile, readdir, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), harness = resolve(root, '../../../deepseek-harness');
const nativeClick = process.argv.includes('--native-click');
const requireWeb = createRequire(resolve(harness, 'apps/web/package.json')), requireHarness = createRequire(resolve(harness, 'package.json'));
const { chromium, _electron } = requireWeb('playwright');
const { build } = createRequire(requireHarness.resolve('tsx/package.json'))('esbuild');
const peers = new Map();
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = resolve(directory, entry.name); let pkg;
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
const [{ Context }, { default: Storage }, { DomainFacility }, { JsonStorageBackend }, { default: Registry }, { default: Gateway }, host] = await Promise.all([
  import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-storage'), import('@deepseek-ai/dsh-storage-domain'), import('@deepseek-ai/dsh-storage-json'),
  import('@deepseek-ai/dsh-typert-registry'), import('@deepseek-ai/dsh-api-gateway'), import(pathToFileURL(resolve(root, 'lib/host.js'))),
]);
const output = resolve(root, 'test-results/sync-browser'); await mkdir(output, { recursive: true });
const medium = await mkdtemp(resolve(output, '_host-'));
const ctx = new Context(), streams = new Set(), errors = [], evidence = []; let server, browser, electron, serviceFiber, calls = 0;
let nativeAttempt;
let suppressPush = false;
try {
  for (const plugin of [Storage, Registry, Gateway]) await ctx.plugin(plugin);
  const backend = new JsonStorageBackend(medium); ctx.effect(() => ctx.storage.backend.register('sync', backend));
  const facility = new DomainFacility(ctx, { backend: 'sync' }); ctx.provide('storageDomain', facility);
  ctx.effect(() => async () => { await facility.closeAll(); await backend.close(); });
  serviceFiber = await ctx.plugin(host.AutomationService);
  const create = async (name, extra = {}) => (await ctx.automation.create({ name, prompt: 'Private instructions must not ride invalidations', schedule: { frequency: 'manual' }, ...extra })).tasks.find(task => task.name === name);
  const begin = task => ctx.automation.beginRun({ taskId: task.id, trigger: 'manual' });
  const finish = (task, run, status = 'completed') => ctx.automation.finishRun({ taskId: task.id, runId: run.id, status, resultType: 'none', conversationAvailable: false });
  const history = await create('Old history'); await finish(history, await begin(history));
  const task = await create('Cross-page report'), failed = await create('Failed report');
  const bundle = await build({ entryPoints: [resolve(root, 'tests/fixtures/ui-sync-browser.js')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', write: false, outfile: resolve(output, 'fixture.js'),
    tsconfig: resolve(harness, 'tsconfig.base.json'), loader: { '.css': 'text', '.module.css': 'local-css' }, logLevel: 'warning',
    alias: { react: dirname(requireWeb.resolve('react/package.json')), 'react-dom': dirname(requireWeb.resolve('react-dom/package.json')) }, nodePaths: [resolve(harness, 'node_modules')],
  });
  const theme = JSON.parse(await readFile(resolve(root, '../tpcowork-ui/theme.json'), 'utf8'));
  const css = await readFile(resolve(harness, 'packages/client/ui-theme/src/styles/design-platform.css'), 'utf8');
  const themeCss = `body{${Object.entries(theme).map(([key, value]) => `${key}:${value.light}`).join(';')}}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''}\n${css}\n${themeCss}\nhtml,body,#app{height:100%;margin:0}body{font:14px/1.6 system-ui}</style></head><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>`;
  server = createServer(async (request, response) => {
    try {
      if (request.url === '/rpc' || request.url === '/stream') {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const { endpoint, args } = JSON.parse(Buffer.concat(chunks).toString()), [namespace, method] = endpoint.split('/');
        if (request.url === '/stream') {
          const lifetime = new AbortController(); streams.add(response); response.on('close', () => { streams.delete(response); lifetime.abort(); });
          response.setHeader('Content-Type', 'application/x-ndjson'); response.flushHeaders();
          try {
            for await (const value of await ctx.typertGateway.stream({ namespace, method, args, signal: lifetime.signal })) {
              if (!suppressPush || value.type === 'ready') response.write(JSON.stringify({ value }) + '\n');
            }
          } catch (error) { if (!lifetime.signal.aborted) response.write(JSON.stringify({ error: { message: error.message } }) + '\n'); }
          response.end(); return;
        }
        calls++;
        let result;
        try { result = { ok: true, value: namespace === 'automationBindings' ? { skills: [], connectors: [], skillsAvailable: false } : await ctx.typertGateway.invoke({ namespace, method, args }) }; }
        catch (error) { result = { ok: false, error: { code: error.code ?? 'gateway/internal', message: error.message, details: {} } }; }
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result)); return;
      }
      if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); return; }
      if (request.url === '/client.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(resolve(root, 'lib/client.js'))); return; }
      response.setHeader('Content-Type', 'text/html'); response.end(html);
    } catch (error) { errors.push(String(error)); response.statusCode = 500; response.end('fixture failure'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } }); page.setDefaultTimeout(12000);
  // The desktop shell's notification bridge: results arrive as system notifications, never as page UI.
  await page.addInitScript(() => {
    window.shownNotifications = [];
    window.dshDesktop = { notifications: {
      show: notification => { window.shownNotifications.push(notification); return Promise.resolve(true); },
      subscribe: listener => { window.clickNotification = listener; return () => { window.clickNotification = undefined; }; },
    } };
  });
  const shown = body => page.evaluate(text => window.shownNotifications.filter(notification => notification.body === text), body);
  const waitShown = body => page.waitForFunction(text => window.shownNotifications.some(notification => notification.body === text), body);
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
  page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') console.error('Browser console:', message.text()); });
  await page.goto(origin); await page.waitForFunction(() => window.ready && window.streamFrames.some(frame => frame.type === 'ready'));
  await page.getByRole('heading', { name: 'Cross-page report', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.shownNotifications), []);
  await page.evaluate(() => window.fixture.leave()); await page.locator('[data-other-panel]').waitFor();
  const run = await begin(task);
  await ctx.automation.bindRun({ taskId: task.id, runId: run.id, sessionId: 'allocated-only', ownsSession: false });
  await page.waitForFunction(() => window.streamFrames.some(frame => frame.change?.reason === 'run_bound'));
  assert.deepEqual(await page.evaluate(() => window.shownNotifications), []);
  await finish(task, run);
  await waitShown('Cross-page report');
  assert.deepEqual(await shown('Cross-page report'), [{ id: `automation:${run.id}`, key: `automation:${run.id}`, title: 'Automation completed', body: 'Cross-page report' }]);
  assert.equal(await page.locator('[role="status"]').count(), 0);
  await page.screenshot({ path: resolve(output, 'off-page.png'), fullPage: true });
  await ctx.parallel('automation/changed', { revision: 1, taskId: task.id, runId: run.id, reason: 'run_finished' });
  await page.evaluate(() => window.fixture.reconnect());
  await page.waitForFunction(() => window.streamFrames.filter(frame => frame.change?.reason === 'run_finished').length >= 2);
  assert.equal((await shown('Cross-page report')).length, 1);
  await page.evaluate(id => window.clickNotification(id), `automation:${run.id}`);
  await page.getByRole('heading', { name: / - Cross-page report$/ }).waitFor();
  await page.getByRole('button', { name: 'Confirm', exact: true }).waitFor();
  assert.equal((await ctx.automation.list()).tasks.find(item => item.id === task.id).runs[0].viewedAt, undefined);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).waitFor({ state: 'hidden' });
  const viewedAt = (await ctx.automation.list()).tasks.find(item => item.id === task.id).runs[0].viewedAt; assert.ok(viewedAt);
  evidence.push('Initial history silent; run_bound is not terminal; off-page Host finish sends a single system notification and no page UI; duplicate revision/reconnect cannot re-alert; click opens exact task/run and none awaits explicit confirmation.');
  // A second Client's acknowledgement/deletion must invalidate the first Client's shared catalog.
  const second = await browser.newPage();
  await second.goto(origin); await second.waitForFunction(() => window.ready && window.streamFrames.some(frame => frame.type === 'ready'));
  await second.evaluate(async target => { const result = await window.fixture.remote.automation.markRunViewed(target); if (!result.ok) throw result.error; }, { taskId: task.id, runId: run.id });
  assert.equal((await ctx.automation.list()).tasks.find(item => item.id === task.id).runs[0].viewedAt, viewedAt);
  await second.evaluate(async target => { const result = await window.fixture.remote.automation.deleteRun(target); if (!result.ok) throw result.error; }, { taskId: task.id, runId: run.id });
  await page.getByText('This run is no longer in the retained history.', { exact: true }).waitFor();
  assert.equal(await page.locator('.tp-auto-run-detail').count(), 0);
  await second.evaluate(() => window.fixture.dispose()); await second.close();
  evidence.push('A second real Client acknowledges without moving viewedAt, then deletes via Gateway; first Client drops its selected detail from Host invalidation without resurrecting the run.');
  await page.evaluate(() => window.fixture.leave()); suppressPush = true;
  await finish(failed, await begin(failed), 'error');
  await waitShown('Failed report');
  assert.equal((await shown('Failed report'))[0].title, 'Automation failed'); suppressPush = false;
  evidence.push('Missing push delivery still reports a new error through the two-second global read fallback.');
  for (const stream of streams) stream.destroy();
  await serviceFiber.dispose(); serviceFiber = await ctx.plugin(host.AutomationService);
  const newTask = await create('After Host restart'); await finish(newTask, await begin(newTask));
  await waitShown('After Host restart');
  await page.waitForFunction(() => window.streamFrames.filter(frame => frame.type === 'ready').length >= 2);
  assert.equal((await shown('Cross-page report')).length, 1);
  evidence.push('Gateway stream reconnects after actual HTTP carrier loss and Host reactivation; revision reset does not replay old results.');
  if (process.argv.includes('--electron') || nativeClick) {
    const nativeTask = await create('TPCO-9 native delivery');
    const previousNativeRun = await begin(nativeTask); await finish(nativeTask, previousNativeRun);
    const requireDesktop = createRequire(resolve(harness, 'apps/desktop/package.json'));
    const electronEntry = resolve(root, 'tests/fixtures/native-notification.cjs');
    electron = await _electron.launch({ executablePath: requireDesktop('electron'), args: [electronEntry, ...(nativeClick ? ['--native-click'] : []), origin, resolve(medium, 'electron-profile')], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, timeout: 20000 });
    const nativePage = await electron.firstWindow({ timeout: 20000 }); nativePage.setDefaultTimeout(15000);
    nativePage.on('pageerror', error => errors.push(error.message));
    nativePage.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') console.error('Electron console:', message.text()); });
    await nativePage.waitForFunction(() => window.ready && window.streamFrames.some(frame => frame.type === 'ready'));
    await nativePage.getByRole('heading', { name: 'After Host restart', exact: true }).waitFor();
    assert.equal(await nativePage.evaluate(() => Notification.permission), 'granted');
    await nativePage.evaluate(() => window.fixture.leave());
    let focusBefore;
    if (nativeClick) {
      focusBefore = await electron.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]; window.blur(); return window.isFocused();
      });
      assert.equal(focusBefore, false);
    }
    const nativeRun = await begin(nativeTask);
    nativeAttempt = { at: new Date().toISOString(), clickRequired: nativeClick, taskId: nativeTask.id, runId: nativeRun.id, previousRunId: previousNativeRun.id, focusBefore };
    await finish(nativeTask, nativeRun);
    await nativePage.waitForFunction(() => window.nativeEvents.some(event => event.type === 'show')).catch(async error => {
      const probe = await electron.evaluate(async ({ Notification }) => {
        const events = [], supported = Notification.isSupported();
        const notice = new Notification({ title: 'TPCO-9 native diagnostic', body: 'Temporary delivery validation' });
        notice.on('show', () => events.push('show')); notice.on('failed', (_event, message) => events.push(`failed:${message}`));
        notice.show();
        await new Promise(done => setTimeout(done, 2500)); notice.close();
        return { supported, events };
      });
      await writeFile(resolve(output, 'native-main-probe.json'), JSON.stringify(probe, null, 2)); console.error('Native main probe:', probe); throw error;
    });
    let clickEvidence;
    if (nativeClick) {
      console.log('Native notification shown. Click the macOS banner for TPCO-9 native delivery within 120 seconds.');
      await nativePage.waitForFunction(tag => window.nativeEvents.some(event => event.type === 'click' && event.trusted && event.tag === tag), `automation:${nativeRun.id}`, { timeout: 120000 });
      const detail = nativePage.locator('.tp-auto-run-detail'); await detail.waitFor();
      assert.equal(await detail.getAttribute('data-task-id'), nativeTask.id);
      assert.equal(await detail.getAttribute('data-run-id'), nativeRun.id);
      assert.notEqual(nativeRun.id, previousNativeRun.id);
      const focused = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused());
      assert.equal(focused, true);
      assert.equal((await ctx.automation.list()).tasks.find(item => item.id === nativeTask.id).runs.find(item => item.id === nativeRun.id).viewedAt, undefined);
      clickEvidence = { trusted: true, taskId: nativeTask.id, runId: nativeRun.id, previousRunId: previousNativeRun.id, focusBefore, focused, confirmationRequired: true };
      await nativePage.screenshot({ path: resolve(output, 'native-click-detail.png') });
    }
    const nativeEvents = await nativePage.evaluate(() => window.nativeEvents);
    assert.equal(nativeEvents.filter(event => event.type === 'constructed').length, 1);
    assert.equal(nativeEvents.some(event => event.type === 'error'), false);
    await nativePage.screenshot({ path: resolve(output, 'electron-toast.png') });
    await writeFile(resolve(output, 'native-events.json'), JSON.stringify({ electron: await electron.evaluate(({ app }) => ({ version: process.versions.electron, name: app.name })), nativeEvents, clickEvidence }, null, 2));
    assert.deepEqual(await nativePage.evaluate(() => window.fixture.dispose()), { main: 0, overlay: 0, intervals: 0, services: false, styles: 0 });
    await electron.close(); electron = undefined;
    evidence.push(nativeClick ? 'A trusted OS notification click focused the previously unfocused Electron window and selected the exact task/run among multiple runs; none still requires explicit confirmation. Plugin disposal closes native handles.' : 'Real Electron Chromium Notification constructed and emitted native show (no API spy or permission request); plugin disposal closes native handles. Native OS banner click was not exercised.');
  }
  assert.deepEqual(await page.evaluate(() => window.fixture.dispose()), { main: 0, overlay: 0, intervals: 0, services: false, styles: 0 });
  const callsAfterDispose = calls; await finish(newTask, await begin(newTask));
  assert.equal(calls, callsAfterDispose);
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: true, evidence, limits: ['Outer main-panel layout is a fixture; real slots, React, locale, Connection, Gateway, built plugin and JSON storage execute.', 'Host terminal operations are controlled; complete real AgentLoop/session behavior is covered by run-browser-smoke.', 'Native show requires --electron or --native-click. A trusted system banner click and focus/identity assertions require --native-click.'] }, null, 2));
  console.log(`Synchronization checks pass. ${output}`);
} catch (error) {
  for (const page of electron?.windows() ?? []) {
    const native = await page.evaluate(() => ({ ready: window.ready, permission: Notification.permission, nativeEvents: window.nativeEvents, frames: window.streamFrames, body: document.body.innerText }));
    console.error('Native diagnostics:', native);
    const cleanup = native.ready ? await page.evaluate(() => window.fixture.dispose()) : undefined;
    await writeFile(resolve(output, 'native-failure.json'), JSON.stringify({ attempt: nativeAttempt, ...native, cleanup }, null, 2));
  }
  for (const page of browser?.contexts().flatMap(context => context.pages()) ?? []) console.error(await page.evaluate(() => ({ ready: window.ready, frames: window.streamFrames, body: document.body.innerText })));
  throw error;
} finally {
  await electron?.close(); await browser?.close();
  for (const stream of streams) stream.destroy();
  if (server) await new Promise(done => server.close(done));
  await ctx.fiber.dispose(); hook.deregister(); await rm(medium, { recursive: true, force: true });
}
