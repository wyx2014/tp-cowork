// T5 module build; T7 owns the shared package/composition exports.
import { createRequire } from 'node:module'
import { readdir, readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = resolve(root, '../../../deepseek-harness')
const require = createRequire(resolve(harness, 'package.json'))
const ts = require('typescript')
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild')
const paths = { zod: [resolve(harness, 'node_modules/zod')] }
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const folder = resolve(directory, entry.name)
    let pkg
    try { pkg = JSON.parse(await readFile(resolve(folder, 'package.json'), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') { await collect(folder); continue } throw error }
    for (const [key, value] of Object.entries(pkg.exports ?? {})) if (value?.types && !key.includes('*')) paths[pkg.name + (key === '.' ? '' : key.slice(1))] = [resolve(folder, value.types)]
  }
}
await collect(resolve(harness, 'packages')); await collect(resolve(harness, 'vendor'))
const config = ts.readConfigFile(resolve(root, 'tsconfig.host.json'), ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, { paths, noEmit: true })
const program = ts.createProgram([resolve(root, 'src/host/prompthub/index.ts')], parsed.options)
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: p => p, getNewLine: () => '\n' }))
  process.exit(1)
}
if (!process.argv.includes('--typecheck')) await build({
  bundle: true, format: 'esm', platform: 'node', target: 'node22', nodePaths: [resolve(harness, 'node_modules')], external: ['@deepseek-ai/*'], tsconfig: resolve(root, 'tsconfig.base.json'),
  entryPoints: { prompthub: resolve(root, 'src/host/prompthub/index.ts'), 'prompthub-remote': resolve(root, 'src/host/prompthub/remote.ts') }, outdir: resolve(root, 'lib'),
})
console.log('PromptHub Host and Remote typecheck passed.')
