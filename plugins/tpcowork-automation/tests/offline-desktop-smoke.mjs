/** Exercise the complete offline kit's Electron shell and production Host/Client, using a test-owned home. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, join, dirname } from 'node:path';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kit = resolve(process.argv[2]), home = resolve(process.argv[3]);
const mode = process.argv[4] ?? 'create';
assert.ok(['create', 'retained', 'removed'].includes(mode));
const { _electron } = createRequire(join(plugin, '../../../deepseek-harness/apps/web/package.json'))('playwright');
const requireKit = createRequire(join(kit, 'runtime/package.json'));
const desktop = dirname(requireKit.resolve('@deepseek-ai/dsh-desktop/package.json'));
const output = resolve(plugin, 'test-results/offline', mode);
await mkdir(output, { recursive: true });
await mkdir(home, { recursive: true });
const userData = await mkdtemp(join(home, 'test-electron-'));
const name = `Offline reminder ${Date.now()}`;
let app, forced = false;
try {
  app = await _electron.launch({ executablePath: requireKit('electron'), args: [desktop, `--user-data-dir=${userData}`], cwd: kit,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
      DSH_DESKTOP_DSH_DIR: join(kit, 'runtime'), DSH_DESKTOP_PNPM_ENTRY: join(kit, 'runtime/node_modules/pnpm/bin/pnpm.mjs'),
      DSH_DESKTOP_PRIMARY_RUNTIME_DIR: join(kit, 'support/primary-runtime'), DSH_DESKTOP_OPEN_DEVTOOLS: '0' }, timeout: 30000 });
  const redact = bytes => bytes.toString().replace(/token=[^\s&]+/g, 'token=[redacted]');
  app.process().stdout?.on('data', data => process.stdout.write(redact(data)));
  app.process().stderr?.on('data', data => process.stderr.write(redact(data)));
  const deadline = Date.now() + 30000;
  let page;
  while (Date.now() < deadline) {
    page = app.windows().find(candidate => candidate.url().startsWith('dsh-app://app'));
    if (page && await page.evaluate(() => !!document.querySelector('button')).catch(() => false)) break;
    await new Promise(done => setTimeout(done, 200));
  }
  assert.ok(page, 'Production application window did not load');
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByText(/Automations|自动化|Schedules|提醒/, { exact: true }).first().click();
  if (mode === 'removed') {
    assert.equal(await page.locator('[data-automation-surface]').count(), 0);
    await page.getByRole('button', { name: /New task|新建任务/, exact: true }).waitFor({ state: 'hidden' });
  } else {
    await page.locator('[data-automation-surface]').waitFor();
    if (mode === 'create') {
      await page.getByRole('button', { name: /New task|新建任务/, exact: true }).click();
      await page.getByLabel(/^(Name|名称)$/).fill(name);
      await page.getByLabel(/^(Instructions|执行指令)$/).fill('Offline packaging verification');
      await page.getByLabel(/^(Execution mode|执行方式)$/).selectOption('reminder');
      await page.getByLabel(/^(Frequency|频率)$/).selectOption('manual');
      await page.getByRole('button', { name: /^(Save|保存)$/ }).click();
      const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
      await card.getByRole('button', { name: /^(Run now|立即运行)$/ }).click();
    }
    await page.getByRole('tab', { name: /运行记录|Runs/ }).click();
    const run = page.locator('article[data-run-id]').filter({ hasText: mode === 'create' ? name : 'Offline reminder' }).first();
    await run.waitFor();
    await run.getByText(/已完成|Completed/, { exact: true }).waitFor();
    await run.getByText(/仅提醒，确认后|Reminder only/).waitFor();
    assert.equal(await run.getByRole('button', { name: /^(Confirm|确认)$/ }).count(), 1);
  }
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true });
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed: true, mode,
    surface: page.url(), evidence: await page.locator('body').innerText(),
    limits: ['Kit runtime and all application assets load from the kit. Playwright is test infrastructure.',
      'OS network denial is tested separately for installation and Host; GUI does not disable Chromium sandbox.',
      'A reminder result does not verify OS notification delivery or a trusted banner click.'] }, null, 2) + '\n');
} finally {
  if (app) {
    const deadline = setTimeout(() => { forced = true; app.process().kill('SIGKILL'); }, 5000);
    try { await app.close(); } finally { clearTimeout(deadline); }
  }
  await rm(userData, { recursive: true, force: true });
}
assert.equal(forced, false, 'Desktop did not stop cleanly');
console.log(`Offline Desktop ${mode} passes.`);
