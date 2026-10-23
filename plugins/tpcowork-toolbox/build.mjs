// Build against installed DSH declarations without modifying its workspace or shared automation files.
import { createRequire } from 'node:module'
import { readdir, readFile, writeFile, mkdir, cp, rm, access, chmod } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { loadImageExtractDeployment } from './src/host/skills/image-extract-deployment.ts'
const root = dirname(fileURLToPath(import.meta.url))
const harness = resolve(root, '../../../deepseek-harness')
const requireHarness = createRequire(resolve(harness, 'package.json'))
const ts = requireHarness('typescript')
const { build } = createRequire(requireHarness.resolve('tsx/package.json'))('esbuild')
const output = resolve(root, 'lib')
const optionalEntries = {}
for (const module of ['tpcoworkhub', 'teams', 'web-search-step']) {
  const entry = resolve(root, `src/host/${module}/index.ts`)
  try { await access(entry); optionalEntries[module] = entry }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
const paths = {
  zod: [resolve(harness, 'node_modules/zod')],
  yaml: [resolve(harness, 'packages/skill/skill-filesystem/node_modules/yaml')],
  react: [resolve(harness, 'apps/web/node_modules/@types/react/index.d.ts')],
  'react-dom': [resolve(harness, 'apps/web/node_modules/@types/react-dom/index.d.ts')],
}
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const folder = resolve(directory, entry.name)
    let pkg
    try { pkg = JSON.parse(await readFile(resolve(folder, 'package.json'), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') { await collect(folder); continue } throw error }
    for (const [key, value] of Object.entries(pkg.exports ?? {})) {
      if (!value || typeof value !== 'object' || !value.types || key.includes('*')) continue
      paths[pkg.name + (key === '.' ? '' : key.slice(1))] = [resolve(folder, value.types)]
    }
  }
}
await collect(resolve(harness, 'packages'))
await collect(resolve(harness, 'vendor'))
const checking = process.argv.includes('--typecheck')
if (!checking) await rm(output, { recursive: true, force: true })
for (const face of ['host', 'client']) {
  const config = ts.readConfigFile(resolve(root, `tsconfig.${face}.json`), ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  // Team admission shares types with experts/workbench; retain their relative tree in declarations.
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, { paths, rootDir: resolve(root, '..'), noEmit: checking })
  const program = ts.createProgram([...parsed.fileNames, ...(face === 'host' ? Object.values(optionalEntries) : [])], parsed.options)
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
  if (diagnostics.length) {
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root, getCanonicalFileName: path => path, getNewLine: () => '\n',
    }))
    process.exit(1)
  }
  if (!checking) program.emit()
}
if (checking) { console.log('Toolbox Host, Client and contract examples typecheck passed.'); process.exit(0) }
await mkdir(output, { recursive: true })
const imageExtractDeployment = await loadImageExtractDeployment(new URL('./', import.meta.url))
const imageExtractFile = resolve(output, 'image-extract.local.json')
await writeFile(imageExtractFile, JSON.stringify(imageExtractDeployment, null, 2) + '\n', { mode: 0o600 })
await chmod(imageExtractFile, 0o600)
const common = {
  bundle: true, format: 'esm', platform: 'node', target: 'node22',
  nodePaths: [resolve(harness, 'node_modules')], external: ['@deepseek-ai/*', 'react', 'react-dom', 'react/*'],
  tsconfig: resolve(root, 'tsconfig.base.json'), logLevel: 'warning',
  alias: { zod: requireHarness.resolve('zod') },
}
await build({ ...common, entryPoints: {
  host: resolve(root, 'src/host.ts'), contracts: resolve(root, 'src/contracts/index.ts'), remote: resolve(root, 'src/remote.ts'),
  composition: resolve(root, 'src/composition.ts'),
  skills: resolve(root, 'src/host/skills/index.ts'), 'skills-remote': resolve(root, 'src/host/skills/remote.ts'),
  mcp: resolve(root, 'src/host/mcp/index.ts'), 'mcp-remote': resolve(root, 'src/host/mcp/remote.ts'),
  ...optionalEntries,
}, outdir: output, splitting: true, banner: { js: "import { createRequire as __toolboxCreateRequire } from 'node:module'; const require = __toolboxCreateRequire(import.meta.url);" } })
const client = await build({ ...common, entryPoints: [resolve(root, 'src/client.ts')],
  loader: { '.png': 'dataurl' },
  platform: 'browser', target: 'es2022', format: 'cjs', write: false,
})
await writeFile(resolve(output, 'client.js'), `window.__ModuleLoader__.load({id:'@tpcowork/dsh-toolbox',factory(require){const module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`)
await mkdir(resolve(output, 'licenses'), { recursive: true })
await cp(resolve(harness, 'node_modules/zod/LICENSE'), resolve(output, 'licenses/zod.txt'))
await cp(resolve(harness, 'LICENSE'), resolve(output, 'licenses/deepseek-harness.txt'))
await cp(resolve(root, 'src/ui/suggestions/assets/LICENSE.txt'), resolve(output, 'licenses/task-suggestion-icons.txt'))
await cp(resolve(root, 'src/ui/suggestions/assets/NOTICE.md'), resolve(output, 'licenses/task-suggestion-icons-notice.md'))
await cp(resolve(root, 'runtime-scripts/playwright-launcher.mjs'), resolve(output, 'playwright-launcher.mjs'))
await writeFile(resolve(output, 'optional-modules.json'), JSON.stringify({ schemaVersion: 1, artifacts: Object.keys(optionalEntries) }, null, 2) + '\n')
// The desktop shell only ever dynamically imports this one file through a thin, generic loader
// (DesktopTpcoworkHubPlugin); no TP Cowork Hub logic lives in the shell itself.
await build({ ...common, external: [...common.external, 'electron'],
  entryPoints: [resolve(root, 'native/tpcoworkhub-desktop.ts')], outfile: resolve(output, 'desktop/tpcoworkhub.js') })
if (process.argv.includes('--install-native')) {
  const target = resolve(root, '../../../deepseek-harness/apps/desktop/lib/tpcoworkhub')
  await mkdir(target, { recursive: true })
  await cp(resolve(output, 'desktop/tpcoworkhub.js'), resolve(target, 'desktop.js'))
}
console.log('Built @tpcowork/dsh-toolbox Host, Client and contracts.' + (process.argv.includes('--install-native') ? ' Installed desktop TP Cowork Hub assets.' : ''))
