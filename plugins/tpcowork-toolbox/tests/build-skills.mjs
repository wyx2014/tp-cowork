// Owner-local module build; T7 will include the same entries in the shared package build.
import { createRequire } from 'node:module'
import { readdir, readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = resolve(root, '../../../deepseek-harness')
const require = createRequire(resolve(harness, 'package.json'))
const ts = require('typescript')
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild')
const fsPackage = resolve(harness, 'packages/skill/skill-filesystem/node_modules')
const paths = { zod: [resolve(harness, 'node_modules/zod')], yaml: [resolve(fsPackage, 'yaml')] }
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
const program = ts.createProgram([resolve(root, 'src/host/skills/index.ts')], parsed.options)
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: p => p, getNewLine: () => '\n' }))
  process.exit(1)
}
if (!process.argv.includes('--typecheck')) {
  const common = { bundle: true, format: 'esm', platform: 'node', target: 'node22', nodePaths: [resolve(harness, 'node_modules'), fsPackage], external: ['@deepseek-ai/*'], tsconfig: resolve(root, 'tsconfig.base.json'), banner: { js: "import { createRequire as __toolboxCreateRequire } from 'node:module'; const require = __toolboxCreateRequire(import.meta.url);" } }
  await build({ ...common, entryPoints: { skills: resolve(root, 'src/host/skills/index.ts'), 'skills-remote': resolve(root, 'src/host/skills/remote.ts') }, outdir: resolve(root, 'lib') })
  await build({ ...common, entryPoints: [resolve(harness, 'packages/skill/skill/src/index.ts')], outfile: resolve(harness, 'packages/skill/skill/lib/index.js') })
  await build({ ...common, entryPoints: [resolve(harness, 'packages/skill/skill-filesystem/src/index.ts')], outfile: resolve(harness, 'packages/skill/skill-filesystem/lib/index.js') })
}
console.log('Skills Host, installer and runtime adapters typecheck passed.')
