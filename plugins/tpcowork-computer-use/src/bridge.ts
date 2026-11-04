/**
 * Translates DSH's native CUA protocol (`@deepseek-ai/dsh-cua`, the app/window object API the model uses) into Cua Driver
 * tool calls. Runs inside the helper process, one instance per Agent connection. Cua Driver supplies the platform
 * accessibility (Windows UI Automation, macOS AX, Linux AT-SPI), screenshots and input; this layer keeps the handles the
 * protocol promises: helper-issued app handles, snapshot ids bound to one window, and window-point coordinates.
 */
import { createHash, randomUUID } from 'node:crypto'
import { posix, win32 } from 'node:path'

/** One Cua Driver tool reply, as `callTool(...).rawJson` parses. */
export interface DriverReply {
  content?: { type: string; text?: string; data?: string; mimeType?: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}
/** Call one Cua Driver tool. */
export type DriverCall = (tool: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<DriverReply>
/** Resolve a running process's executable path, for application consent identity. */
export type ExecutableOf = (pid: number) => Promise<string | undefined>

/** A refusal with a stable code; the Host shows `code: message` to the model. */
export class BridgeError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

interface DriverApp { pid?: number; name?: string | null; bundle_id?: string | null; launch_path?: string | null; running?: boolean; kind?: string | null; windows?: unknown[] }
interface DriverWindow { window_id: number; pid: number; app_name?: string; title?: string; bounds?: { x: number; y: number; width: number; height: number }; is_on_screen?: boolean; z_index?: number | null }
interface App { pid: number | null; name: string; bundleId?: string; launchPath?: string }
interface Frame { boundsWidth: number; boundsHeight: number; pixelWidth: number; pixelHeight: number }
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Params = Record<string, unknown>

const ACTION = { dispatched: true, verified: false } as const
const MODIFIERS: Record<string, string> = { command: 'cmd', control: 'ctrl', option: 'alt', shift: 'shift', fn: 'fn' }
/** Methods this bridge answers, reported by getCapabilities. */
export const METHODS = ['getCapabilities', 'listApps', 'findApps', 'getApp', 'activate', 'show', 'listWindows', 'getState', 'click',
  'setValue', 'performSecondaryAction', 'typeText', 'paste', 'pressKey', 'scroll', 'drag', 'screenshot'] as const

const text = (reply: DriverReply): string => (reply.content ?? []).flatMap(block => block.type === 'text' && block.text ? [block.text] : []).join('\n')
const structured = (reply: DriverReply): Params => reply.structuredContent ?? {}
const integer = (value: unknown, what: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new BridgeError('INVALID_ARGUMENT', `${what} must be a positive integer`)
  return value
}
const string = (value: unknown, what: string): string => {
  if (typeof value !== 'string') throw new BridgeError('INVALID_ARGUMENT', `${what} must be a string`)
  return value
}

/** Width and height of a base64 PNG, read from its IHDR chunk. */
export function pngSize(base64: string): { width: number; height: number } {
  const header = Buffer.from(base64.slice(0, 64), 'base64')
  if (header.length < 24 || header.readUInt32BE(12) !== 0x49484452) throw new BridgeError('NATIVE_PROTOCOL', 'Cua Driver returned a screenshot that is not a PNG')
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

/** Driver failures keep their text; permission problems get the code the guidance tells the model to stop on. */
function failure(reply: DriverReply, tool: string): BridgeError {
  const message = text(reply) || `${tool} failed`
  if (/permission|not trusted|accessibility (?:is )?(?:not|disabled)|screen recording|TCC/iu.test(message)) return new BridgeError('PERMISSION_DENIED', message)
  if (/stale|snapshot .*(?:replaced|expired|unknown)/iu.test(message)) return new BridgeError('STALE_SNAPSHOT', message)
  if (/no such process|not running|process .*exited/iu.test(message)) return new BridgeError('STALE_APP', message)
  if (/delivery_mode:?\s*"?foreground|background delivery is not available/iu.test(message)) {
    return new BridgeError('FOREGROUND_REQUIRED', `${message}\nCall app.activate() (or show()) and retry; keyboard input then goes to the focused window.`)
  }
  return new BridgeError('ACTION_FAILED', message)
}

export class CuaDriverBridge {
  private readonly apps = new Map<string, App>()
  private readonly snapshots = new Map<string, { appHandle: string; pid: number; windowId: number }>()
  private readonly frames = new Map<string, Frame>()
  /** Apps the model explicitly brought forward; their keyboard input may use foreground delivery. */
  private readonly foreground = new Set<number>()

  constructor(private readonly driver: DriverCall, private readonly platform: NodeJS.Platform, private readonly executableOf: ExecutableOf) {}

  private async call(tool: string, args: Params, signal?: AbortSignal): Promise<DriverReply> {
    let reply: DriverReply
    try { reply = await this.driver(tool, args, signal) }
    catch (error) {
      if (signal?.aborted) throw new BridgeError('NATIVE_CANCELLED', 'Operation cancelled; inspect fresh state before retrying input')
      throw failure({ content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }, tool)
    }
    if (reply.isError) throw failure(reply, tool)
    return reply
  }

  /** Background by default; foreground only for an app the model explicitly activated. */
  private delivery(pid: number): { delivery_mode?: 'foreground' } {
    return this.foreground.has(pid) ? { delivery_mode: 'foreground' } : {}
  }

  private app(handle: unknown): App & { handle: string } {
    const key = string(handle, 'appHandle')
    const app = this.apps.get(key)
    if (!app) throw new BridgeError('STALE_APP', 'Unknown application handle; select the application again with getApp')
    return { ...app, handle: key }
  }

  private running(handle: unknown): App & { handle: string; pid: number } {
    const app = this.app(handle)
    if (app.pid === null) throw new BridgeError('STALE_APP', `${app.name} is not running; select it again with getApp`)
    return { ...app, pid: app.pid }
  }

  private snapshot(params: Params): { pid: number; windowId: number; elementIndex: number; snapshotId: string } {
    const app = this.running(params.appHandle)
    const snapshotId = string(params.snapshotId, 'snapshotId')
    const known = this.snapshots.get(snapshotId)
    if (!known || known.appHandle !== app.handle) throw new BridgeError('STALE_SNAPSHOT', 'Element indices belong to an older observation; read fresh state with getState')
    const elementIndex = params.elementIndex
    if (typeof elementIndex !== 'number' || !Number.isInteger(elementIndex) || elementIndex < 0) throw new BridgeError('INVALID_ARGUMENT', 'elementIndex must be a non-negative integer')
    return { pid: known.pid, windowId: known.windowId, elementIndex, snapshotId }
  }

  /** Window points (the Host's coordinate space) to the driver's screenshot pixels for that window. */
  private pixels(pid: number, windowId: number, x: number, y: number): { x: number; y: number } {
    const frame = this.frames.get(`${String(pid)}:${String(windowId)}`)
    if (!frame) throw new BridgeError('SCREENSHOT_REQUIRED', 'Observe this window before coordinate input')
    return { x: x * frame.pixelWidth / frame.boundsWidth, y: y * frame.pixelHeight / frame.boundsHeight }
  }

  private remember(pid: number, windowId: number, state: Params): void {
    const bounds = state.window_bounds as { width?: number; height?: number } | undefined
    const pixelWidth = state.screenshot_width, pixelHeight = state.screenshot_height
    if (bounds?.width && bounds.height && typeof pixelWidth === 'number' && typeof pixelHeight === 'number' && pixelWidth > 0 && pixelHeight > 0) {
      this.frames.set(`${String(pid)}:${String(windowId)}`, { boundsWidth: bounds.width, boundsHeight: bounds.height, pixelWidth, pixelHeight })
    }
  }

  private async driverApps(signal?: AbortSignal): Promise<DriverApp[]> {
    return (structured(await this.call('list_apps', {}, signal)).apps as DriverApp[] | undefined) ?? []
  }

  private async windows(pid: number, signal?: AbortSignal): Promise<DriverWindow[]> {
    return (structured(await this.call('list_windows', { pid }, signal)).windows as DriverWindow[] | undefined) ?? []
  }

  private static window(window: DriverWindow): Json {
    const bounds = window.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
    return { windowId: window.window_id, pid: window.pid, appName: window.app_name ?? '', title: window.title ?? '',
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, isOnScreen: window.is_on_screen !== false, onCurrentSpace: null }
  }

  /** The window an app-wide observation addresses: frontmost on-screen, nonzero-size window. */
  private static primary(windows: DriverWindow[]): DriverWindow | undefined {
    const usable = windows.filter(window => window.is_on_screen !== false && (window.bounds?.width ?? 0) > 0 && (window.bounds?.height ?? 0) > 0)
    return usable.sort((a, b) => (b.z_index ?? -1) - (a.z_index ?? -1))[0] ?? windows[0]
  }

  /** Consent identity: the real executable when it can be resolved, so "Always allow" survives restarts. */
  private async identity(app: App): Promise<{ id: string; name: string; executablePath: string; persistable: boolean }> {
    const resolved = app.pid === null ? undefined : await this.executableOf(app.pid).catch(() => undefined)
    const executablePath = resolved ?? app.launchPath ?? app.bundleId ?? app.name
    const persistable = resolved !== undefined && (this.platform === 'win32' ? win32 : posix).isAbsolute(resolved)
    const id = createHash('sha256').update(`${this.platform}\0${persistable ? executablePath : `${app.bundleId ?? ''}\0${app.name}`}`).digest('hex')
    return { id, name: app.name, executablePath, persistable }
  }

  private static appResult(handle: string, app: App): Json {
    return { appHandle: handle, pid: app.pid, name: app.name, ...app.bundleId ? { bundleId: app.bundleId } : {} }
  }

  /** Answer one protocol request. */
  async handle(method: string, params: Params, signal?: AbortSignal): Promise<Json> {
    switch (method) {
      case 'getCapabilities': {
        const status = structured(await this.call('check_permissions', {}, signal))
        const accessibility = Boolean(status.accessibility ?? status.atspi ?? status.uia ?? true)
        const screenRecording = Boolean(status.screen_recording ?? status.screenRecording ?? status.x11 ?? true)
        return { platform: this.platform, permissions: { accessibility, screenRecording }, sessionLocked: null, methods: [...METHODS],
          coordinateSpace: 'screenshot-pixels', browser: false }
      }
      case 'listApps':
        return (await this.driverApps(signal)).filter(app => app.running && (app.pid ?? 0) > 0 && (app.kind === 'desktop' || app.bundle_id || (app.windows?.length ?? 0) > 0))
          .map(app => ({ pid: app.pid!, name: app.name ?? '', ...app.bundle_id ? { bundleId: app.bundle_id } : {} }))
      case 'findApps': {
        const query = string(params.query, 'query').trim().toLowerCase()
        const limit = typeof params.maxAppMatches === 'number' ? params.maxAppMatches : 20
        const matches = (await this.driverApps(signal)).filter(app => (app.kind === 'desktop' || app.bundle_id || app.launch_path)
          && [app.name, app.bundle_id, app.launch_path].some(value => value?.toLowerCase().includes(query)))
        return matches.slice(0, limit).map(app => ({ id: app.bundle_id ?? app.launch_path ?? app.name ?? '', displayName: app.name ?? '',
          path: app.launch_path ?? app.name ?? '', ...app.running && (app.pid ?? 0) > 0 ? { isRunning: true, pid: app.pid! } : { isRunning: false } }))
      }
      case 'getApp': {
        const selector = string(params.selector, 'selector').trim()
        if (!selector) throw new BridgeError('INVALID_ARGUMENT', 'selector must not be empty')
        const apps = await this.driverApps(signal)
        const lower = selector.toLowerCase()
        const pid = /^\d+$/u.test(selector) ? Number(selector) : undefined
        const exact = apps.filter(app => (pid !== undefined && app.pid === pid) || app.bundle_id === selector || app.launch_path === selector
          || app.name?.toLowerCase() === lower)
        const live = exact.filter(app => app.running && (app.pid ?? 0) > 0)
        if (new Set(live.map(app => app.pid)).size > 1 && pid === undefined) {
          throw new BridgeError('AMBIGUOUS_APP', `Several running processes match "${selector}": ${live.map(app => `${app.name ?? ''} (pid ${String(app.pid)})`).join(', ')}; pass the pid`)
        }
        const chosen = live[0] ?? exact[0]
        if (!chosen) throw new BridgeError('APP_NOT_FOUND', `No application matches "${selector}"; call listApps or findApps and use a returned identifier`)
        const app: App = { pid: chosen.running && (chosen.pid ?? 0) > 0 ? chosen.pid! : null, name: chosen.name ?? selector,
          ...chosen.bundle_id ? { bundleId: chosen.bundle_id } : {}, ...chosen.launch_path ? { launchPath: chosen.launch_path } : {} }
        const handle = randomUUID()
        this.apps.set(handle, app)
        return { ...CuaDriverBridge.appResult(handle, app) as Record<string, Json>, authorization: await this.identity(app) }
      }
      case 'launchApp': {
        const app = this.app(params.appHandle)
        const reply = structured(await this.call('launch_app', {
          ...app.launchPath ? { launch_path: app.launchPath } : {}, ...app.bundleId ? { bundle_id: app.bundleId } : {}, name: app.name,
        }, signal))
        const pid = integer(reply.pid, 'launched pid')
        const next = { ...this.apps.get(app.handle)!, pid }
        this.apps.set(app.handle, next)
        return CuaDriverBridge.appResult(app.handle, next)
      }
      case 'activate': {
        const app = this.running(params.appHandle)
        await this.call('bring_to_front', { pid: app.pid }, signal)
        this.foreground.add(app.pid)
        return ACTION
      }
      case 'show': {
        const app = this.running(params.appHandle)
        const windowId = params.windowId === undefined ? CuaDriverBridge.primary(await this.windows(app.pid, signal))?.window_id : integer(params.windowId, 'windowId')
        await this.call('bring_to_front', { pid: app.pid, ...windowId === undefined ? {} : { window_id: windowId } }, signal)
        this.foreground.add(app.pid)
        return { ...ACTION, windowId: windowId ?? null, foregroundChanged: null }
      }
      case 'listWindows':
        return (await this.windows(this.running(params.appHandle).pid, signal)).map(CuaDriverBridge.window)
      case 'getState': {
        const app = this.running(params.appHandle)
        const windows = await this.windows(app.pid, signal)
        const window = params.windowId === undefined ? CuaDriverBridge.primary(windows) : windows.find(item => item.window_id === params.windowId)
        if (params.windowId !== undefined && !window) throw new BridgeError('WINDOW_CHANGED', 'That window no longer exists; list windows again')
        if (!window) {
          const snapshotId = `none-${randomUUID()}`
          return { appHandle: app.handle, pid: app.pid, windowId: null, focusedWindowId: null, snapshotId, tree: `${app.name} has no windows.`, windows: [], truncated: false }
        }
        const state = structured(await this.call('get_window_state', { pid: app.pid, window_id: window.window_id,
          ...typeof params.maxElements === 'number' ? { max_elements: params.maxElements } : {},
          ...typeof params.maxDepth === 'number' ? { max_depth: params.maxDepth } : {} }, signal))
        this.remember(app.pid, window.window_id, state)
        const snapshotId = typeof state.snapshot_id === 'string' ? state.snapshot_id : `none-${randomUUID()}`
        for (const [id, known] of this.snapshots) if (known.appHandle === app.handle && known.windowId === window.window_id) this.snapshots.delete(id)
        this.snapshots.set(snapshotId, { appHandle: app.handle, pid: app.pid, windowId: window.window_id })
        const tree = typeof state.tree_markdown === 'string' ? state.tree_markdown : ''
        return { appHandle: app.handle, pid: app.pid, windowId: window.window_id, focusedWindowId: null, snapshotId,
          tree: `${typeof state.window_title === 'string' ? `window "${state.window_title}" ` : ''}id=${String(window.window_id)}\n${tree}`,
          windows: windows.map(CuaDriverBridge.window), truncated: state.elements_complete === false && state.returned_element_count !== state.total_element_count }
      }
      case 'screenshot': {
        const app = this.running(params.appHandle)
        const windowId = integer(params.windowId, 'windowId')
        const reply = await this.call('get_window_state', { pid: app.pid, window_id: windowId, include_accessibility_tree: false }, signal)
        const state = structured(reply)
        const image = (reply.content ?? []).find(block => block.type === 'image' && block.data)
        const bounds = state.window_bounds as { x: number; y: number; width: number; height: number } | undefined
        if (!image?.data || !bounds?.width || !bounds.height) throw new BridgeError('WINDOW_CHANGED', 'The window could not be captured; observe it again')
        const size = pngSize(image.data)
        this.frames.set(`${String(app.pid)}:${String(windowId)}`, { boundsWidth: bounds.width, boundsHeight: bounds.height, pixelWidth: size.width, pixelHeight: size.height })
        return { mimeType: 'image/png', data: image.data, pixelWidth: size.width, pixelHeight: size.height, windowId,
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, coordinateSpace: 'window-points' }
      }
      case 'click': {
        const button = (params.mouseButton as string | undefined) ?? 'left'
        const modifier = ((params.modifiers as string[] | undefined) ?? []).map(name => MODIFIERS[name] ?? name)
        if ('snapshotId' in params && 'elementIndex' in params) {
          const target = this.snapshot(params)
          const element = { pid: target.pid, window_id: target.windowId, element_index: target.elementIndex, snapshot_id: target.snapshotId }
          if (button === 'right') await this.call('right_click', element, signal)
          else if (params.clickCount === 2) await this.call('double_click', element, signal)
          else await this.call('click', { ...element, ...button === 'left' ? {} : { button } }, signal)
          return ACTION
        }
        const app = this.running(params.appHandle)
        const windowId = integer(params.windowId, 'windowId')
        const point = this.pixels(app.pid, windowId, params.x as number, params.y as number)
        await this.call('click', { pid: app.pid, window_id: windowId, ...point, button, ...params.clickCount === 2 ? { count: 2 } : {},
          ...modifier.length ? { modifier } : {} }, signal)
        return ACTION
      }
      case 'setValue': {
        const target = this.snapshot(params)
        await this.call('set_value', { pid: target.pid, window_id: target.windowId, element_index: target.elementIndex, snapshot_id: target.snapshotId,
          value: string(params.value, 'value') }, signal)
        return ACTION
      }
      case 'performSecondaryAction': {
        const target = this.snapshot(params)
        const action = string(params.action, 'action').toLowerCase().replace(/[\s_-]/gu, '')
        const element = { pid: target.pid, window_id: target.windowId, element_index: target.elementIndex, snapshot_id: target.snapshotId }
        if (['click', 'press', 'pick', 'activate', 'invoke', 'default', 'toggle', 'select', 'expand', 'collapse', 'expandorcollapse'].includes(action)) await this.call('click', element, signal)
        else if (['showmenu', 'menu', 'contextmenu', 'rightclick'].includes(action)) await this.call('right_click', element, signal)
        else throw new BridgeError('ACTION_UNAVAILABLE', `"${String(params.action)}" is not available here; use click, showMenu, setValue or keyboard input`)
        return ACTION
      }
      case 'typeText': {
        const app = this.running(params.appHandle)
        await this.call('type_text', { pid: app.pid, text: string(params.text, 'text'), ...this.delivery(app.pid) }, signal)
        return ACTION
      }
      case 'paste': {
        const app = this.running(params.appHandle)
        // Through the system clipboard and the platform's paste chord; HTML is delivered as its text.
        await this.call('clipboard_write', { text: string(params.text, 'text') }, signal)
        await this.call('hotkey', { pid: app.pid, keys: [this.platform === 'darwin' ? 'cmd' : 'ctrl', 'v'], ...this.delivery(app.pid) }, signal)
        return ACTION
      }
      case 'pressKey': {
        const app = this.running(params.appHandle)
        const key = string(params.key, 'key')
        const listed = ((params.modifiers as string[] | undefined) ?? []).map(name => MODIFIERS[name] ?? name)
        // "ctrl+shift+t" style chords split into modifiers and the final key.
        const parts = key.length > 1 && key.includes('+') && !key.endsWith('++') ? key.split('+').filter(Boolean) : [key]
        const final = parts.pop()!
        const modifiers = [...listed, ...parts.map(part => MODIFIERS[part.toLowerCase()] ?? part.toLowerCase())]
        await this.call('press_key', { pid: app.pid, key: final, ...modifiers.length ? { modifiers } : {}, ...this.delivery(app.pid) }, signal)
        return ACTION
      }
      case 'scroll': {
        const app = this.running(params.appHandle)
        const windowId = integer(params.windowId, 'windowId')
        const point = this.pixels(app.pid, windowId, params.x as number, params.y as number)
        const dx = params.deltaLinesX as number, dy = params.deltaLinesY as number
        // Positive deltas reveal content above or to the left, as the protocol defines.
        if (dy) await this.call('scroll', { pid: app.pid, window_id: windowId, ...point, direction: dy > 0 ? 'up' : 'down', amount: Math.abs(dy), by: 'line' }, signal)
        if (dx) await this.call('scroll', { pid: app.pid, window_id: windowId, ...point, direction: dx > 0 ? 'left' : 'right', amount: Math.abs(dx), by: 'line' }, signal)
        return ACTION
      }
      case 'drag': {
        const app = this.running(params.appHandle)
        const windowId = integer(params.windowId, 'windowId')
        const from = this.pixels(app.pid, windowId, params.fromX as number, params.fromY as number)
        const to = this.pixels(app.pid, windowId, params.toX as number, params.toY as number)
        const modifier = ((params.modifiers as string[] | undefined) ?? []).map(name => MODIFIERS[name] ?? name)
        await this.call('drag', { pid: app.pid, window_id: windowId, from_x: from.x, from_y: from.y, to_x: to.x, to_y: to.y,
          ...typeof params.durationMs === 'number' ? { duration_ms: params.durationMs } : {},
          ...typeof params.steps === 'number' ? { steps: Math.min(params.steps, 200) } : {},
          ...params.mouseButton ? { button: params.mouseButton } : {}, ...modifier.length ? { modifier } : {} }, signal)
        return ACTION
      }
      case 'hover':
        throw new BridgeError('ACTION_UNAVAILABLE', 'hover is not available on this platform; click or read the advertised element instead')
      case 'selectText':
        throw new BridgeError('ACTION_UNAVAILABLE', 'selectText is not available on this platform; use setValue, or click into the field and use pressKey')
      default:
        throw new BridgeError('UNKNOWN_METHOD', `Unknown method ${method}`)
    }
  }
}
