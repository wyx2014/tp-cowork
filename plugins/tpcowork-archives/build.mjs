/** Type-check against published DSH declarations, then bundle the Host ESM entry and the browser Settings client. */
import { createRequire } from 'node:module';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const harness = resolve(root, '../../../deepseek-harness');
const requireHarness = createRequire(resolve(harness, 'package.json'));
const ts = requireHarness('typescript');
const { build } = createRequire(requireHarness.resolve('tsx/package.json'))('esbuild');
const output = resolve(root, 'lib');

// Published declarations are used deliberately: this external plugin never emits or edits DSH sources.
const paths = { zod: [resolve(harness, 'node_modules/zod')], react: [resolve(harness, 'apps/web/node_modules/@types/react/index.d.ts')] };
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
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

const file = resolve(root, 'tsconfig.json');
const config = ts.readConfigFile(file, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, { paths, noEmit: process.argv.includes('--typecheck') });
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: path => path, getNewLine: () => '\n',
  }));
  process.exit(1);
}
if (process.argv.includes('--typecheck')) {
  console.log('Archives Host types pass.');
} else {
  program.emit();
  await mkdir(output, { recursive: true });
  const common = { bundle: true, nodePaths: [resolve(harness, 'node_modules')], external: ['@deepseek-ai/*', 'react', 'react/*'], tsconfig: file, logLevel: 'warning' };
  await build({ ...common, format: 'esm', platform: 'node', target: 'node22', entryPoints: [resolve(root, 'src/host.ts')], outdir: output });
  const client = await build({ ...common, format: 'cjs', platform: 'browser', target: 'es2022',
    entryPoints: [resolve(root, 'src/client.tsx')], write: false });
  await writeFile(resolve(output, 'client.js'), `window.__ModuleLoader__.load({id:'@tpcowork/dsh-archives',factory(require){const module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`);
  console.log('Built @tpcowork/dsh-archives Host and Client.');
}
