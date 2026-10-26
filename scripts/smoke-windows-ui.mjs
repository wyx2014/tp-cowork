/** Blocking check: the installed product launches with its core Client plugins and no renderer errors. */
import assert from 'node:assert/strict'
import { inspectInstalledUi } from './installed-ui.mjs'

await inspectInstalledUi(async page => {
  const graph = await page.evaluate(() => window.__DSH_BOOT__?.entries?.map(entry => entry.id) ?? [])
  for (const name of ['ui', 'browser', 'toolbox', 'automation', 'experts']) {
    assert.ok(graph.includes(`@tpcowork/dsh-${name}`), `Installed Client graph omits ${name}`)
  }
  console.log('Installed product Client modules:', graph.filter(id => id.startsWith('@tpcowork/')))
  await page.getByRole('button', { name: /^(设置|Settings)$/u }).click()
  const settings = page.getByRole('dialog', { name: /^(设置|Settings)$/u })
  const developerMode = settings.getByRole('switch', { name: /^(开发者模式|Developer mode)$/u })
  await developerMode.waitFor()
  assert.equal(await developerMode.getAttribute('aria-checked'), 'false', 'Fresh installations must keep Developer mode disabled')
  assert.equal(await settings.getByRole('button', { name: /^(Agent 预设|Agent presets)$/u }).count(), 0, 'Developer preset management must be hidden by default')
  await settings.getByRole('button', { name: /^(关闭|Close)$/u }).last().click()
})
