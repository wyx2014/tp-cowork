/** Package only shared interface zoom and diagnostics; exclude every browser and Computer Use source. */
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { harnessRoot, productRoot } from './package-command.mjs'

export async function prepareLinuxDesktopUtilities({ output = join(harnessRoot, 'apps/desktop/lib/tpcowork-browser') } = {}) {
  const requireHarness = createRequire(join(harnessRoot, 'package.json'))
  const { build } = createRequire(requireHarness.resolve('tsx/package.json'))('esbuild')
  // This is the existing shell transport path, containing utilities instead of browser automation.
  await mkdir(output, { recursive: true })
  const result = await build({ absWorkingDir: productRoot, entryPoints: ['scripts/linux-desktop-utilities.mjs'],
    outfile: join(output, 'desktop.js'), bundle: true, format: 'esm', platform: 'node', target: 'node22',
    external: ['electron', '@deepseek-ai/*'], metafile: true, logLevel: 'warning' })
  const inputs = Object.keys(result.metafile.inputs)
  if (inputs.some(path => /plugins[\\/]tpcowork-(browser|computer-use)[\\/]/u.test(resolve(productRoot, path)))) {
    throw new Error('Linux desktop utilities must not contain excluded plugin code')
  }
  await writeFile(join(output, 'utilities.json'), JSON.stringify({ schemaVersion: 1, browserEnabled: false,
    operations: ['windowZoom', 'diagnostics'], inputs }, null, 2) + '\n')
  console.log('Linux desktop utilities: interface zoom and diagnostics only; no browser or Computer Use implementation')
}
