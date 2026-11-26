/**
 * TP Cowork Electron 主进程内嵌的桌面桌宠控制器。
 *
 * 直接复用 TP Cowork 自身的 Electron 运行时创建透明置顶小窗、点击穿透兜底、跨窗碰撞、
 * 显示器热更新与系统托盘；绝不修改主应用的 `app` 全局身份、硬件加速、userData 或 Dock 状态，
 * 也无需在内网环境下载外部 Electron 运行时。
 * @module dsh-pet/src/desktop/host
 */
import { existsSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { ROUTE_SEGMENT } from '../shared/constants.ts';
import {
  POINTER_POLL_MS,
  TASKBAR_WATCHDOG_TICK_MS,
  TOPMOST_WATCHDOG_ENABLED,
  TOPMOST_WATCHDOG_TICK_MS,
  buildDeskGeometry,
  decideWindowIgnore,
  leavesBody,
  petWindowSize,
  pointerZone,
  shouldReassertTopmost,
  shouldRunTaskbarWatchdog,
  topmostLevel,
  trayPlatformConfig,
  type DeskGeometry,
  type DisplayLike,
  type InputRegions,
  type Point,
  type PointerZone,
  type Rect,
  type WindowMargins,
} from './geometry.ts';
import {
  DESKTOP_BRIDGE_CHANNEL,
  DESKTOP_BRIDGE_VERSION,
  PET_EVENT_BRIDGE_REQUEST,
  PET_OP_BRIDGE_RESPONSE,
  PET_OP_START,
  PET_OP_STOP,
  isDesktopPetRequestMessage,
  parseDesktopPetBridgeResponse,
  parseDesktopPetStartPayload,
  type DesktopPetOpenTarget,
  type DesktopPetSpec,
  type DesktopPetStartPayload,
} from './protocol.ts';
import { HELPER_MOUNT_PREFIX, createDesktopPetProxy, type DesktopPetProxy } from './proxy.ts';

/** 桌宠专用内存 session 分区（与主窗口和内置浏览器完全隔离）。 */
export const PET_SESSION_PARTITION = 'dsh-pet-desktop';

/** Electron WebContents 最小接口。 */
export interface PetWebContentsLike {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
  setBackgroundThrottling(allowed: boolean): void;
  setZoomFactor(factor: number): void;
  focus(): void;
  setWindowOpenHandler(handler: () => { action: 'deny' }): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
}

/** Electron BrowserWindow 最小接口。 */
export interface PetBrowserWindowLike {
  readonly id: number;
  readonly webContents: PetWebContentsLike;
  isDestroyed(): boolean;
  isVisible(): boolean;
  isFocused(): boolean;
  isMinimized?(): boolean;
  restore?(): void;
  show?(): void;
  showInactive(): void;
  focus(): void;
  destroy(): void;
  getBounds(): Rect;
  getContentBounds(): Rect;
  setContentBounds(bounds: Rect, animate?: boolean): void;
  setAlwaysOnTop(flag: boolean, level?: string): void;
  setVisibleOnAllWorkspaces(visible: boolean, options?: { visibleOnFullScreen?: boolean }): void;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
  setSkipTaskbar(skip: boolean): void;
  loadURL(url: string): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
}

/** Electron BrowserWindow 构造器与静态查找方法。 */
export interface PetBrowserWindowCtor {
  new (options: Record<string, unknown>): PetBrowserWindowLike;
  fromWebContents(webContents: PetWebContentsLike): PetBrowserWindowLike | null;
}

/** Electron NativeImage 最小接口。 */
export interface PetNativeImageLike {
  isEmpty(): boolean;
  resize(options: { width: number; height: number }): PetNativeImageLike;
  setTemplateImage?(option: boolean): void;
  getSize(): { width: number; height: number };
  toJPEG(quality: number): Buffer;
}

/** Electron Tray 最小接口。 */
export interface PetTrayLike {
  setToolTip(toolTip: string): void;
  setContextMenu(menu: unknown): void;
  popUpContextMenu(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  destroy(): void;
}

/** 主进程注入给桌宠控制器的 Electron 能力集合。 */
export interface DesktopPetElectronApi {
  readonly BrowserWindow: PetBrowserWindowCtor;
  readonly ipcMain: {
    on(channel: string, listener: (event: { sender: PetWebContentsLike }, ...args: unknown[]) => void): void;
    off(channel: string, listener: (event: { sender: PetWebContentsLike }, ...args: unknown[]) => void): void;
    handle(
      channel: string,
      listener: (event: { sender: PetWebContentsLike }, ...args: unknown[]) => Promise<unknown> | unknown,
    ): void;
    removeHandler(channel: string): void;
  };
  readonly screen: {
    getAllDisplays(): readonly DisplayLike[];
    getPrimaryDisplay(): DisplayLike & {
      readonly size?: { width: number; height: number };
      readonly scaleFactor?: number;
    };
    getCursorScreenPoint(): Point;
    getDisplayMatching(
      rect: Rect,
    ): DisplayLike & { readonly size?: { width: number; height: number }; readonly scaleFactor?: number };
    on(event: string, listener: (...args: unknown[]) => void): void;
    off(event: string, listener: (...args: unknown[]) => void): void;
  };
  readonly session: {
    fromPartition(partition: string): {
      webRequest: {
        onBeforeSendHeaders(
          listener:
            | ((
                details: { url: string; webContentsId?: number; requestHeaders: Record<string, string> },
                callback: (response: { requestHeaders?: Record<string, string> }) => void,
              ) => void)
            | null,
        ): void;
      };
    };
  };
  readonly shell: {
    openExternal(url: string): Promise<void>;
  };
  readonly Tray: new (image: PetNativeImageLike | string) => PetTrayLike;
  readonly Menu: {
    buildFromTemplate(template: readonly Record<string, unknown>[]): unknown;
  };
  readonly nativeImage: {
    createFromPath(path: string): PetNativeImageLike;
  };
  readonly powerMonitor: {
    on(event: string, listener: (...args: unknown[]) => void): void;
    off(event: string, listener: (...args: unknown[]) => void): void;
  };
  readonly desktopCapturer: {
    getSources(options: {
      types: string[];
      thumbnailSize: { width: number; height: number };
    }): Promise<readonly { readonly display_id?: string; readonly thumbnail: PetNativeImageLike }[]>;
  };
}

/** 桌宠控制器的宿主环境选项。 */
export interface DesktopPetHostOptions {
  /** 获取 TP Cowork 主窗口（用于「打开软件」与点击工作气泡直达前台）。 */
  readonly window: () => PetBrowserWindowLike | undefined;
  /** 平台覆写（默认 `process.platform`，便于测试）。 */
  readonly platform?: NodeJS.Platform;
  /** 文件存在检查覆写（默认 `existsSync`，便于测试）。 */
  readonly fileExists?: (path: string) => boolean;
  /** 可选文件读取器（透传给本地代理，便于测试）。 */
  readonly readFileBytes?: (path: string) => Promise<Buffer>;
  /** 可选环境变量读取（默认 `process.env`）。 */
  readonly env?: NodeJS.ProcessEnv;
}

/** 暴露给 `tpcowork-browser/desktop.js` 的桌宠控制器接口。 */
export interface DesktopPetHost {
  /** 判断消息是否属于桌宠通道。 */
  handles(value: unknown): boolean;
  /** 处理来自宿主进程的 `pet:*` 消息。 */
  handleHost(value: unknown, reply: (message: object) => void): Promise<void>;
  /** 宿主退出/断开时停用桌面桌宠并关闭窗口与托盘。 */
  disable(): Promise<void>;
  /** 应用退出时彻底释放窗口、托盘、监听与代理服务。 */
  dispose(): Promise<void>;
}

interface PetFlightState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly size: number;
  readonly bottomPad: number;
}

/** 校验 helperDir 指向合法的 `runtime/electron-helper` 目录。 */
function validateHelperDir(helperDir: string, fileExists: (path: string) => boolean): boolean {
  if (!isAbsolute(helperDir)) return false;
  if (basename(helperDir) !== 'electron-helper') return false;
  return fileExists(join(helperDir, 'index.html')) && fileExists(join(helperDir, 'preload.js'));
}

/** 校验可交给系统浏览器打开的外部地址。 */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 创建运行在 TP Cowork 主进程内的桌面桌宠控制器。
 * @param electron - 主进程提供的 Electron API 集合。
 * @param options - 主窗口句柄与测试可注入依赖。
 * @returns 桌宠控制器。
 */
export function createDesktopPetHost(electron: DesktopPetElectronApi, options: DesktopPetHostOptions): DesktopPetHost {
  const platform = options.platform ?? process.platform;
  const fileExists = options.fileExists ?? existsSync;
  const env = options.env ?? process.env;
  const trayPlat = trayPlatformConfig(platform);

  const windows = new Map<string, PetBrowserWindowLike>();
  const windowCleanups = new Map<number, () => void>();
  const ownedWebContentsIds = new Set<number>();
  const lastRequestedBounds = new Map<number, string>();
  const winMargins = new Map<number, WindowMargins>();
  const windowIgnore = new Map<number, boolean>();
  const inputBusy = new Map<number, boolean>();
  const inputRegions = new Map<number, InputRegions>();
  const offBodyMs = new Map<number, number>();
  const lastPointerZone = new Map<number, PointerZone>();
  const petStates = new Map<string, PetFlightState>();

  let currentReply: ((message: object) => void) | undefined;
  let openTarget: DesktopPetOpenTarget = 'desktop';
  let siteUrl = '';
  let currentHelperDir = '';
  let proxy: DesktopPetProxy | undefined;
  let tray: PetTrayLike | undefined;
  let trayGeneration = 0;
  let petStateTimer: NodeJS.Timeout | undefined;
  let taskbarWatchdogTimer: NodeJS.Timeout | undefined;
  let displaysTimer: NodeJS.Timeout | undefined;
  let hooksRegistered = false;
  let sessionHookInstalled = false;
  let disposed = false;
  let lifecycleQueue: Promise<void> = Promise.resolve();

  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = lifecycleQueue.then(work, work);
    lifecycleQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const replyResult = (
    reply: (message: object) => void,
    id: string,
    value?: unknown,
    error?: { code: string; message: string },
  ): void => {
    reply({
      type: DESKTOP_BRIDGE_CHANNEL,
      version: DESKTOP_BRIDGE_VERSION,
      kind: 'result',
      id,
      ...(error === undefined ? { value } : { error }),
    });
  };

  const ensureProxy = async (): Promise<DesktopPetProxy> => {
    if (proxy === undefined) {
      proxy = createDesktopPetProxy({
        sendBridgeRequest: (req) => {
          const send = currentReply;
          if (!send) throw new Error('desktop pet host IPC is disconnected');
          send({
            type: DESKTOP_BRIDGE_CHANNEL,
            version: DESKTOP_BRIDGE_VERSION,
            kind: 'event',
            id: `pet-bridge-${req.id}`,
            event: PET_EVENT_BRIDGE_REQUEST,
            payload: req,
          });
        },
        ...(options.readFileBytes === undefined ? {} : { readFileBytes: options.readFileBytes }),
      });
    }
    if (proxy.origin() === '') await proxy.start();
    if (!sessionHookInstalled) {
      const petSession = electron.session.fromPartition(PET_SESSION_PARTITION);
      petSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers: Record<string, string> = { ...details.requestHeaders };
        for (const name of Object.keys(headers)) {
          if (name.toLowerCase() === 'x-dsh-pet-token') delete headers[name];
        }
        const activeProxy = proxy;
        const origin = activeProxy?.origin() ?? '';
        if (
          activeProxy !== undefined &&
          origin !== '' &&
          details.webContentsId !== undefined &&
          ownedWebContentsIds.has(details.webContentsId)
        ) {
          try {
            if (new URL(details.url).origin === origin) {
              headers['X-DSH-Pet-Token'] = activeProxy.token();
            }
          } catch {
            // 非法 URL 不注入令牌。
          }
        }
        callback({ requestHeaders: headers });
      });
      sessionHookInstalled = true;
    }
    return proxy;
  };

  const deskGeometry = (): DeskGeometry =>
    buildDeskGeometry(electron.screen.getAllDisplays(), electron.screen.getPrimaryDisplay().id, platform);

  const setWindowIgnore = (win: PetBrowserWindowLike, ignore: boolean): void => {
    if (win.isDestroyed()) return;
    win.setIgnoreMouseEvents(ignore, { forward: true });
    windowIgnore.set(win.id, ignore);
  };

  const reassertTaskbar = (win: PetBrowserWindowLike): void => {
    if (win.isDestroyed()) return;
    win.setSkipTaskbar(true);
  };

  const keepOffTaskbar = (win: PetBrowserWindowLike): void => {
    reassertTaskbar(win);
    const timer = setTimeout(() => reassertTaskbar(win), 0);
    timer.unref?.();
  };

  const stopTaskbarWatchdog = (): void => {
    if (taskbarWatchdogTimer === undefined) return;
    clearInterval(taskbarWatchdogTimer);
    taskbarWatchdogTimer = undefined;
  };

  const startTaskbarWatchdog = (): void => {
    if (taskbarWatchdogTimer !== undefined || !shouldRunTaskbarWatchdog(platform, env.DSH_PET_TASKBAR_WATCHDOG)) {
      return;
    }
    taskbarWatchdogTimer = setInterval(() => {
      for (const win of windows.values()) reassertTaskbar(win);
    }, TASKBAR_WATCHDOG_TICK_MS);
    taskbarWatchdogTimer.unref?.();
  };

  const broadcastPetStates = (): void => {
    if (petStateTimer !== undefined) {
      clearTimeout(petStateTimer);
      petStateTimer = undefined;
    }
    const states: Record<string, PetFlightState> = {};
    for (const [pid, s] of petStates) {
      states[pid] = { x: s.x, y: s.y, vx: s.vx, vy: s.vy, size: s.size, bottomPad: s.bottomPad };
    }
    for (const win of windows.values()) {
      if (!win.isDestroyed()) win.webContents.send('pet:flight-states', states);
    }
  };

  const updatePetState = (petId: string, partial: PetFlightState): void => {
    const prev = petStates.get(petId);
    if (
      prev !== undefined &&
      Object.is(prev.x, partial.x) &&
      Object.is(prev.y, partial.y) &&
      Object.is(prev.vx, partial.vx) &&
      Object.is(prev.vy, partial.vy) &&
      Object.is(prev.size, partial.size) &&
      Object.is(prev.bottomPad, partial.bottomPad)
    ) {
      return;
    }
    petStates.set(petId, partial);
    if (windows.size < 2 || petStateTimer !== undefined) return;
    petStateTimer = setTimeout(broadcastPetStates, 16);
    petStateTimer.unref?.();
  };

  const focusMainWindow = (): boolean => {
    const mainWin = options.window();
    if (mainWin === undefined || mainWin.isDestroyed()) return false;
    if (mainWin.isMinimized?.()) mainWin.restore?.();
    mainWin.show?.();
    mainWin.focus();
    return true;
  };

  const openExternalSite = (url: string): void => {
    let target = url;
    if (isHttpUrl(siteUrl)) {
      try {
        if (new URL(siteUrl).origin === new URL(url).origin) target = siteUrl;
      } catch {
        // 保留原始地址。
      }
    }
    if (!isHttpUrl(target)) return;
    void electron.shell.openExternal(target).catch((error: unknown) => {
      console.error('[dsh-pet-desktop] openExternal failed:', error);
    });
  };

  const loadLogoImage = (helperDir: string): PetNativeImageLike | undefined => {
    if (!helperDir) return undefined;
    const file = join(helperDir, '..', '..', 'assets', 'logo.png');
    try {
      const image = electron.nativeImage.createFromPath(file);
      return image.isEmpty() ? undefined : image;
    } catch {
      return undefined;
    }
  };

  const isOwnedSender = (sender: PetWebContentsLike | undefined): sender is PetWebContentsLike =>
    sender !== undefined && ownedWebContentsIds.has(sender.id);

  // ----- ipcMain handlers (guarded to owned pet windows only) -----

  const onSetBounds = (event: { sender: PetWebContentsLike }, raw: unknown): void => {
    if (!isOwnedSender(event.sender)) return;
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || typeof raw !== 'object' || raw === null) return;
    const bounds = raw as Record<string, unknown>;
    const x = Number(bounds.x);
    const y = Number(bounds.y);
    const width = Number(bounds.width);
    const height = Number(bounds.height);
    if (![x, y, width, height].every(Number.isFinite)) return;
    const rect: Rect = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (lastRequestedBounds.get(win.id) !== key) {
      lastRequestedBounds.set(win.id, key);
      win.setContentBounds(rect, false);
    }
    const ml = Number(bounds.marginL);
    const mt = Number(bounds.marginT);
    const bodyWidth = Number(bounds.size);
    if (Number.isFinite(ml) && Number.isFinite(mt) && Number.isFinite(bodyWidth)) {
      winMargins.set(win.id, { l: ml, t: mt, r: rect.width - ml - bodyWidth });
    }
    const petId = [...windows.keys()].find((id) => windows.get(id) === win);
    if (petId !== undefined) {
      const prev = petStates.get(petId);
      const bx = Number(bounds.boxX);
      const by = Number(bounds.boxY);
      const size = Number(bounds.size);
      const bottomPad = Number(bounds.bottomPad);
      const vx = Number(bounds.vx);
      const vy = Number(bounds.vy);
      updatePetState(petId, {
        x: Number.isFinite(bx) ? bx : x,
        y: Number.isFinite(by) ? by : y,
        size: Number.isFinite(size) && size > 0 ? size : (prev?.size ?? 0),
        bottomPad: Number.isFinite(bottomPad) && bottomPad > 0 ? bottomPad : (prev?.bottomPad ?? 0),
        vx: Number.isFinite(vx) ? vx : 0,
        vy: Number.isFinite(vy) ? vy : 0,
      });
    }
  };

  const onCollideResult = (event: { sender: PetWebContentsLike }, raw: unknown): void => {
    if (!isOwnedSender(event.sender) || typeof raw !== 'object' || raw === null) return;
    const payload = raw as Record<string, unknown>;
    const targetId = typeof payload.targetId === 'string' ? payload.targetId : '';
    const vx = Number(payload.vx);
    const vy = Number(payload.vy);
    if (!targetId || !Number.isFinite(vx) || !Number.isFinite(vy)) return;
    const targetWin = windows.get(targetId);
    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send('pet:hit', { vx, vy });
    }
  };

  const onSetInteractive = (event: { sender: PetWebContentsLike }, interactive: unknown): void => {
    if (!isOwnedSender(event.sender)) return;
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const input = inputRegions.get(win.id);
    const ignoring =
      Boolean(interactive) && input !== undefined && inputBusy.get(win.id) === true
        ? decideWindowIgnore(
            win.getContentBounds(),
            electron.screen.getCursorScreenPoint(),
            false,
            true,
            0,
            input,
            winMargins.get(win.id),
          )
        : !interactive;
    setWindowIgnore(win, ignoring);
  };

  const onInputBusy = (event: { sender: PetWebContentsLike }, busy: unknown): void => {
    if (!isOwnedSender(event.sender)) return;
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    inputBusy.set(win.id, Boolean(busy));
  };

  const onInputRegions = (event: { sender: PetWebContentsLike }, raw: unknown): void => {
    if (!isOwnedSender(event.sender) || typeof raw !== 'object' || raw === null) return;
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const input = raw as { dragging?: unknown; rects?: unknown };
    if (!Array.isArray(input.rects)) return;
    const rects: Rect[] = [];
    for (const item of input.rects) {
      if (typeof item !== 'object' || item === null) continue;
      const r = item as Record<string, unknown>;
      const x = Number(r.x);
      const y = Number(r.y);
      const width = Number(r.width);
      const height = Number(r.height);
      if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
        rects.push({ x, y, width, height });
      }
    }
    inputRegions.set(win.id, { dragging: input.dragging === true, rects });
  };

  const onRequestKeyboardFocus = (event: { sender: PetWebContentsLike }): void => {
    if (!isOwnedSender(event.sender)) return;
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || win.isFocused()) return;
    win.focus();
    win.webContents.focus();
  };

  const onOpenSite = (event: { sender: PetWebContentsLike }, raw: unknown): void => {
    if (!isOwnedSender(event.sender)) return;
    const url = typeof raw === 'object' && raw !== null ? String((raw as { url?: unknown }).url ?? '') : '';
    if (openTarget === 'desktop') {
      if (focusMainWindow()) return;
    }
    if (isHttpUrl(url)) openExternalSite(url);
  };

  const onFocusHost = (event: { sender: PetWebContentsLike }): void => {
    if (!isOwnedSender(event.sender)) return;
    if (openTarget === 'desktop') focusMainWindow();
  };

  const onCaptureScreen = async (event: { sender: PetWebContentsLike }): Promise<unknown> => {
    if (!isOwnedSender(event.sender)) throw new Error('dsh-pet: rejected screen capture from non-pet window');
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    const display =
      win && !win.isDestroyed()
        ? electron.screen.getDisplayMatching(win.getBounds())
        : electron.screen.getPrimaryDisplay();
    const scale = display.scaleFactor ?? 1;
    const width = display.size?.width ?? display.bounds.width;
    const height = display.size?.height ?? display.bounds.height;
    const size = {
      width: Math.max(1, Math.min(4096, Math.round(width * scale))),
      height: Math.max(1, Math.min(4096, Math.round(height * scale))),
    };
    const sources = await electron.desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const source = sources.find((item) => String(item.display_id) === String(display.id)) ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) return null;
    const thumbnail = source.thumbnail;
    const thumbSize = thumbnail.getSize();
    const data = thumbnail.toJPEG(85).toString('base64');
    return {
      mediaType: 'image/jpeg',
      data,
      width: thumbSize.width,
      height: thumbSize.height,
      bytes: Math.floor((data.length * 3) / 4),
    };
  };

  const pushDisplays = (): void => {
    if (windows.size === 0) return;
    const geo = deskGeometry();
    lastRequestedBounds.clear();
    for (const win of windows.values()) {
      if (win.isDestroyed()) continue;
      keepOffTaskbar(win);
      win.webContents.send('pet:displays', geo);
    }
  };

  const scheduleDisplays = (): void => {
    if (displaysTimer !== undefined) clearTimeout(displaysTimer);
    displaysTimer = setTimeout(() => {
      displaysTimer = undefined;
      pushDisplays();
    }, 300);
    displaysTimer.unref?.();
  };

  const reassertAllTaskbar = (): void => {
    for (const win of windows.values()) keepOffTaskbar(win);
  };

  const ensureHooksRegistered = (): void => {
    if (hooksRegistered) return;
    hooksRegistered = true;
    electron.ipcMain.on('pet:set-bounds', onSetBounds);
    electron.ipcMain.on('pet:collide-result', onCollideResult);
    electron.ipcMain.on('pet:set-interactive', onSetInteractive);
    electron.ipcMain.on('pet:input-busy', onInputBusy);
    electron.ipcMain.on('pet:input-regions', onInputRegions);
    electron.ipcMain.on('pet:request-keyboard-focus', onRequestKeyboardFocus);
    electron.ipcMain.on('pet:open-site', onOpenSite);
    electron.ipcMain.on('pet:focus-host', onFocusHost);
    electron.ipcMain.handle('pet:capture-screen', onCaptureScreen);
    electron.screen.on('display-metrics-changed', scheduleDisplays);
    electron.screen.on('display-added', scheduleDisplays);
    electron.screen.on('display-removed', scheduleDisplays);
    electron.powerMonitor.on('resume', reassertAllTaskbar);
    electron.powerMonitor.on('unlock-screen', reassertAllTaskbar);
  };

  const removeHooks = (): void => {
    if (!hooksRegistered) return;
    hooksRegistered = false;
    electron.ipcMain.off('pet:set-bounds', onSetBounds);
    electron.ipcMain.off('pet:collide-result', onCollideResult);
    electron.ipcMain.off('pet:set-interactive', onSetInteractive);
    electron.ipcMain.off('pet:input-busy', onInputBusy);
    electron.ipcMain.off('pet:input-regions', onInputRegions);
    electron.ipcMain.off('pet:request-keyboard-focus', onRequestKeyboardFocus);
    electron.ipcMain.off('pet:open-site', onOpenSite);
    electron.ipcMain.off('pet:focus-host', onFocusHost);
    electron.ipcMain.removeHandler('pet:capture-screen');
    electron.screen.off('display-metrics-changed', scheduleDisplays);
    electron.screen.off('display-added', scheduleDisplays);
    electron.screen.off('display-removed', scheduleDisplays);
    electron.powerMonitor.off('resume', reassertAllTaskbar);
    electron.powerMonitor.off('unlock-screen', reassertAllTaskbar);
    if (displaysTimer !== undefined) {
      clearTimeout(displaysTimer);
      displaysTimer = undefined;
    }
  };

  const destroyTray = (): void => {
    trayGeneration += 1;
    const active = tray;
    tray = undefined;
    if (!active) return;
    try {
      active.destroy();
    } catch (error) {
      console.error('[dsh-pet-desktop] tray destroy failed:', error);
    }
  };

  const toggleDisplay = (display: string): string =>
    display === 'both' ? 'web' : display === 'web' ? 'both' : display === 'desktop' ? 'none' : 'desktop';

  const syncTray = async (enabled: boolean, helperDir: string, activeProxy: DesktopPetProxy): Promise<void> => {
    const gen = ++trayGeneration;
    if (!enabled) {
      destroyTray();
      return;
    }
    try {
      const resp = await activeProxy.requestHost('GET', `${ROUTE_SEGMENT}/config`);
      if (gen !== trayGeneration || disposed) return;
      const merged = JSON.parse(resp.body || '{}') as Record<string, { trayEnabled?: unknown; pets?: unknown }>;
      if (merged.main && merged.main.trayEnabled === false) {
        destroyTray();
        return;
      }
      const pets = Object.values(merged)
        .flatMap((conf) => (conf && Array.isArray(conf.pets) ? conf.pets : []))
        .map((pet) => {
          const row = pet && typeof pet === 'object' ? (pet as Record<string, unknown>) : {};
          return {
            id: String(row.id ?? ''),
            name: String(row.name ?? '').trim(),
            display: String(row.display ?? ''),
          };
        })
        .filter((pet) => pet.id !== '');
      if (pets.length === 0) {
        destroyTray();
        return;
      }
      const menu = electron.Menu.buildFromTemplate(
        pets.map((pet) => ({
          label: pet.name || pet.id,
          type: 'checkbox',
          checked: pet.display === 'desktop' || pet.display === 'both',
          click: () => {
            void activeProxy
              .requestHost(
                'POST',
                `${ROUTE_SEGMENT}/pet-display`,
                JSON.stringify({ id: pet.id, display: toggleDisplay(pet.display) }),
              )
              .catch((error: unknown) => {
                console.error('[dsh-pet-desktop] tray pet-display failed:', error);
              });
          },
        })),
      );
      if (gen !== trayGeneration || disposed) return;
      if (tray === undefined) {
        const baseIcon = loadLogoImage(helperDir);
        if (baseIcon === undefined) return;
        const resized = baseIcon.resize({ width: 16, height: 16 });
        if (trayPlat.templateImage) resized.setTemplateImage?.(true);
        const created = new electron.Tray(resized);
        created.setToolTip('CoWork 桌面宠物');
        if (trayPlat.leftClickPopsMenu) created.on('click', () => created.popUpContextMenu());
        tray = created;
      }
      tray.setContextMenu(menu);
    } catch (error) {
      if (gen === trayGeneration && !disposed) {
        console.error('[dsh-pet-desktop] tray sync failed:', error);
      }
    }
  };

  const closeAllWindows = (): void => {
    stopTaskbarWatchdog();
    if (petStateTimer !== undefined) {
      clearTimeout(petStateTimer);
      petStateTimer = undefined;
    }
    const open = [...windows.values()];
    windows.clear();
    petStates.clear();
    lastRequestedBounds.clear();
    winMargins.clear();
    windowIgnore.clear();
    inputBusy.clear();
    inputRegions.clear();
    offBodyMs.clear();
    lastPointerZone.clear();
    for (const win of open) {
      try {
        const cleanup = windowCleanups.get(win.id);
        windowCleanups.delete(win.id);
        cleanup?.();
        ownedWebContentsIds.delete(win.webContents.id);
        if (!win.isDestroyed()) win.destroy();
      } catch (error) {
        console.error('[dsh-pet-desktop] window destroy failed:', error);
      }
    }
  };

  const startPointerFallback = (win: PetBrowserWindowLike): (() => void) => {
    const timer = setInterval(() => {
      if (win.isDestroyed()) return;
      const bounds = win.getBounds();
      if (bounds.width < 8 || bounds.height < 8) return;
      const ignoring = windowIgnore.get(win.id) !== false;
      const busy = inputBusy.get(win.id) === true;
      const point = electron.screen.getCursorScreenPoint();
      const margin = winMargins.get(win.id);
      const zone = pointerZone(bounds, point, margin);
      const prevZone = lastPointerZone.get(win.id);
      lastPointerZone.set(win.id, zone);
      if (!busy && leavesBody(prevZone, zone)) win.webContents.send('pet:pointer-left');
      const nextMs = !busy && zone === 'margin' ? (offBodyMs.get(win.id) ?? 0) + POINTER_POLL_MS : 0;
      offBodyMs.set(win.id, nextMs);
      const next = decideWindowIgnore(bounds, point, ignoring, busy, nextMs, inputRegions.get(win.id), margin);
      if (next !== ignoring) setWindowIgnore(win, next);
    }, POINTER_POLL_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  };

  const startTopmostWatchdog = (win: PetBrowserWindowLike): (() => void) => {
    let lastAssertMs = Date.now();
    const timer = setInterval(() => {
      const nowMs = Date.now();
      const due = shouldReassertTopmost(
        { nowMs, lastAssertMs, destroyed: win.isDestroyed(), visible: win.isVisible() },
        TOPMOST_WATCHDOG_ENABLED,
      );
      if (!due) return;
      lastAssertMs = nowMs;
      win.setAlwaysOnTop(true, topmostLevel(platform));
    }, TOPMOST_WATCHDOG_TICK_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  };

  const createPetWindow = (
    pet: DesktopPetSpec,
    index: number,
    geo: DeskGeometry,
    helperDir: string,
    proxyOrigin: string,
    target: DesktopPetOpenTarget,
  ): PetBrowserWindowLike => {
    const icon = loadLogoImage(helperDir);
    const size = petWindowSize(pet.size);
    const win = new electron.BrowserWindow({
      ...size,
      x: geo.hull.x,
      y: geo.hull.y,
      show: false,
      useContentSize: true,
      enableLargerThanScreen: true,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      focusable: true,
      backgroundColor: '#00000000',
      ...(icon === undefined ? {} : { icon }),
      webPreferences: {
        preload: join(helperDir, 'preload.js'),
        partition: PET_SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        paintWhenInitiallyHidden: false,
        spellcheck: false,
      },
    });
    const wcId = win.webContents.id;
    ownedWebContentsIds.add(wcId);

    win.setAlwaysOnTop(true, topmostLevel(platform));
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.setBackgroundThrottling(false);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event: unknown, url: unknown) => {
      const ev = event as { preventDefault?: () => void };
      try {
        if (typeof url !== 'string' || new URL(url).origin !== proxyOrigin) ev.preventDefault?.();
      } catch {
        ev.preventDefault?.();
      }
    });
    win.webContents.on('context-menu', (event: unknown) => {
      (event as { preventDefault?: () => void }).preventDefault?.();
    });
    win.webContents.on('did-finish-load', () => {
      if (!win.isDestroyed()) win.webContents.setZoomFactor(1);
    });
    setWindowIgnore(win, true);
    win.on('show', () => keepOffTaskbar(win));
    win.once('ready-to-show', () => {
      keepOffTaskbar(win);
      win.showInactive();
    });
    win.webContents.once('did-finish-load', () => {
      const timer = setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible()) win.showInactive();
      }, 400);
      timer.unref?.();
    });

    const stopPointer = startPointerFallback(win);
    const stopTopmost = startTopmostWatchdog(win);
    const cleanupTimers = (): void => {
      stopPointer();
      stopTopmost();
    };
    windowCleanups.set(win.id, cleanupTimers);
    win.on('closed', () => {
      const cleanup = windowCleanups.get(win.id);
      windowCleanups.delete(win.id);
      cleanup?.();
      ownedWebContentsIds.delete(wcId);
      if (windows.get(pet.id) === win) windows.delete(pet.id);
      petStates.delete(pet.id);
      broadcastPetStates();
      lastRequestedBounds.delete(win.id);
      winMargins.delete(win.id);
      windowIgnore.delete(win.id);
      inputBusy.delete(win.id);
      inputRegions.delete(win.id);
      offBodyMs.delete(win.id);
      lastPointerZone.delete(win.id);
      if (windows.size === 0) stopTaskbarWatchdog();
    });

    const pageUrl = new URL(`${proxyOrigin}${HELPER_MOUNT_PREFIX}index.html`);
    const query: Record<string, string> = {
      configUrl: `${proxyOrigin}${ROUTE_SEGMENT}/config`,
      bridge: '0',
      openTarget: target,
      scale: '1',
      petIndex: String(index),
      workAreaW: String(geo.hull.width),
      workAreaH: String(geo.hull.height),
      workAreaX: String(geo.hull.x),
      workAreaY: String(geo.hull.y),
      areas: JSON.stringify(geo.areas),
      workAreas: JSON.stringify(geo.workAreas),
      topInsetRatio: String(geo.topInsetRatio),
      panels: JSON.stringify(geo.panels),
      primaryIndex: String(geo.primaryIndex),
      isWindowClampedToWorkArea: platform === 'linux' ? '1' : '0',
    };
    for (const [key, value] of Object.entries(query)) pageUrl.searchParams.set(key, value);

    void win.loadURL(pageUrl.href).catch((error: unknown) => {
      if (win.isDestroyed()) return;
      console.error(`[dsh-pet-desktop] page load failed (${pet.id}):`, error);
      win.destroy();
    });

    return win;
  };

  const applyStart = async (
    payload: DesktopPetStartPayload,
  ): Promise<{ readonly ok: true; readonly windows: number }> => {
    if (disposed) throw new Error('Desktop pet host has been disposed');
    if (!validateHelperDir(payload.helperDir, fileExists)) {
      throw new Error(`Invalid desktop pet helper directory: ${payload.helperDir}`);
    }
    const activeProxy = await ensureProxy();
    activeProxy.setHelperDir(payload.helperDir);
    ensureHooksRegistered();

    currentHelperDir = payload.helperDir;
    openTarget = payload.openTarget;
    siteUrl = payload.siteUrl ?? '';

    closeAllWindows();
    const geo = deskGeometry();
    const origin = activeProxy.origin();
    for (let index = 0; index < payload.pets.length; index += 1) {
      const pet = payload.pets[index];
      windows.set(pet.id, createPetWindow(pet, index, geo, currentHelperDir, origin, openTarget));
    }
    if (windows.size > 0) startTaskbarWatchdog();
    void syncTray(payload.trayEnabled, currentHelperDir, activeProxy);
    return { ok: true, windows: windows.size };
  };

  const applyStop = async (): Promise<{ readonly ok: true }> => {
    closeAllWindows();
    destroyTray();
    proxy?.cancelPending('desktop pet stopped');
    return { ok: true };
  };

  const handleHost = async (value: unknown, reply: (message: object) => void): Promise<void> => {
    if (!isDesktopPetRequestMessage(value)) return;

    // 应答必须绕过生命周期串行队列立即交付，避免 start/tray 内部请求与应答互锁。
    // 且不得用单次应答的 reply 覆盖事件回传通道 currentReply。
    if (value.op === PET_OP_BRIDGE_RESPONSE) {
      const parsed = parseDesktopPetBridgeResponse(value.payload);
      if (parsed === undefined) {
        replyResult(reply, value.id, undefined, { code: 'invalid_request', message: 'Invalid pet bridge response' });
        return;
      }
      proxy?.resolveBridge(parsed);
      replyResult(reply, value.id, { ok: true });
      return;
    }

    if (value.op === PET_OP_START) {
      const parsed = parseDesktopPetStartPayload(value.payload);
      if (parsed === undefined) {
        replyResult(reply, value.id, undefined, { code: 'invalid_request', message: 'Invalid pet start payload' });
        return;
      }
      try {
        const result = await enqueue(() => {
          currentReply = reply;
          return applyStart(parsed);
        });
        replyResult(reply, value.id, result);
      } catch (error) {
        replyResult(reply, value.id, undefined, {
          code: 'execution_error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (value.op === PET_OP_STOP) {
      try {
        const result = await enqueue(() => applyStop());
        replyResult(reply, value.id, result);
      } catch (error) {
        replyResult(reply, value.id, undefined, {
          code: 'execution_error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const disable = async (): Promise<void> => {
    await enqueue(async () => {
      currentReply = undefined;
      closeAllWindows();
      destroyTray();
      proxy?.cancelPending('desktop host disconnected');
    });
  };

  const dispose = async (): Promise<void> => {
    await enqueue(async () => {
      disposed = true;
      currentReply = undefined;
      closeAllWindows();
      destroyTray();
      removeHooks();
      if (sessionHookInstalled) {
        sessionHookInstalled = false;
        try {
          electron.session.fromPartition(PET_SESSION_PARTITION).webRequest.onBeforeSendHeaders(null);
        } catch {
          // 退出阶段忽略 session 清理异常。
        }
      }
      await proxy?.stop();
      proxy = undefined;
    });
  };

  return {
    handles: isDesktopPetRequestMessage,
    handleHost,
    disable,
    dispose,
  };
}
