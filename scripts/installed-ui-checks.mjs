/** Installed product interactions shared by the Windows smoke and browser regressions. */
import assert from 'node:assert/strict'

/** Dismiss first-run setup through its confirmation; saved profiles go straight to the workspace. */
export async function finishFirstRunGuide(page) {
  await page.waitForFunction(() => localStorage.getItem('tpcowork.first-run-guide.v1') !== null
    || document.querySelector('.tpcowork-guide[role="dialog"]') !== null)
  const guide = page.locator('.tpcowork-guide[role="dialog"]')
  if (!await guide.isVisible()) return
  await guide.getByRole('button', { name: /^(跳过设置|Skip setup)$/u }).click()
  const confirmation = page.getByRole('dialog', { name: /^(跳过设置？|Skip setup\?)$/u })
  await confirmation.getByRole('button', { name: /^(跳过设置|Skip setup)$/u }).click()
  await guide.waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => localStorage.getItem('tpcowork.first-run-guide.v1')), 'skipped', 'Setup dismissal must persist for the next launch')
}

/** Require the shipped Client modules and developer defaults, then return to the workspace. */
export async function checkInstalledProductUi(page) {
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
  await settings.getByRole('button', { name: /^(返回工作区|Back to workspace)$/u }).click()
  await settings.waitFor({ state: 'hidden' })
}
