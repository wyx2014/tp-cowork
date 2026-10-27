/** Reuse the harness's verified Linux interpreter and install only the hash-locked YAML wheel. */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { productRoot, runCommand } from './package-command.mjs'

export async function prepareToolboxLinuxPython(source, destination, online) {
  if (!source) throw new Error('TP Cowork: Linux toolbox Python must be prepared through npm run build:linux')
  await rm(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true, dereference: true })
  const python = join(destination, 'bin/python3')
  const identity = JSON.parse(await runCommand(python, ['-I', '-B', '-c',
    'import json,sys,platform;print(json.dumps({"python":list(sys.version_info[:2]),"platform":sys.platform,"machine":platform.machine()}))'], { capture: true }))
  if (identity.platform !== 'linux' || identity.machine !== 'x86_64' || identity.python.join('.') !== '3.12') {
    throw new Error('TP Cowork: Linux toolbox wheel lock requires CPython 3.12 x64')
  }
  const requirements = join(productRoot, 'plugins/tpcowork-toolbox/runtime-scripts/requirements-linux-x64-py312.txt')
  const wheels = join(productRoot, '.cache/toolbox-linux-wheels')
  await mkdir(wheels, { recursive: true })
  if (online) await runCommand(python, ['-I', '-B', '-m', 'pip', 'download', '--only-binary=:all:', '--no-deps',
    '--require-hashes', '--dest', wheels, '-r', requirements])
  await runCommand(python, ['-I', '-B', '-m', 'pip', 'install', '--no-index', '--find-links', wheels, '--only-binary=:all:',
    '--require-hashes', '--no-deps', '--no-compile', '--target', join(destination, 'lib/python3.12/site-packages'), '-r', requirements])
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(identity, null, 2) + '\n')
  await runCommand(python, ['-I', '-B', '-c', 'import pptx,docx,PIL,yaml; print("Packaged Linux Python dependencies ready")'])
}
