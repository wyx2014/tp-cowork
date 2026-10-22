/** Render the real right-pane chrome around a native page and save a window capture for review. */
import { _electron as electron } from 'playwright-core';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = process.argv[2] ?? resolve(root, 'test-results/pane.png');
await build({ entryPoints: [resolve(root, 'tests/native/pane-client.jsx')], outfile: resolve(root, 'test-results/native-pane.js'), bundle: true, platform: 'browser',
  format: 'iife', jsx: 'automatic', define: { PANE_IMPORT: JSON.stringify(process.env.PANE_IMPORT === '1') }, loader: { '.css': 'text' }, alias: { '@deepseek-ai/dsh-client-store': resolve(root, '../../../deepseek-harness/packages/client/store/src/index.ts') }, nodePaths: [resolve(root, '../../../deepseek-harness/packages/client/ui-renderer/node_modules')] });
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Visual fixture</title><body style="margin:0;font-family:sans-serif"><header style="height:64px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid #ddd;font-weight:700;font-size:28px">FIXTURE NEWS</header><main style="display:grid;grid-template-columns:1fr 2fr 1fr;gap:16px;padding:16px"><div style="height:220px;background:#7aa2d6"></div><div style="height:320px;background:#d67a7a"></div><div style="height:220px;background:#86c08a"></div></main></body>'); });
await new Promise(ready => server.listen(0, '127.0.0.1', ready));
const home = await mkdtemp(resolve(tmpdir(), 'dsh-pane-visual-'));
const env = { ...process.env, BROWSER_TEST_HOME: home, BROWSER_TEST_PAGE: 'pane.html', BROWSER_TEST_WIDTH: '1600', BROWSER_TEST_HEIGHT: '1000' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ timeout: 15000, executablePath: resolve(root, '../../../deepseek-harness/apps/desktop/.desktop-build/development/Harness Dev.app/Contents/MacOS/Electron'), args: [resolve(root, 'tests/native/main.mjs')], env });
try {
  await app.firstWindow();
  const run = command => app.evaluate(async (_e, command) => globalThis.testBrowser.command('visual', command, crypto.randomUUID()), command);
  const created = await run({ method: 'newTab' });
  const tabId = created.tab?.id ?? created.tab?.tabId;
  await run({ method: 'navigate', tabId, url: `http://127.0.0.1:${server.address().port}/` });
  await run({ method: 'playwright', tabId, action: { name: 'waitForLoadState', state: 'domcontentloaded' } });
  if (process.env.PANE_VIEWPORT === 'reset') await run({ method: 'browserViewportReset', tabId });
  await new Promise(done => setTimeout(done, 1500));
  const png = await app.evaluate(async () => (await globalThis.testWindow.webContents.capturePage()).toPNG().toString('base64'));
  await writeFile(output, Buffer.from(png, 'base64'));
  console.log(JSON.stringify({ output, viewport: (await app.evaluate((_e, id) => globalThis.testBrowser.records.get(id).viewport, tabId)) }));
} finally {
  await app.evaluate(async () => globalThis.testBrowser.dispose()).catch(() => {});
  await app.close(); server.close(); await rm(home, { recursive: true, force: true });
}
