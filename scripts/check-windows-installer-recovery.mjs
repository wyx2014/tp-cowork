/** Compile a tiny installer with production NSIS includes, then exercise directory recovery. */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { harnessRoot, runCommand } from './package-command.mjs'
if (process.platform !== 'win32') throw new Error('Native installer recovery checks require Windows')
await runCommand(process.execPath, [join(harnessRoot, 'apps/desktop/scripts/test-windows-installer.mjs'), '--compile-only'],
  { cwd: join(harnessRoot, 'apps/desktop') })
const require = createRequire(join(harnessRoot, 'apps/desktop/package.json'))
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows.js')
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js')
const compiler = await getMakeNsisPath()
await runCommand('pwsh', ['-NoProfile', '-File', join(harnessRoot, 'apps/desktop/scripts/smoke-installer-directories.ps1'),
  '-Makensis', compiler.path, '-SevenZip', await getPath7za()], { env: { ...process.env, ...compiler.env } })
