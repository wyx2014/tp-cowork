/** Optional diagnostics; stable product identifiers make the checks independent of locale and copy. */
import assert from 'node:assert/strict'
import { inspectInstalledUi } from './installed-ui.mjs'

await inspectInstalledUi(async page => {
  const failures = []
  for (const [name, check] of [
    ['browser bridge', async () => {
      await page.waitForFunction(async () =>
        (await window.dshDesktop?.browserAutomation?.request('snapshot'))?.enabled === true,
      null, { timeout: 20_000 })
    }],
    ['expert toolbox', async () => {
      await page.getByTestId('toolbox-navigation').click()
      await page.getByTestId('toolbox-page').waitFor()
      await page.getByTestId('toolbox-tab-teams').click()
      const team = page.getByTestId('toolbox-team-asset-research-team')
      const use = team.getByTestId('toolbox-use-team')
      await use.waitFor({ state: 'visible' })
      await page.waitForFunction(() => {
        const card = document.querySelector('[data-testid="toolbox-team-asset-research-team"]')
        return card?.querySelector('[data-testid="toolbox-use-team"]')?.disabled === false
      })
      assert.equal(await use.isEnabled(), true, 'Installed stock research team is unavailable')
    }],
  ]) {
    try { await check(); console.log(`Feature diagnostic passed: ${name}`) }
    catch (error) { failures.push(new Error(`${name}: ${error.message}`, { cause: error })) }
  }
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('\n'))
})
