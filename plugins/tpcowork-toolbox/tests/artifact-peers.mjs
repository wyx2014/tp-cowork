/** Resolve the host's built DSH peers; never redirect imports to TypeScript source. */
import { registerHooks } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
export async function artifactPeers() {
  const harness = fileURLToPath(new URL('../../../../deepseek-harness/', import.meta.url))
  const peers = new Map()
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const folder = resolve(directory, entry.name)
      let pkg
      try { pkg = JSON.parse(await readFile(resolve(folder, 'package.json'), 'utf8')) }
      catch (error) { if (error.code === 'ENOENT') { await collect(folder); continue } throw error }
      for (const [key, value] of Object.entries(pkg.exports ?? {})) {
        const target = typeof value === 'string' ? value : value?.default ?? value?.import
        if (target && !key.includes('*')) peers.set(pkg.name + (key === '.' ? '' : key.slice(1)), pathToFileURL(resolve(folder, target)).href)
      }
    }
  }
  await collect(resolve(harness, 'packages')); await collect(resolve(harness, 'vendor'))
  return registerHooks({ resolve(specifier, context, next) { return next(peers.get(specifier) ?? specifier, context) } })
}
