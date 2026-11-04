/** Type-check every face and bundle the Host ESM; desktop.ts is bundled by the browser plugin's desktop payload. */
import { createRequire } from 'node:module';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const harness = resolve(root, '../../../deepseek-harness');
const requireHarness = createRequire(resolve(harness, 'package.json'));
const ts = requireHarness('typescript');
const requireBuild = createRequire(requireHarness.resolve('tsx/package.json'));
const { build } = requireBuild('esbuild');

// Published declarations are used deliberately: this external plugin never emits or edits DSH sources.
const paths = { electron: [resolve(harness, 'apps/desktop/node_modules/electron/electron.d.ts')] };
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = resolve(directory, entry.name);
    let pkg;
    try { pkg = JSON.parse(await readFile(resolve(folder, 'package.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') { await collect(folder); continue; } throw error; }
    for (const [key, value] of Object.entries(pkg.exports ?? {})) {
      if (!value || typeof value !== 'object' || !value.types || key.includes('*')) continue;
      paths[pkg.name + (key === '.' ? '' : key.slice(1))] = [resolve(folder, value.types)];
    }
  }
}
await collect(resolve(harness, 'packages'));
await collect(resolve(harness, 'vendor'));
const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, { paths });
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: path => path, getNewLine: () => '\n',
  }));
  process.exit(1);
}
if (process.argv.includes('--typecheck')) {
  console.log('Diagnostics types pass.');
} else {
  await mkdir(resolve(root, 'lib'), { recursive: true });
  await build({ entryPoints: [resolve(root, 'src/host.ts')], outfile: resolve(root, 'lib/host.js'), bundle: true, format: 'esm',
    platform: 'node', target: 'node22', external: ['@deepseek-ai/*'], logLevel: 'warning' });
  console.log('Built @tpcowork/dsh-diagnostics Host. Rebuild the browser plugin (--install-native) to update the desktop export.');
}
