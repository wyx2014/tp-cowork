/** Prepare product defaults without reading or overwriting a developer's own deployment file. */
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { globSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildCore } from '../plugins/tpcowork-core/build.mjs'

/**
 * Copy the release files and regenerate the deployment in a disposable directory, ignoring
 * any developer deployment.local.json in source. An explicit TPCOWORK_DEEPSEEK_API_KEY is
 * forwarded deliberately, so this build's installer ships pre-configured for its deployment
 * (e.g. an intranet gateway); omit that variable to keep shipping a credential-free installer.
 */
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
    TPCOWORK_DEEPSEEK_API_KEY: environment.TPCOWORK_DEEPSEEK_API_KEY,
  } })
}
