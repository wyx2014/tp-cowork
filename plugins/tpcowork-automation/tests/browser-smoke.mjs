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
  { default: Sessions }, { default: Projections }, { default: SystemPrompt }, { default: Tools }, { default: Skills }, { default: Fs }, { default: WorkingDirectory }] = await Promise.all([
  import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-storage'), import('@deepseek-ai/dsh-storage-domain'), import('@deepseek-ai/dsh-storage-json'),
  import('@deepseek-ai/dsh-typert-registry'), import('@deepseek-ai/dsh-api-gateway'), import(pathToFileURL(resolve(root, 'lib/host.js'))),
  import('@deepseek-ai/dsh-session'), import('@deepseek-ai/dsh-session-projection'), import('@deepseek-ai/dsh-system-prompt'), import('@deepseek-ai/dsh-tools'),
  import('@deepseek-ai/dsh-skill'), import('@deepseek-ai/dsh-fs-local'), import('@deepseek-ai/dsh-working-directory'),
]);
const output = resolve(root, 'test-results/ui-browser'); await mkdir(output, { recursive: true });
const medium = await mkdtemp(resolve(output, '_host-'));
const ctx = new Context(); let server; let browser;
const errors = []; const evidence = [];
try {
  for (const plugin of [Storage, Registry, Gateway, Sessions, Projections, SystemPrompt, Tools, Skills, Fs, WorkingDirectory]) await ctx.plugin(plugin);
  const backend = new JsonStorageBackend(medium);
  ctx.effect(() => ctx.storage.backend.register('ui-browser', backend));
  const facility = new DomainFacility(ctx, { backend: 'ui-browser' }); ctx.provide('storageDomain', facility);
  ctx.effect(() => async () => { await facility.closeAll(); await backend.close(); });
  let serviceFiber = await ctx.plugin(host.AutomationService);
  await ctx.plugin(host.AutomationBindings);
  ctx.skills.register({ name: 'report', description: 'Workspace reports', source: 'runtime', content: 'Never sent to the browser' });
  for (const name of ['mcp__docs__read', 'mcp__mail__read']) ctx.tools.register({ name, description: name,
    parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: value }] }, execute: async () => { throw new Error('not invoked by editor') } });
  const bundle = await build({ entryPoints: [resolve(root, 'tests/fixtures/ui-browser.js')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', write: false, outfile: resolve(output, 'fixture.js'),
    tsconfig: resolve(harness, 'tsconfig.base.json'), loader: { '.css': 'text', '.module.css': 'local-css' }, logLevel: 'warning',
    alias: { react: dirname(requireWeb.resolve('react/package.json')), 'react-dom': dirname(requireWeb.resolve('react-dom/package.json')) },
    nodePaths: [resolve(harness, 'node_modules')],
  });
  const theme = JSON.parse(await readFile(resolve(root, '../tpcowork-ui/theme.json'), 'utf8'));
  const upstreamCss = (await Promise.all(['base.css', 'design-platform.css'].map(file => readFile(resolve(harness, 'packages/client/ui-theme/src/styles', file), 'utf8')))).join('\n');
  const themeCss = ['light', 'dark'].map(mode => `${mode === 'light' ? 'body' : 'body[data-ds-dark-theme]'}{${Object.entries(theme).map(([key, value]) => `${key}:${value[mode]}`).join(';')}}`).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''}\n${upstreamCss}\n${themeCss}\nhtml,body,#app{height:100%;margin:0}body{font:14px/1.6 system-ui}button,input,textarea,select{font-family:inherit}</style></head><body data-tpcowork-ui><div id="app"></div><script>if(new URLSearchParams(location.search).get('theme')==='dark')document.body.setAttribute('data-ds-dark-theme','')</script><script type="module" src="/fixture.js"></script></body></html>`;
  server = createServer(async (request, response) => {
    try {
      if (request.url === '/rpc' || request.url === '/stream') {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const { endpoint, args } = JSON.parse(Buffer.concat(chunks).toString());
        const [namespace, method] = endpoint.split('/');
        if (request.url === '/stream') {
          response.setHeader('Content-Type', 'application/x-ndjson'); response.flushHeaders();
          const lifetime = new AbortController(); response.on('close', () => lifetime.abort());
          try { for await (const value of await ctx.typertGateway.stream({ namespace, method, args, signal: lifetime.signal })) response.write(JSON.stringify({ value }) + '\n'); }
          catch (error) { if (!lifetime.signal.aborted) response.write(JSON.stringify({ error: { message: error.message } }) + '\n'); }
          response.end(); return;
        }
        let result;
        try { result = { ok: true, value: endpoint === 'session/modelCatalog' ? {
          default: { provider: 'test', model: 'standard' }, routableProviders: ['test'], failures: [],
          groups: [{ id: 'test', name: 'Test', models: [{ id: 'standard', name: 'Standard' }, { id: 'reasoner', name: 'Reasoner', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }] }],
        } : endpoint === 'permissionPresets/catalog' ? { defaultPreset: 'workspace-write', defaultOptions: [],
          options: [{ value: 'workspace-write', name: 'Workspace write' }, { value: 'danger-full-access', name: 'Full access' }],
        } : await ctx.typertGateway.invoke({ namespace, method, args }) }; }
        catch (error) { result = { ok: false, error: { code: error.code ?? 'gateway/internal', message: error.message, details: {} } }; }
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result)); return;
      }
      if (request.url === '/projects') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify([
        { workspaceId: 'alpha', title: 'Alpha', path: '/fixture/alpha' }, { workspaceId: 'beta', title: 'Beta', path: '/fixture/beta' },
      ])); return; }
      if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); return; }
      if (request.url === '/client.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(resolve(root, 'lib/client.js'))); return; }
      response.setHeader('Content-Type', 'text/html'); response.end(html);
    } catch (error) { errors.push(String(error)); response.statusCode = 500; response.end('fixture failure'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1080, height: 860 } });
  const open = async selector => {
    const details = page.locator(selector); if (!await details.count()) return;
    if (!await details.evaluate(node => node.open)) await details.locator('summary').click();
  };
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
  for (const locale of ['zh', 'en']) for (const mode of ['light', 'dark']) {
    await page.goto(`${origin}/?locale=${locale}&theme=${mode}`); await page.waitForFunction(() => window.ready === true);
    const heading = locale === 'zh' ? '自动化' : 'Automations';
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    await page.locator('.tp-auto-template').last().waitFor();
    assert.equal(await page.locator('.tp-auto-template').count(), 6);
    const colors = await page.locator('.tp-automation').evaluate(node => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color }));
    assert.notEqual(colors.background, 'rgba(0, 0, 0, 0)'); assert.notEqual(colors.background, colors.color);
    await page.screenshot({ path: resolve(output, `${locale}-${mode}.png`), fullPage: true });
    evidence.push({ locale, mode, colors, screenshot: `${locale}-${mode}.png` });
    if (mode === 'light') {
      for (let index = 0; index < 6; index++) {
        await page.locator('.tp-auto-template').nth(index).click();
        assert.ok((await page.getByRole('textbox', { name: locale === 'zh' ? '指令' : 'Instructions', exact: true }).inputValue()).length > 80);
        assert.equal((await ctx.automation.list()).tasks.length, 0);
        await page.getByRole('button', { name: locale === 'zh' ? '自动化' : 'Automations', exact: true }).click();
      }
    }
    await page.getByRole('button', { name: locale === 'zh' ? '新建任务' : 'New task', exact: true }).click();
    await page.getByRole('heading', { name: locale === 'zh' ? '新建定时任务' : 'New scheduled task', exact: true }).waitFor();
    await page.getByLabel(locale === 'zh' ? '模型' : 'Model', { exact: true }).waitFor({ state: 'attached' });
    assert.equal(await page.locator('.tp-auto-advanced').count(), 0);
    await page.screenshot({ path: resolve(output, `editor-new-${locale}-${mode}.png`), fullPage: true });
    await page.getByRole('button', { name: locale === 'zh' ? '选择项目' : 'Select project', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Beta', exact: true }).waitFor();
    await page.screenshot({ path: resolve(output, `project-menu-${locale}-${mode}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    assert.equal((await ctx.automation.list()).tasks.length, 0);
    assert.deepEqual(await page.evaluate(() => window.fixture.dispose()), { main: 0, sidebar: 0, styles: 0, intervals: 0 });
  }
  evidence.push('12 bilingual template selections cancel without Host writes; four locales/themes release real slots/styles/timers');
  await page.goto(`${origin}/?locale=en&theme=light`); await page.waitForFunction(() => window.ready === true);
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await open('.tp-auto-schedule-picker');
  await page.getByRole('menuitem', { name: 'Once', exact: true }).click();
  assert.equal(await page.getByLabel('Frequency', { exact: true }).inputValue(), 'once');
  assert.equal(await page.getByLabel('Timezone', { exact: true }).count(), 0);
  await page.getByLabel('Task title', { exact: true }).fill('Browser once');
  await page.getByLabel('Instructions', { exact: true }).fill('Review the workspace');
  await open('.tp-auto-schedule-picker');
  await page.getByLabel('Date and time', { exact: true }).fill('2031-01-01T09:30');
  await page.getByRole('button', { name: 'Select project', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Beta', exact: true }).click();
  assert.equal(await page.getByRole('menu').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Select project', exact: true }).innerText(), 'Beta');
  await page.getByLabel('Model', { exact: true }).selectOption(JSON.stringify(['test', 'reasoner']));
  await page.getByLabel('Reasoning effort', { exact: true }).selectOption('high');
  await page.getByLabel('Permissions', { exact: true }).selectOption('danger-full-access');
  await page.getByRole('button', { name: 'Create scheduled task', exact: true }).click();
  await page.getByRole('heading', { name: 'Browser once', exact: true }).waitFor();
  let task = (await ctx.automation.list()).tasks[0];
  assert.deepEqual(task.modelSelection, { provider: 'test', model: 'reasoner', reasoningEffort: 'high' });
  assert.equal(task.permissionPreset, 'danger-full-access');
  assert.equal(task.schedule.frequency, 'once'); assert.equal(task.projectId, 'beta'); assert.equal(task.workspacePath, '/fixture/beta'); assert.equal(task.mcpPresets.length, 0);
  await page.screenshot({ path: resolve(output, 'tasks.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.tp-automation').evaluate(node => node.scrollWidth > node.clientWidth), false);
  await page.screenshot({ path: resolve(output, 'tasks-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1080, height: 860 });
  // Existing tool-created tasks can carry execution bindings hidden by the simplified editor.
  await ctx.automation.update({ id: task.id, data: { name: task.name, prompt: task.prompt, schedule: task.schedule,
    description: 'Saved details', workspacePath: '/fixture/override', skillName: 'report', mcpPresets: [{ name: 'docs' }, { name: 'mail' }] } });
  // Retain a project when editing an unrelated field, then clear it through real JSON/Gateway transport.
  await page.reload(); await page.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.getByLabel('Reasoning effort', { exact: true }).inputValue(), 'high');
  await page.getByLabel('Model', { exact: true }).selectOption('');
  await page.getByLabel('Permissions', { exact: true }).selectOption('');
  await page.getByLabel('Instructions', { exact: true }).fill('Review the updated workspace');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('heading', { name: 'Browser once', exact: true }).waitFor();
  assert.equal((await ctx.automation.list()).tasks[0].projectId, 'beta');
  assert.equal((await ctx.automation.list()).tasks[0].modelSelection, undefined);
  assert.equal((await ctx.automation.list()).tasks[0].permissionPreset, undefined);
  assert.equal((await ctx.automation.list()).tasks[0].description, 'Saved details');
  assert.equal((await ctx.automation.list()).tasks[0].skillName, 'report');
  assert.deepEqual((await ctx.automation.list()).tasks[0].mcpPresets, [{ name: 'docs' }, { name: 'mail' }]);
  await page.reload(); await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Select project', exact: true }).click();
  await page.getByRole('menuitem', { name: 'No project', exact: true }).click();
  const clearingRequest = page.waitForRequest(request => request.url().endsWith('/rpc') && request.postDataJSON()?.endpoint === 'automation/update');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal((await clearingRequest).postDataJSON().args.request.data.projectId, null);
  await page.getByRole('heading', { name: 'Browser once', exact: true }).waitFor();
  task = (await ctx.automation.list()).tasks[0];
  assert.equal(task.projectId, undefined); assert.equal(task.workspacePath, '/fixture/override');
  const storedAfterClear = JSON.parse(await readFile(resolve(medium, 'tpcowork_automation.json'), 'utf8')).tables.tasks[task.id];
  assert.equal(Object.hasOwn(storedAfterClear, 'projectId'), false);
  await serviceFiber.dispose(); serviceFiber = await ctx.plugin(host.AutomationService);
  task = (await ctx.automation.list()).tasks[0];
  assert.equal(task.projectId, undefined); assert.equal(task.workspacePath, '/fixture/override');
  await page.reload(); await page.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Select project', exact: true }).innerText(), 'Select project');
  await page.screenshot({ path: resolve(output, 'project-cleared.png'), fullPage: true });
  await page.getByRole('button', { name: 'Automations', exact: true }).click();
  evidence.push('Project clear sends projectId:null through built Client → Client Gateway → HTTP/JSON → Host Gateway; durable JSON omits projectId, independent workspacePath survives Host reopen and browser reload; unrelated field edits retain beta');

  // A project missing from the current projection stays bound until the user explicitly clears it.
  await ctx.automation.update({ id: task.id, data: { name: task.name, prompt: task.prompt, schedule: task.schedule,
    projectId: 'missing-project', workspacePath: '/fixture/override', skillName: task.skillName, mcpPresets: task.mcpPresets } });
  await page.reload(); await page.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Select project', exact: true }).innerText(), 'Unavailable binding');
  await page.getByRole('button', { name: 'Select project', exact: true }).click();
  assert.equal(await page.getByRole('menuitem', { name: 'Unavailable binding · missing-project', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  await page.getByLabel('Instructions', { exact: true }).fill('Preserve unavailable project');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('heading', { name: 'Browser once', exact: true }).waitFor();
  assert.equal((await ctx.automation.list()).tasks[0].projectId, 'missing-project');
  await page.reload(); await page.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Select project', exact: true }).innerText(), 'Unavailable binding');
  await page.screenshot({ path: resolve(output, 'project-unavailable.png'), fullPage: true });
  await page.getByRole('button', { name: 'Select project', exact: true }).click();
  await page.getByRole('menuitem', { name: 'No project', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('heading', { name: 'Browser once', exact: true }).waitFor();
  assert.equal((await ctx.automation.list()).tasks[0].projectId, undefined);
  assert.equal((await ctx.automation.list()).tasks[0].workspacePath, '/fixture/override');
  evidence.push('Unavailable project renders a warning, survives an unrelated edit and JSON save/reload, and is removed only by explicit No project selection');
  assert.equal((await ctx.automation.list()).tasks[0].skillName, 'report');
  assert.deepEqual((await ctx.automation.list()).tasks[0].mcpPresets, [{ name: 'docs' }, { name: 'mail' }]);
  for (const frequency of ['monthly', 'manual', 'custom']) {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await open('.tp-auto-schedule-picker');
    await page.getByLabel('Frequency', { exact: true }).selectOption(frequency);
    if (frequency === 'monthly') await page.getByLabel('Day of month', { exact: true }).selectOption('31');
    if (frequency === 'custom') { await open('.tp-auto-custom-schedule'); await page.getByLabel('Cron expression', { exact: true }).fill('0 9 * * * 30 2031'); }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('heading', { name: 'Browser once', exact: true }).waitFor();
    await page.reload(); await page.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await page.getByLabel('Frequency', { exact: true }).inputValue(), frequency);
    if (frequency === 'custom') assert.equal(await page.getByLabel('Cron expression', { exact: true }).inputValue(), '0 9 * * * 30 2031');
    await page.getByRole('button', { name: 'Automations', exact: true }).click();
  }
  evidence.push('Built Gateway create/edit/reload: once → monthly day 31 → manual → seven-field custom; native homepage project menu; hidden description/skill/MCP bindings survive edits');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Unsaved browser draft');
  task = (await ctx.automation.list()).tasks[0];
  await ctx.automation.update({ id: task.id, data: { name: 'Remote update', prompt: task.prompt, schedule: task.schedule } });
  await page.waitForResponse(response => response.url().endsWith('/rpc') && response.request().postDataJSON()?.endpoint === 'automation/list');
  assert.equal(await page.getByLabel('Task title', { exact: true }).inputValue(), 'Unsaved browser draft');
  await page.screenshot({ path: resolve(output, 'editor.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.tp-automation').evaluate(node => node.scrollWidth > node.clientWidth), false);
  await page.screenshot({ path: resolve(output, 'editor-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1080, height: 860 });
  await page.getByRole('button', { name: 'Automations', exact: true }).click();
  await page.getByRole('button', { name: 'Ask assistant to create', exact: true }).click();
  assert.equal((await page.evaluate(() => window.assistantNavigation)).options.clearPreviousDraft, false);
  assert.ok((await page.evaluate(() => window.assistantNavigation)).options.prompt.includes('9:00'));
  assert.deepEqual(await page.evaluate(() => window.fixture.dispose()), { main: 0, sidebar: 0, styles: 0, intervals: 0 });
  evidence.push('Host update during a real poll preserves local draft; assistant uses startSession prompt with clearPreviousDraft=false');
  await serviceFiber.dispose(); await ctx.plugin(host.AutomationService);
  assert.equal((await ctx.automation.list()).tasks[0].name, 'Remote update');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: true, evidence, limits: ['Browser shell fixture supplies workspace projection, read-only model/permission catalogs and navigation spies; real Cordis/slots/locale/React/Gateway and built automation are used.', 'No Electron window, external model/MCP network, native takeover or offline install tested.'] }, null, 2) + '\n');
  console.log(`Browser artifact checks pass. Evidence: ${output}`);
} catch (error) {
  for (const page of browser?.contexts().flatMap(context => context.pages()) ?? []) {
    console.error((await page.locator('body').innerText()).slice(0, 1400));
    console.error(await page.evaluate(() => window.fixture?.executionOptions()));
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
  }
  throw error;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await ctx.fiber.dispose(); hook.deregister(); await rm(medium, { recursive: true, force: true });
}
