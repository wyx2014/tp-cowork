/** Owner-local build; shared toolbox composition and installation remain owned by T7. */
import { createRequire } from 'node:module'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
const root = dirname(fileURLToPath(import.meta.url))
const harness = resolve(root, '../../../deepseek-harness')
const require = createRequire(resolve(harness, 'package.json'))
const ts = require('typescript')
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild')
const paths = { zod: [resolve(harness, 'node_modules/zod')], react: [resolve(harness, 'apps/web/node_modules/@types/react/index.d.ts')] }
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
const base = ts.readConfigFile(resolve(root, '../tpcowork-toolbox/tsconfig.base.json'), ts.sys.readFile)
for (const files of [['src/host.ts', '../tpcowork-toolbox/src/host/teams/index.ts'], ['../tpcowork-workbench/experts/client.tsx']]) {
  const parsed = ts.parseJsonConfigFileContent(base.config, ts.sys, resolve(root, '../tpcowork-toolbox'), { paths, rootDir: resolve(root, '..'), noEmit: true })
  const program = ts.createProgram(files.map(file => resolve(root, file)), parsed.options)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length) {
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: p => p, getNewLine: () => '\n' }))
    process.exit(1)
  }
}
if (process.argv.includes('--typecheck')) { console.log('Experts Host, admission and workbench Client typecheck passed.'); process.exit(0) }
await mkdir(resolve(root, 'lib'), { recursive: true })
const options = { bundle: true, format: 'esm', platform: 'node', target: 'node22', nodePaths: [resolve(harness, 'node_modules')], external: ['@deepseek-ai/*', 'react', 'react/*'], tsconfig: resolve(root, '../tpcowork-toolbox/tsconfig.base.json') }
await build({ ...options, entryPoints: { host: resolve(root, 'src/host.ts'), remote: resolve(root, 'src/remote.ts'), teams: resolve(root, '../tpcowork-toolbox/src/host/teams/index.ts') }, outdir: resolve(root, 'lib') })
const client = await build({ ...options, platform: 'browser', format: 'cjs', target: 'es2022', entryPoints: [resolve(root, '../tpcowork-workbench/experts/client.tsx')], write: false })
await writeFile(resolve(root, 'lib/client.js'), `window.__ModuleLoader__.load({id:'@tpcowork/dsh-experts',factory(require){const module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`)
console.log('Built experts Host, toolbox teams module, Remote and workbench Client.')
