/** Stage platform-specific offline dependencies. Network access is opt-in at package preparation only. */
import { runCommand } from './package-command.mjs'
import { prepareToolboxWindowsPython } from './prepare-toolbox-windows-python.mjs'
import { prepareToolboxLinuxPython } from './prepare-toolbox-linux-python.mjs'
import { createRequire } from 'node:module'
import { mkdir, cp, chmod, writeFile, access, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve, relative } from 'node:path'
const root = fileURLToPath(new URL('../plugins/tpcowork-toolbox/', import.meta.url))
const python = process.env.TPCOWORK_PYTHON ?? 'python3'
const online = process.argv.includes('--download')
async function run(command, args, env = process.env, capture = false) {
  return runCommand(command, args, { cwd: root, env, capture })
}
const py = resolve(root, 'runtime/python')
if (!['win32', 'darwin', 'linux'].includes(process.platform) || process.arch !== 'x64') throw new Error('Toolbox runtime supports Windows, Linux or macOS x64')
await mkdir(resolve(py, 'wheels'), { recursive: true })
await run('npm', ['ci', '--ignore-scripts', '--legacy-peer-deps', '--cache', '.npm-cache', '--no-audit', '--no-fund', ...(online ? [] : ['--offline'])])
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: resolve(root, 'runtime/browsers') }
if (online) await run(process.execPath, ['node_modules/playwright/cli.js', 'install', 'chromium', '--no-shell'], env)
process.env.PLAYWRIGHT_BROWSERS_PATH = env.PLAYWRIGHT_BROWSERS_PATH
const require = createRequire(resolve(root, 'package.json'))
const { chromium } = require('playwright')
await access(chromium.executablePath())
const tar = createRequire(fileURLToPath(new URL('../../deepseek-harness/package.json', import.meta.url)))('tar')
const browserArchive = resolve(root, 'runtime/browsers.tar.gz')
await tar.create({ cwd: resolve(root, 'runtime'), file: browserArchive, gzip: true, portable: true, noMtime: true,
  filter: path => !path.split('/').includes('.links'),
}, ['browsers'])
await writeFile(resolve(root, 'runtime/playwright.json'), JSON.stringify({ version: '0.0.30', platform: process.platform, arch: process.arch,
  executable: relative(resolve(root, 'runtime'), chromium.executablePath()), archive: 'browsers.tar.gz', archiveSha256: createHash('sha256').update(await readFile(browserArchive)).digest('hex'),
}, null, 2) + '\n')
if (process.platform === 'win32') {
  await prepareToolboxWindowsPython(process.env.TPCOWORK_PACKAGED_PYTHON_SOURCE, py, online)
} else if (process.platform === 'linux') {
  await prepareToolboxLinuxPython(process.env.TPCOWORK_PACKAGED_PYTHON_SOURCE, py, online)
} else {
const identity = JSON.parse(await run(python, ['-I', '-c', 'import json,sys,platform;print(json.dumps({"python":list(sys.version_info[:2]),"platform":sys.platform,"machine":platform.machine()}))'], process.env, true))
if (identity.platform !== 'darwin' || identity.machine !== 'x86_64' || identity.python.join('.') !== '3.13') throw new Error('Prepare and review a wheel hash lock for this target Python/platform before packaging.')
const requirements = 'runtime-scripts/requirements-macos-x64-py313.txt'
if (online) await run(python, ['-m', 'pip', 'download', '--no-cache-dir', '--only-binary=:all:', '--dest', resolve(py, 'wheels'), '--require-hashes', '-r', requirements])
await run(python, ['-m', 'pip', 'install', '--no-cache-dir', '--no-index', '--find-links', resolve(py, 'wheels'), '--target', resolve(py, 'site-packages'), '--upgrade', '--no-compile', '--only-binary=:all:', '--require-hashes', '-r', requirements])
for (const file of ['python', 'boot.py']) await cp(resolve(root, 'runtime-scripts', file), resolve(py, file))
await chmod(resolve(py, 'python'), 0o755)
await writeFile(resolve(py, 'manifest.json'), JSON.stringify(identity, null, 2) + '\n')
await run(resolve(py, 'python'), ['-I', '-c', 'import pptx,docx,PIL,yaml;print("Packaged Python dependencies ready")'])
}
console.log('Prepared pinned Playwright and Python offline runtime for this platform.')
