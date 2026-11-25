import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const COMPUTER_USE_BUNDLE = '@tpcowork/dsh-computer-use'
const computerUsePackages = [COMPUTER_USE_BUNDLE, '@deepseek-ai/dsh-computer-use']

export function assertNoComputerUseBundles(bundles) {
  for (const name of computerUsePackages) {
    assert.ok(!bundles.includes(name), `Computer Use is excluded from TP Cowork installers: ${name}`)
  }
}

/** Check the packaged closure and any installed copies, including pnpm's transitive dependencies. */
export function assertNoPackagedComputerUse(resources) {
  const manifest = JSON.parse(readFileSync(join(resources, 'app.asar/dsh/package.json'), 'utf8'))
  assertNoComputerUseBundles(Object.keys(manifest.dependencies ?? {}))
  for (const archive of ['app.asar', 'app.asar.unpacked']) {
    const modules = join(resources, archive, 'dsh/node_modules')
    const store = join(modules, '.pnpm')
    const entries = existsSync(store) ? readdirSync(store) : []
    for (const name of computerUsePackages) {
      assert.ok(!existsSync(join(modules, name)) && !entries.some(entry => entry.startsWith(name.replace('/', '+') + '@')),
        `Installer contains Computer Use package ${name} in ${archive}`)
    }
  }
}
