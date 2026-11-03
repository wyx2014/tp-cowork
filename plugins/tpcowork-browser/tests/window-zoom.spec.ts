import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WindowZoom, chromeForZoom, zoomFactor } from '../src/window-zoom.js'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

function fakeWindow() {
  const calls: { zoom: number[], buttons: object[], overlay: object[] } = { zoom: [], buttons: [], overlay: [] }
  const window = {
    isDestroyed: () => false,
    webContents: { setZoomFactor: (factor: number) => { calls.zoom.push(factor) } },
    setWindowButtonPosition: (point: object) => { calls.buttons.push(point) },
    setTitleBarOverlay: (options: object) => { calls.overlay.push(options) },
  }
  return { window, calls }
}

describe('window zoom', () => {
  it('steps by 1.1 between -3 and +5 and keeps native chrome level with the zoomed strip', () => {
    expect(zoomFactor(2)).toBeCloseTo(1.21)
    expect(chromeForZoom(0, 'darwin')).toEqual({ buttons: { x: 16, y: 18 } })
    expect(chromeForZoom(5, 'darwin')).toEqual({ buttons: { x: 16, y: Math.round(18 + 25 * (1.1 ** 5 - 1)) } })
    expect(chromeForZoom(-3, 'darwin').buttons!.y).toBeLessThan(18)
    expect(chromeForZoom(2, 'win32')).toEqual({ titleBarHeight: 48 })
    expect(chromeForZoom(2, 'linux')).toEqual({})
  })

  it('clamps, applies, and restores the saved level for a new window', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zoom-'))
    dirs.push(dir)
    const file = join(dir, 'nested', 'tpcowork-zoom.json')
    const { window, calls } = fakeWindow()
    const zoom = new WindowZoom(() => window, file, 'darwin')
    expect(await zoom.request({ action: 'get' })).toEqual({ level: 0, min: -3, max: 5 })
    for (let index = 0; index < 7; index += 1) await zoom.request({ action: 'in' })
    expect(zoom.level).toBe(5)
    expect(calls.zoom.at(-1)).toBeCloseTo(1.1 ** 5)
    expect(calls.buttons.at(-1)).toEqual(chromeForZoom(5, 'darwin').buttons)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ level: 5 })
    await zoom.request({ action: 'out' })

    const next = fakeWindow()
    const restored = new WindowZoom(() => next.window, file, 'win32')
    expect((await restored.request({})).level).toBe(4)
    expect(next.calls.zoom).toEqual([1.1 ** 4])
    expect(next.calls.overlay).toEqual([{ height: Math.round(40 * 1.1 ** 4) }])
    expect((await restored.request({ action: 'reset' })).level).toBe(0)
    await expect(restored.request({ action: 'bogus' })).rejects.toThrow('Unknown zoom action')
  })
})
