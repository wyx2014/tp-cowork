import { describe, expect, it } from 'vitest'
import { CuaDriverBridge, pngSize, type DriverReply } from '../src/bridge.ts'
import { computerUseSupport } from '../src/support.ts'

/** A 2×-scaled (Retina-like) PNG header: 1300×1040 pixels for a 650×520-point window. */
const png = (width: number, height: number) => {
  const bytes = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12, 'ascii'); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20)
  return bytes.toString('base64')
}
const apps = [
  { pid: 0, name: 'Notepad', bundle_id: 'Microsoft.WindowsNotepad', launch_path: 'C:\\Windows\\notepad.exe', running: false, kind: 'desktop' },
  { pid: 41, name: '记事本', bundle_id: null, launch_path: null, running: true, kind: null, windows: [{}] },
  { pid: 50, name: 'Code', running: true, kind: 'desktop' }, { pid: 51, name: 'Code', running: true, kind: 'desktop' },
]
const window = { window_id: 7, pid: 41, app_name: '记事本', title: '无标题', bounds: { x: 10, y: 20, width: 650, height: 520 }, is_on_screen: true, z_index: 3 }

function fake(platform: NodeJS.Platform = 'win32', options: { refuseKeys?: boolean } = {}) {
  const calls: [string, Record<string, unknown>][] = []
  const reply = (structured: Record<string, unknown>, extra: Partial<DriverReply> = {}): DriverReply => ({ content: [{ type: 'text', text: 'ok' }], structuredContent: structured, ...extra })
  const driver = async (tool: string, args: Record<string, unknown>): Promise<DriverReply> => {
    calls.push([tool, args])
    switch (tool) {
      case 'list_apps': return reply({ apps })
      case 'list_windows': return reply({ windows: [window, { ...window, window_id: 8, is_on_screen: false, z_index: 9 }] })
      case 'launch_app': return reply({ pid: 99 })
      case 'get_window_state': return args.include_accessibility_tree === false
        ? { content: [{ type: 'image', data: png(1300, 1040), mimeType: 'image/png' }], structuredContent: { window_bounds: window.bounds } }
        : reply({ snapshot_id: 's0000000a', tree_markdown: '- [0] button "保存"\n- [1] edit "正文"', window_title: '无标题', window_bounds: window.bounds,
          screenshot_width: 1300, screenshot_height: 1040, elements_complete: true })
      case 'press_key': return options.refuseKeys && args.delivery_mode !== 'foreground'
        ? { isError: true, content: [{ type: 'text', text: 'Background delivery is not available. Retry with delivery_mode:"foreground"' }] } : reply({})
      case 'check_permissions': return reply({ accessibility: false, screen_recording: true })
      default: return reply({})
    }
  }
  const bridge = new CuaDriverBridge(driver, platform, async pid => pid === 41 ? 'C:\\Windows\\System32\\notepad.exe' : undefined)
  return { bridge, calls, last: (tool: string) => calls.filter(([name]) => name === tool).at(-1)?.[1] }
}

describe('Cua Driver bridge', () => {
  it('selects apps by the exact name the user gave, with a consent identity bound to the real executable', async () => {
    const { bridge } = fake()
    const app = await bridge.handle('getApp', { selector: '记事本' }) as Record<string, any>
    expect(app).toMatchObject({ pid: 41, name: '记事本' })
    expect(app.authorization).toMatchObject({ name: '记事本', executablePath: 'C:\\Windows\\System32\\notepad.exe', persistable: true })
    expect(app.authorization.id).toMatch(/^[a-f0-9]{64}$/u)
    const stopped = await bridge.handle('getApp', { selector: 'Microsoft.WindowsNotepad' }) as Record<string, any>
    expect(stopped).toMatchObject({ pid: null, bundleId: 'Microsoft.WindowsNotepad', authorization: { persistable: false } })
    expect(await bridge.handle('launchApp', { appHandle: stopped.appHandle })).toMatchObject({ pid: 99 })
    await expect(bridge.handle('getApp', { selector: 'Code' })).rejects.toMatchObject({ code: 'AMBIGUOUS_APP' })
    await expect(bridge.handle('getApp', { selector: '画图' })).rejects.toMatchObject({ code: 'APP_NOT_FOUND' })
    expect(await bridge.handle('findApps', { query: 'note', maxAppMatches: 5 })).toEqual([
      { id: 'Microsoft.WindowsNotepad', displayName: 'Notepad', path: 'C:\\Windows\\notepad.exe', isRunning: false },
    ])
  })

  it('observes the frontmost visible window, then acts on its element indices and rejects stale ones', async () => {
    const { bridge, last } = fake()
    const { appHandle } = await bridge.handle('getApp', { selector: '记事本' }) as { appHandle: string }
    const state = await bridge.handle('getState', { appHandle, maxElements: 2000, maxDepth: 25 }) as Record<string, any>
    expect(last('get_window_state')).toEqual({ pid: 41, window_id: 7, max_elements: 2000, max_depth: 25 })
    expect(state).toMatchObject({ windowId: 7, snapshotId: 's0000000a', truncated: false, windows: [{ windowId: 7, bounds: { width: 650 } }, { windowId: 8, isOnScreen: false }] })
    expect(state.tree).toContain('[1] edit "正文"')
    await bridge.handle('setValue', { appHandle, snapshotId: 's0000000a', elementIndex: 1, value: '你好' })
    expect(last('set_value')).toEqual({ pid: 41, window_id: 7, element_index: 1, snapshot_id: 's0000000a', value: '你好' })
    await bridge.handle('click', { appHandle, snapshotId: 's0000000a', elementIndex: 0, mouseButton: 'right' })
    expect(last('right_click')).toEqual({ pid: 41, window_id: 7, element_index: 0, snapshot_id: 's0000000a' })
    await bridge.handle('performSecondaryAction', { appHandle, snapshotId: 's0000000a', elementIndex: 0, action: 'Press' })
    expect(last('click')).toMatchObject({ element_index: 0 })
    await expect(bridge.handle('performSecondaryAction', { appHandle, snapshotId: 's0000000a', elementIndex: 0, action: 'zoomWindow' })).rejects.toMatchObject({ code: 'ACTION_UNAVAILABLE' })
    await expect(bridge.handle('setValue', { appHandle, snapshotId: 's00000001', elementIndex: 1, value: 'x' })).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' })
    await expect(bridge.handle('typeText', { appHandle: 'gone', text: 'x' })).rejects.toMatchObject({ code: 'STALE_APP' })
  })

  it('maps window points to the driver\'s screenshot pixels, so Retina and high-DPI captures land where the model looked', async () => {
    const { bridge, last } = fake('darwin')
    const { appHandle } = await bridge.handle('getApp', { selector: '记事本' }) as { appHandle: string }
    await expect(bridge.handle('click', { appHandle, windowId: 7, x: 10, y: 10 })).rejects.toMatchObject({ code: 'SCREENSHOT_REQUIRED' })
    const shot = await bridge.handle('screenshot', { appHandle, windowId: 7 }) as Record<string, any>
    expect(shot).toMatchObject({ mimeType: 'image/png', pixelWidth: 1300, pixelHeight: 1040, windowId: 7, bounds: { width: 650, height: 520 }, coordinateSpace: 'window-points' })
    await bridge.handle('click', { appHandle, windowId: 7, x: 100.5, y: 40, clickCount: 2, modifiers: ['command', 'shift'] })
    expect(last('click')).toEqual({ pid: 41, window_id: 7, x: 201, y: 80, button: 'left', count: 2, modifier: ['cmd', 'shift'] })
    await bridge.handle('scroll', { appHandle, windowId: 7, x: 10, y: 10, deltaLinesX: -2, deltaLinesY: 3 })
    expect(last('scroll')).toMatchObject({ direction: 'right', amount: 2, by: 'line', x: 20, y: 20 })
    await bridge.handle('drag', { appHandle, windowId: 7, fromX: 1, fromY: 2, toX: 3, toY: 4, durationMs: 400, steps: 240 })
    expect(last('drag')).toEqual({ pid: 41, window_id: 7, from_x: 2, from_y: 4, to_x: 6, to_y: 8, duration_ms: 400, steps: 200 })
    await bridge.handle('paste', { appHandle, text: '粘贴' })
    expect(last('clipboard_write')).toEqual({ text: '粘贴' })
    expect(last('hotkey')).toEqual({ pid: 41, keys: ['cmd', 'v'] })
    expect(pngSize(png(3, 4))).toEqual({ width: 3, height: 4 })
  })

  it('splits chords, and asks for activation when keys cannot reach a background window', async () => {
    const { bridge, last } = fake('linux', { refuseKeys: true })
    const { appHandle } = await bridge.handle('getApp', { selector: '记事本' }) as { appHandle: string }
    await expect(bridge.handle('pressKey', { appHandle, key: 'ctrl+shift+t' })).rejects.toMatchObject({ code: 'FOREGROUND_REQUIRED' })
    expect(last('press_key')).toEqual({ pid: 41, key: 't', modifiers: ['ctrl', 'shift'] })
    await bridge.handle('activate', { appHandle })
    await bridge.handle('pressKey', { appHandle, key: 'Return', modifiers: ['control'] })
    expect(last('press_key')).toEqual({ pid: 41, key: 'Return', modifiers: ['ctrl'], delivery_mode: 'foreground' })
    expect(await bridge.handle('getCapabilities', {})).toMatchObject({ platform: 'linux', permissions: { accessibility: false, screenRecording: true }, coordinateSpace: 'screenshot-pixels' })
    await expect(bridge.handle('hover', { appHandle })).rejects.toMatchObject({ code: 'ACTION_UNAVAILABLE' })
  })
})

describe('where Computer Use runs', () => {
  it('supports Windows, macOS 13+ and Linux X11, and names the reason elsewhere', () => {
    expect(computerUseSupport('win32', 'x64', {}, '10.0.22631')).toEqual({ supported: true, platform: 'win32' })
    expect(computerUseSupport('darwin', 'arm64', {}, '22.1.0')).toEqual({ supported: true, platform: 'darwin' })
    expect(computerUseSupport('darwin', 'x64', {}, '21.6.0')).toMatchObject({ supported: false, reason: 'macos-version' })
    expect(computerUseSupport('linux', 'x64', { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' }, '5.4')).toEqual({ supported: true, platform: 'linux' })
    expect(computerUseSupport('linux', 'x64', { WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' }, '5.4')).toMatchObject({ reason: 'wayland' })
    expect(computerUseSupport('linux', 'x64', {}, '5.4')).toMatchObject({ reason: 'no-display' })
    expect(computerUseSupport('win32', 'ia32', {}, '10')).toMatchObject({ reason: 'arch' })
  })
})
