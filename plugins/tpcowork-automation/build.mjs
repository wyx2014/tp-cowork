/** Build Host ESM, browser ModuleLoader registration, shared exports and face-specific declarations. */
import { createRequire } from 'node:module';
import { readdir, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const harness = resolve(root, '../../../deepseek-harness');
const requireHarness = createRequire(resolve(harness, 'package.json'));
const ts = requireHarness('typescript');
const requireBuild = createRequire(requireHarness.resolve('tsx/package.json'));
const { build } = requireBuild('esbuild');
const output = resolve(root, 'lib');

// Published declarations are used deliberately: this external plugin never emits or edits DSH sources.
const paths = { zod: [resolve(harness, 'node_modules/zod')] };
paths.react = [resolve(harness, 'apps/web/node_modules/@types/react/index.d.ts')];
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

for (const face of ['host', 'client']) {
  const file = resolve(root, `tsconfig.${face}.json`);
  const config = ts.readConfigFile(file, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, {
    paths, noEmit: process.argv.includes('--typecheck'),
  });
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) {
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root, getCanonicalFileName: path => path, getNewLine: () => '\n',
    }));
    process.exit(1);
  }
  if (!process.argv.includes('--typecheck')) program.emit();
}
if (process.argv.includes('--typecheck')) {
  console.log('Automation Host and Client types pass.');
} else {
  await mkdir(output, { recursive: true });
  const common = { bundle: true, format: 'esm', platform: 'node', target: 'node22',
    nodePaths: [resolve(root, 'node_modules'), resolve(harness, 'node_modules')], external: ['@deepseek-ai/*', 'react', 'react-dom', 'react/*'],
    tsconfig: resolve(root, 'tsconfig.base.json'), logLevel: 'warning' };
  await build({ ...common, entryPoints: ['host', 'types', 'schemas', 'remote'].map(name => resolve(root, `src/${name}.ts`)), outdir: output });
  const client = await build({ ...common, entryPoints: [resolve(root, 'src/client.ts')],
    platform: 'browser', target: 'es2022', format: 'cjs', write: false, loader: { '.css': 'text' },
    plugins: [{ name: 'browser-error-value', setup(api) {
      // Protocol errors are a pure value layer, not a separately mounted Client service.
      api.onResolve({ filter: /^@deepseek-ai\/dsh-typert-protocol$/ }, () => ({
        path: resolve(harness, 'packages/typert/protocol/lib/types/remote-error.js'),
      }));
    } }],
  });
  await writeFile(resolve(output, 'client.js'), `window.__ModuleLoader__.load({id:'@tpcowork/dsh-automation',factory(require){const module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`);
  await mkdir(resolve(output, 'licenses'), { recursive: true });
  await cp(resolve(root, 'licenses/croniter.txt'), resolve(output, 'licenses/croniter.txt'));
  for (const obsolete of ['cron-parser.txt', 'luxon.txt']) await rm(resolve(output, 'licenses', obsolete), { force: true });
  await cp(resolve(harness, 'node_modules/zod/LICENSE'), resolve(output, 'licenses/zod.txt'));
  await cp(resolve(harness, 'LICENSE'), resolve(output, 'licenses/deepseek-harness.txt'));
  console.log('Built @tpcowork/dsh-automation Host, Client and shared interfaces.');
}
