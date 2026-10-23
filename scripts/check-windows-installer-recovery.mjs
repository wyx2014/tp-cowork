/** Exercise the production NSIS transaction without compiling or packing the application. */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { harnessRoot, runCommand } from './package-command.mjs'
if (process.platform !== 'win32') throw new Error('Native installer recovery checks require Windows')
const require = createRequire(join(harnessRoot, 'apps/desktop/package.json'))
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows.js')
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js')
const compiler = await getMakeNsisPath()
await runCommand('pwsh', ['-NoProfile', '-File', join(harnessRoot, 'apps/desktop/scripts/smoke-installer-directories.ps1'),
  '-Makensis', compiler.path, '-SevenZip', await getPath7za()], { env: { ...process.env, ...compiler.env } })
