/** Refresh explicitly from the user's reference checkout; normal builds use this pinned copy. */
import { readFile, writeFile, mkdir, copyFile, mkdtemp, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const reference = resolve(root, '../../../tp-cowork');
const requireHarness = createRequire(new URL('../../../../deepseek-harness/package.json', import.meta.url));
const ts = requireHarness('typescript');
const seen = new Set();
const sourceSha256 = {};
const staging = await mkdtemp(resolve(tmpdir(), 'dsh-browser-vendor-'));
async function copy(path) {
  path = resolve(path);
  if (seen.has(path)) return;
  seen.add(path);
  const source = await readFile(path, 'utf8');
  sourceSha256[relative(reference, path)] = createHash('sha256').update(source).digest('hex');
  const target = resolve(staging, relative(reference, path));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, source);
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const dependency of ts.preProcessFile(output).importedFiles) {
    if (!dependency.fileName.startsWith('.')) continue;
    let next = resolve(dirname(path), dependency.fileName);
    if (!existsSync(next)) next = next.replace(/\.js$/, '.ts');
    if (existsSync(next)) await copy(next);
  }
}
try {
for (const file of [
  'desktop/src/main/browserView/browserGuestManager.ts',
  'desktop/src/main/browserView/browserTabRecoveryStore.ts',
  'desktop/src/main/browserView/browserScreenshotSurfaceCoordinator.ts',
  'desktop/src/main/browserView/browserScreenshotActivityController.ts',
  'desktop/src/main/browserView/electronBrowserWebmRecorder.ts',
  'desktop/src/preload/browserVideoRecorder.ts',
  'desktop/src/main/browserDataManager.ts',
  'shared/src/browser-use/commands.ts', 'shared/src/browser-use/command-metadata.ts', 'shared/src/browser-use/snapshot.ts',
]) await copy(resolve(reference, 'packages', file));
// Apply local fixes in a temporary tree; an incompatible upstream leaves the pinned tree intact.
const patch = resolve(root, 'patches/browserGuestManager.patch');
execFileSync('git', ['apply', '--check', patch], { cwd: staging });
execFileSync('git', ['apply', patch], { cwd: staging });
const refRequire = createRequire(resolve(reference, 'package.json'));
const playwright = dirname(refRequire.resolve('playwright-core/package.json'));
const playwrightVersion = JSON.parse(await readFile(resolve(playwright, 'package.json'), 'utf8')).version;
if (playwrightVersion !== '1.59.1') throw new Error('Review the injected script integration before changing Playwright 1.59.1');
if (process.argv.includes('--check')) {
  console.log(`Verified ${seen.size} reference files and the local patch without replacing vendor sources`);
} else {
await rm(resolve(root, 'vendor/tpcowork'), { recursive: true, force: true });
await cp(staging, resolve(root, 'vendor/tpcowork'), { recursive: true });
await copyFile(resolve(reference, 'LICENSE'), resolve(root, 'LICENSE'));
for (const name of ['NOTICE.md', 'UPSTREAM.md']) await copyFile(resolve(reference, name), resolve(root, 'vendor', name));
await mkdir(resolve(root, 'vendor/playwright'), { recursive: true });
await copyFile(resolve(playwright, 'lib/generated/injectedScriptSource.js'), resolve(root, 'vendor/playwright/injectedScriptSource.cjs'));
await copyFile(resolve(playwright, 'LICENSE'), resolve(root, 'vendor/playwright/LICENSE'));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: reference, encoding: 'utf8' }).trim();
await writeFile(resolve(root, 'vendor/reference.json'), JSON.stringify({ repository: 'tp-cowork', revision, playwright: playwrightVersion, source: 'working-tree', files: [...seen].map(p => relative(reference, p)).sort(), sourceSha256, patches: ['patches/browserGuestManager.patch'] }, null, 2) + '\n');
console.log(`Pinned ${seen.size} reference source files at ${revision}`);
}
} finally { await rm(staging, { recursive: true, force: true }); }
