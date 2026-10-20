/** Prepare product defaults without reading or overwriting developer deployment credentials. */
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { globSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildCore } from '../plugins/tpcowork-core/build.mjs'

/** Copy the release files and generate a credential-free deployment in a disposable directory. */
export async function stageCoreBundle(source, destination, environment = process.env) {
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  await cp(join(source, 'package.json'), join(destination, 'package.json'))
  for (const name of globSync(manifest.files, { cwd: source })) {
    if (['deployment.local.json', 'model.patch.yml', 'model.js'].includes(name)) continue
    await mkdir(dirname(join(destination, name)), { recursive: true })
    await cp(join(source, name), join(destination, name), { recursive: true })
  }
  await buildCore({ directory: pathToFileURL(`${destination}/`), env: {
    TPCOWORK_DEEPSEEK_BASE_URL: environment.TPCOWORK_DEEPSEEK_BASE_URL,
  } })
}
