import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ root: '', prompt: vi.fn(async () => ({ response: 1 })), reveal: vi.fn(), off: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: (key: string) => `${fixture.root}/${key}`, getName: () => 'TP Cowork Linux', getVersion: () => 'test', on: vi.fn(), off: fixture.off },
  dialog: { showMessageBox: fixture.prompt, showErrorBox: vi.fn() }, shell: { showItemInFolder: fixture.reveal },
}))
const { createDesktopBrowser } = await import('../../../scripts/linux-desktop-utilities.mjs')
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const step of cleanup.splice(0)) await step(); vi.clearAllMocks() })

async function setup() {
  fixture.root = await mkdtemp(join(tmpdir(), 'tp-linux-utilities-'))
  cleanup.push(() => rm(fixture.root, { recursive: true, force: true }))
  const factor = vi.fn()
  const window = { isDestroyed: () => false, webContents: { setZoomFactor: factor } }
  const options = { window: () => window, userData: join(fixture.root, 'userData') }
  const utilities = createDesktopBrowser(options)
  cleanup.unshift(() => utilities.dispose())
  return { utilities, options, factor }
}

it('keeps browser automation and guest attachment disabled', async () => {
  const { utilities } = await setup()
  expect(utilities.willAttach()).toBe(false)
  expect(utilities.didAttach()).toBe(false)
  expect(await utilities.request('snapshot')).toMatchObject({ enabled: false, tabs: [] })
  await expect(utilities.request('ensure', {})).rejects.toThrow('browser plugin is excluded')
  const reply = vi.fn()
  await utilities.handleHost({ id: 'request-1' }, reply)
  expect(reply).toHaveBeenCalledWith(expect.objectContaining({ id: 'request-1', error: expect.objectContaining({ code: 'disabled' }) }))
})

it('retains whole-window zoom and its saved level without a browser', async () => {
  const { utilities, options, factor } = await setup()
  expect(await utilities.request('windowZoom', { action: 'get' })).toMatchObject({ level: 0 })
  expect(await utilities.request('windowZoom', { action: 'in' })).toMatchObject({ level: 1 })
  expect(factor).toHaveBeenLastCalledWith(1.1)
  expect(JSON.parse(await readFile(join(options.userData, 'tpcowork-zoom.json'), 'utf8'))).toEqual({ level: 1 })
  const restored = createDesktopBrowser(options)
  cleanup.unshift(() => restored.dispose())
  expect(await restored.request('windowZoom', { action: 'get' })).toMatchObject({ level: 1 })
  expect(await restored.request('windowZoom', { action: 'reset' })).toMatchObject({ level: 0 })
})

it('retains the diagnostics privacy confirmation and honours cancellation', async () => {
  const { utilities } = await setup()
  expect(await utilities.request('diagnostics', { action: 'export', locale: 'en' })).toEqual({ status: 'cancelled' })
  expect(fixture.prompt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ buttons: ['Export', 'Cancel'] }))
  expect(fixture.reveal).not.toHaveBeenCalled()
})
