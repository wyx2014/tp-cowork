/** Compile a consumer of the emitted Client/Remote declarations, including the stream augmentation. */
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), harness = resolve(root, '../../../deepseek-harness');
const ts = createRequire(resolve(harness, 'package.json'))('typescript');
const paths = { zod: [resolve(harness, 'node_modules/zod')], react: [resolve(harness, 'apps/web/node_modules/@types/react/index.d.ts')] };
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = resolve(directory, entry.name); let pkg;
    try { pkg = JSON.parse(await readFile(resolve(folder, 'package.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') { await collect(folder); continue; } throw error; }
    for (const [key, value] of Object.entries(pkg.exports ?? {})) {
      if (value?.types && !key.includes('*')) paths[pkg.name + (key === '.' ? '' : key.slice(1))] = [resolve(folder, value.types)];
    }
  }
}
await collect(resolve(harness, 'packages')); await collect(resolve(harness, 'vendor'));
const config = ts.readConfigFile(resolve(root, 'tsconfig.client.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, { paths, noEmit: true, rootDir: root });
const file = resolve(root, 'tests/_declaration-consumer.mts');
const source = `
import type { ChangeFrame } from '../lib/types/client.js';
import type {} from '../lib/types/remote.js';
import type { RemoteStreamHandle, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol';
type Assert<T extends true> = T;
export type StreamConsumer = Assert<TypertClientRemote['automationChanges']['watch'] extends (signal: AbortSignal) => RemoteStreamHandle<ChangeFrame, never> ? true : false>;
`;
const compiler = ts.createCompilerHost(parsed.options), read = compiler.readFile, exists = compiler.fileExists;
compiler.readFile = name => name === file ? source : read(name);
compiler.fileExists = name => name === file || exists(name);
const program = ts.createProgram([file], parsed.options, compiler);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: name => name, getNewLine: () => '\n' }));
  process.exitCode = 1;
} else console.log('Emitted Client/Remote declaration consumer passes.');
