/** Installed product interactions shared by the Windows smoke and browser regressions. */
import assert from 'node:assert/strict'

/** Open settings after the initial session baseline and its onboarding effects have settled. */
export async function openInstalledSettings(page) {
  await page.waitForFunction(() => performance.getEntriesByType('resource')
    .some(entry => new URL(entry.name).pathname === '/api/session/list'))
  // An already-dismissed guide returns immediately on upgrades. The session baseline can still
  // select a hidden onboarding step, which closes a settings panel opened before that first commit.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.getByRole('button', { name: /^(设置|Settings)$/u }).click()
  const settings = page.getByRole('dialog', { name: /^(设置|Settings)$/u })
  await settings.waitFor({ state: 'visible' })
  return settings
}

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
export async function checkInstalledProductUi(page, { capture = async () => {},
  clientPlugins = ['ui', 'browser', 'toolbox', 'automation', 'experts', 'memory', 'archives', 'usage'] } = {}) {
  const graph = await page.evaluate(() => window.__DSH_BOOT__?.entries?.map(entry => entry.id) ?? [])
  for (const name of clientPlugins) {
    assert.ok(graph.includes(`@tpcowork/dsh-${name}`), `Installed Client graph omits ${name}`)
  }
  console.log('Installed product Client modules:', graph.filter(id => id.startsWith('@tpcowork/')))
  const settings = await openInstalledSettings(page)
  const developerMode = settings.getByRole('switch', { name: /^(开发者模式|Developer mode)$/u })
  await developerMode.waitFor()
  assert.equal(await developerMode.getAttribute('aria-checked'), 'false', 'Fresh installations must keep Developer mode disabled')
  assert.equal(await settings.getByRole('button', { name: /^(Agent 预设|Agent presets)$/u }).count(), 0, 'Developer preset management must be hidden by default')
  for (const name of [/^(记忆|Memory)$/u, /^(归档管理|Archive management)$/u, /^(使用统计|Usage stats)$/u]) {
    await settings.getByRole('button', { name }).waitFor({ state: 'visible' })
  }
  await capture('settings-general')

  await settings.getByRole('button', { name: /^(记忆|Memory)$/u }).click()
  const memory = settings.getByRole('switch', { name: /^(工作区记忆|Workspace Memory)$/u })
  await memory.waitFor()
  await page.waitForFunction(() => document.querySelector('.tpm-page [role="switch"]')?.disabled === false)
  assert.equal(await memory.getAttribute('aria-checked'), 'false', 'Fresh profiles must keep memory disabled')
  await memory.click()
  await settings.getByText(/^(暂无已保存的工作区记忆|No saved workspace memories)$/u).waitFor()
  await capture('settings-memory')
  await memory.click()
  await page.waitForFunction(() => {
    const control = document.querySelector('.tpm-page [role="switch"]')
    return control?.disabled === false && control.getAttribute('aria-checked') === 'false'
  })

  await settings.getByRole('button', { name: /^(归档管理|Archive management)$/u }).click()
  const archives = settings.getByTestId('archive-management')
  await archives.getByText(/^(暂无已归档会话|No archived sessions)$/u).waitFor()
  assert.equal(await archives.getByRole('alert').count(), 0, 'Archive list must load without an error')
  await capture('settings-archives')

  await settings.getByRole('button', { name: /^(使用统计|Usage stats)$/u }).click()
  const usage = settings.locator('[data-tpcowork-usage]')
  await usage.getByRole('button', { name: /^(刷新|Refresh)$/u }).waitFor()
  await page.waitForFunction(() => {
    const values = [...document.querySelectorAll('.tpu-summary-value')]
    return values.length === 5 && values.every(value => value.textContent !== '--')
  })
  assert.equal(await usage.getByRole('alert').count(), 0, 'Usage requests must finish without an error')
  await capture('settings-usage')
  await settings.getByRole('button', { name: /^(返回工作区|Back to workspace)$/u }).click()
  await settings.waitFor({ state: 'hidden' })
}
