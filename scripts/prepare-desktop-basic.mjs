/** Prepare an empty product package directory: Basic uses only the Harness defaults. */
import { mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { productRoot } from './package-command.mjs'

/** Replace only Basic's package staging directory, rejecting any product plugin selection. */
export async function prepareDesktopBasic(root = productRoot) {
  const config = JSON.parse(await readFile(resolve(root, 'desktop-product.linux-basic.json'), 'utf8'))
  if (!Array.isArray(config.bundles) || config.bundles.length !== 0) throw new Error('Linux Basic must not include product plugins')
  const packages = resolve(root, config.packages)
  if (packages !== resolve(root, '.desktop-build/basic/packages')) throw new Error('Unexpected Basic staging directory')
  await rm(packages, { recursive: true, force: true })
  await mkdir(packages, { recursive: true })
  return packages
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await prepareDesktopBasic()
  console.log('TP Cowork Basic: zero product plugins; using the default Harness profile')
}
