/** Blocking check: the installed product launches with its core Client plugins and no renderer errors. */
import assert from 'node:assert/strict'
import { inspectInstalledUi } from './installed-ui.mjs'

await inspectInstalledUi(async page => {
  const graph = await page.evaluate(() => window.__DSH_BOOT__?.entries?.map(entry => entry.id) ?? [])
  for (const name of ['ui', 'browser', 'toolbox', 'automation', 'experts']) {
    assert.ok(graph.includes(`@tpcowork/dsh-${name}`), `Installed Client graph omits ${name}`)
  }
  console.log('Installed product Client modules:', graph.filter(id => id.startsWith('@tpcowork/')))
})
