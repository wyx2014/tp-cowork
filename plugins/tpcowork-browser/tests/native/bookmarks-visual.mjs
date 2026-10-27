/** Import fixture Chrome bookmarks in the real pane, then use the bookmark menu and the address suggestions. */
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(root, 'test-results');
await build({ entryPoints: [resolve(root, 'tests/native/pane-client.jsx')], outfile: resolve(root, 'test-results/native-pane.js'), bundle: true, platform: 'browser',
  format: 'iife', jsx: 'automatic', define: { PANE_IMPORT: 'false' }, loader: { '.module.css': 'local-css', '.css': 'text' }, alias: {
    '@deepseek-ai/dsh-client-store': resolve(root, '../../../deepseek-harness/packages/client/store/src/index.ts'),
    '@deepseek-ai/dsh-client-ui-primitives': resolve(root, '../../../deepseek-harness/packages/client/ui-primitives/lib/index.js'),
  }, nodePaths: [resolve(root, '../../../deepseek-harness/packages/client/ui-renderer/node_modules')] });
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><title>Page ${req.url}</title><h1 style="font-family:sans-serif">Fixture ${req.url}</h1>`); });
await new Promise(ready => server.listen(0, '127.0.0.1', ready));
const site = `http://127.0.0.1:${server.address().port}`;
const home = await mkdtemp(resolve(tmpdir(), 'dsh-bookmarks-'));
// A Chrome profile with folders, and no Edge at all.
const chrome = join(home, 'Chrome');
await mkdir(join(chrome, 'Default'), { recursive: true });
const url = (name, path) => ({ type: 'url', name, url: `${site}${path}` });
await writeFile(join(chrome, 'Default', 'Bookmarks'), JSON.stringify({ roots: {
  bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [url('GitHub', '/github'), url('GitHub Actions', '/actions'),
    { type: 'folder', name: 'Work', children: [url('Jira board', '/jira'), url('Design docs', '/docs')] }] },
  other: { type: 'folder', name: 'Other bookmarks', children: [url('Weather', '/weather')] },
} }));
const env = { ...process.env, BROWSER_TEST_HOME: home, BROWSER_TEST_PAGE: 'pane.html', BROWSER_TEST_WIDTH: '1100', BROWSER_TEST_HEIGHT: '760',
  BROWSER_TEST_BOOKMARKS: JSON.stringify({ chrome, edge: join(home, 'Edge') }) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ timeout: 15000, executablePath: resolve(root, '../../../deepseek-harness/apps/desktop/.desktop-build/development/Harness Dev.app/Contents/MacOS/Electron'), args: [resolve(root, 'tests/native/main.mjs')], env });
const capture = async name => {
  const png = await app.evaluate(async () => (await globalThis.testWindow.webContents.capturePage()).toPNG().toString('base64'));
  await writeFile(join(output, name), Buffer.from(png, 'base64'));
};
try {
  const page = await app.firstWindow();
  const run = command => app.evaluate(async (_e, command) => globalThis.testBrowser.command('visual', command, crypto.randomUUID()), command);
  const created = await run({ method: 'newTab' });
  const tabId = created.tab?.id ?? created.tab?.tabId;
  await run({ method: 'navigate', tabId, url: `${site}/start` });
  await page.getByRole('button', { name: 'Bookmarks' }).waitFor();
  // Empty menu: the import offer, with Edge unavailable on this machine.
  await page.getByRole('button', { name: 'Bookmarks' }).click();
  await page.getByText('No bookmarks yet').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Import from Edge' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Import from Chrome' }).click();
  await page.getByText('Imported 5 bookmarks from Chrome').waitFor();
  await page.getByRole('menuitem', { name: 'Work' }).click();
  await new Promise(done => setTimeout(done, 300));
  await capture('bookmarks-menu.png');
  // Search spans folders; picking a result navigates and closes the menu.
  await page.getByRole('searchbox', { name: 'Search bookmarks' }).fill('jira');
  assert.deepEqual(await page.locator('.tpcb-bookmarks [data-bookmark-row] .tpcb-bookmark-title').allTextContents(), ['Jira board']);
  await capture('bookmarks-search.png');
  await page.getByRole('menuitem', { name: /Jira board/ }).click();
  await page.waitForFunction(() => document.querySelector('.tpcb-address input')?.value.includes('/jira'));
  assert.equal(await page.locator('.tpcb-bookmarks').count(), 0);
  // The address suggests bookmarks once the person types; arrows and Enter open one.
  const address = page.getByRole('combobox', { name: 'Enter a URL and press Return' }).or(page.locator('.tpcb-address input'));
  await address.first().click();
  await address.first().fill('git');
  await page.locator('.tpcb-suggestion').first().waitFor();
  assert.deepEqual(await page.locator('.tpcb-suggestion .tpcb-bookmark-title').allTextContents(), ['GitHub', 'GitHub Actions']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await capture('bookmarks-address.png');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.tpcb-address input')?.value.includes('/actions'));
  assert.equal(await page.locator('.tpcb-suggestion').count(), 0);
  // The imported snapshot survives in the browser's data folder.
  const summary = await app.evaluate(() => globalThis.testBrowser.snapshot().bookmarks);
  assert.equal(summary.sources.chrome.count, 5);
  console.log(JSON.stringify({ ok: true, summary }));
} finally {
  await app.evaluate(async () => globalThis.testBrowser.dispose()).catch(() => {});
  await app.close(); server.close(); await rm(home, { recursive: true, force: true });
}
