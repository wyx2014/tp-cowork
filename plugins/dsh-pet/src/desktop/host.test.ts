/**
 * 主进程内嵌桌宠（protocol / geometry / proxy / host）单元测试。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DESKTOP_BRIDGE_CHANNEL,
  DESKTOP_BRIDGE_VERSION,
  PET_EVENT_BRIDGE_REQUEST,
  PET_OP_BRIDGE_RESPONSE,
  PET_OP_START,
  PET_OP_STOP,
  isDesktopPetBridgeEvent,
  isDesktopPetRequestMessage,
  parseDesktopPetBridgeResponse,
  parseDesktopPetStartPayload,
} from './protocol.ts';
import { buildDeskGeometry, decideWindowIgnore, petWindowSize, trayPlatformConfig } from './geometry.ts';
import { HELPER_MOUNT_PREFIX, PET_TOKEN_HEADER, createDesktopPetProxy, resolveHelperStaticFile } from './proxy.ts';
import {
  PET_SESSION_PARTITION,
  createDesktopPetHost,
  type DesktopPetElectronApi,
  type PetBrowserWindowLike,
  type PetNativeImageLike,
  type PetTrayLike,
  type PetWebContentsLike,
} from './host.ts';

function makeFakeHelperDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-helper-'));
  const helperDir = join(root, 'runtime', 'electron-helper');
  mkdirSync(join(helperDir, 'sprite'), { recursive: true });
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(helperDir, 'index.html'), '<!doctype html><html><body>pet</body></html>');
  writeFileSync(join(helperDir, 'preload.js'), 'module.exports = {};');
  writeFileSync(join(helperDir, 'sprite', 'window-fit.js'), 'window.__fit = true;');
  writeFileSync(join(root, 'assets', 'logo.png'), 'fake-png');
  return root;
}

class FakeWebContents extends EventEmitter implements PetWebContentsLike {
  readonly id: number;
  destroyed = false;
  zoomFactor = 1;
  backgroundThrottling = true;
  focused = false;
  sent: Array<{ channel: string; args: unknown[] }> = [];
  windowOpenHandler: (() => { action: 'deny' }) | undefined;

  constructor(id: number) {
    super();
    this.id = id;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, ...args: unknown[]): void {
    this.sent.push({ channel, args });
  }

  setBackgroundThrottling(allowed: boolean): void {
    this.backgroundThrottling = allowed;
  }

  setZoomFactor(factor: number): void {
    this.zoomFactor = factor;
  }

  focus(): void {
    this.focused = true;
  }

  setWindowOpenHandler(handler: () => { action: 'deny' }): void {
    this.windowOpenHandler = handler;
  }
}

class FakeBrowserWindow extends EventEmitter implements PetBrowserWindowLike {
  readonly id: number;
  readonly options: Record<string, unknown>;
  readonly webContents: FakeWebContents;
  destroyed = false;
  visible = false;
  focused = false;
  minimized = false;
  bounds = { x: 0, y: 0, width: 400, height: 400 };
  loadedUrl = '';
  ignoreMouse = { ignore: false, forward: false };
  skipTaskbarCalls = 0;
  alwaysOnTopCalls: Array<{ flag: boolean; level?: string }> = [];
  showCalls = 0;
  restoreCalls = 0;
  focusCalls = 0;

  constructor(id: number, wcId: number, options: Record<string, unknown>) {
    super();
    this.id = id;
    this.options = options;
    this.webContents = new FakeWebContents(wcId);
    if (typeof options.width === 'number' && typeof options.height === 'number') {
      this.bounds = {
        x: typeof options.x === 'number' ? options.x : 0,
        y: typeof options.y === 'number' ? options.y : 0,
        width: options.width,
        height: options.height,
      };
    }
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isVisible(): boolean {
    return this.visible;
  }

  isFocused(): boolean {
    return this.focused;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  restore(): void {
    this.minimized = false;
    this.restoreCalls += 1;
  }

  show(): void {
    this.visible = true;
    this.showCalls += 1;
    this.emit('show');
  }

  showInactive(): void {
    this.visible = true;
    this.emit('show');
  }

  focus(): void {
    this.focused = true;
    this.focusCalls += 1;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.webContents.destroyed = true;
    this.emit('closed');
  }

  getBounds() {
    return { ...this.bounds };
  }

  getContentBounds() {
    return { ...this.bounds };
  }

  setContentBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.bounds = { ...bounds };
  }

  setAlwaysOnTop(flag: boolean, level?: string): void {
    this.alwaysOnTopCalls.push({ flag, level });
  }

  setVisibleOnAllWorkspaces(): void {}

  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void {
    this.ignoreMouse = { ignore, forward: Boolean(options?.forward) };
  }

  setSkipTaskbar(skip: boolean): void {
    if (skip) this.skipTaskbarCalls += 1;
  }

  async loadURL(url: string): Promise<void> {
    this.loadedUrl = url;
  }
}

function makeFakeImage(empty = false): PetNativeImageLike {
  const img: PetNativeImageLike = {
    isEmpty: () => empty,
    resize: () => img,
    setTemplateImage: () => {},
    getSize: () => ({ width: 1280, height: 720 }),
    toJPEG: () => Buffer.from('jpeg-bytes'),
  };
  return img;
}

function createFakeElectronEnv() {
  let nextWinId = 10;
  let nextWcId = 100;
  const createdWindows: FakeBrowserWindow[] = [];
  const createdTrays: Array<{
    tooltip: string;
    menu: unknown;
    destroyed: boolean;
    emitter: EventEmitter;
  }> = [];
  const ipcListeners = new Map<string, Set<(event: { sender: PetWebContentsLike }, ...args: unknown[]) => void>>();
  const ipcHandlers = new Map<
    string,
    (event: { sender: PetWebContentsLike }, ...args: unknown[]) => Promise<unknown> | unknown
  >();
  const screenEmitter = new EventEmitter();
  const powerEmitter = new EventEmitter();
  const openedExternal: string[] = [];
  let beforeSendHeaders:
    | ((
        details: { url: string; webContentsId?: number; requestHeaders: Record<string, string> },
        callback: (response: { requestHeaders?: Record<string, string> }) => void,
      ) => void)
    | null = null;
  let requestedPartition = '';

  class FakeBrowserWindowCtor extends FakeBrowserWindow {
    constructor(options: Record<string, unknown>) {
      super(++nextWinId, ++nextWcId, options);
      createdWindows.push(this);
    }

    static fromWebContents(wc: PetWebContentsLike): PetBrowserWindowLike | null {
      return createdWindows.find((win) => win.webContents === wc) ?? null;
    }
  }

  class FakeTrayCtor implements PetTrayLike {
    readonly state = { tooltip: '', menu: undefined as unknown, destroyed: false, emitter: new EventEmitter() };

    constructor() {
      createdTrays.push(this.state);
    }

    setToolTip(toolTip: string): void {
      this.state.tooltip = toolTip;
    }

    setContextMenu(menu: unknown): void {
      this.state.menu = menu;
    }

    popUpContextMenu(): void {}

    on(event: string, listener: (...args: unknown[]) => void): void {
      this.state.emitter.on(event, listener);
    }

    destroy(): void {
      this.state.destroyed = true;
    }
  }

  const display = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1,
  };

  const api: DesktopPetElectronApi = {
    BrowserWindow: FakeBrowserWindowCtor,
    ipcMain: {
      on(channel, listener) {
        let set = ipcListeners.get(channel);
        if (!set) {
          set = new Set();
          ipcListeners.set(channel, set);
        }
        set.add(listener);
      },
      off(channel, listener) {
        ipcListeners.get(channel)?.delete(listener);
      },
      handle(channel, listener) {
        ipcHandlers.set(channel, listener);
      },
      removeHandler(channel) {
        ipcHandlers.delete(channel);
      },
    },
    screen: {
      getAllDisplays: () => [display],
      getPrimaryDisplay: () => display,
      getCursorScreenPoint: () => ({ x: 500, y: 500 }),
      getDisplayMatching: () => display,
      on: (event, listener) => {
        screenEmitter.on(event, listener);
      },
      off: (event, listener) => {
        screenEmitter.off(event, listener);
      },
    },
    session: {
      fromPartition: (partition) => {
        requestedPartition = partition;
        return {
          webRequest: {
            onBeforeSendHeaders: (listener) => {
              beforeSendHeaders = listener;
            },
          },
        };
      },
    },
    shell: {
      openExternal: async (url) => {
        openedExternal.push(url);
      },
    },
    Tray: FakeTrayCtor,
    Menu: {
      buildFromTemplate: (template) => template,
    },
    nativeImage: {
      createFromPath: () => makeFakeImage(false),
    },
    powerMonitor: {
      on: (event, listener) => {
        powerEmitter.on(event, listener);
      },
      off: (event, listener) => {
        powerEmitter.off(event, listener);
      },
    },
    desktopCapturer: {
      getSources: async () => [{ display_id: '1', thumbnail: makeFakeImage(false) }],
    },
  };

  return {
    api,
    createdWindows,
    createdTrays,
    ipcListeners,
    ipcHandlers,
    screenEmitter,
    powerEmitter,
    openedExternal,
    getBeforeSendHeaders: () => beforeSendHeaders,
    getRequestedPartition: () => requestedPartition,
  };
}

describe('desktop/protocol — IPC 协议校验', () => {
  test('仅识别合法的 pet:* 请求并拒绝 tpcowork-browser 自身操作', () => {
    assert.equal(
      isDesktopPetRequestMessage({
        type: DESKTOP_BRIDGE_CHANNEL,
        version: DESKTOP_BRIDGE_VERSION,
        kind: 'request',
        id: 'req-1',
        op: PET_OP_START,
      }),
      true,
    );
    assert.equal(
      isDesktopPetRequestMessage({
        type: DESKTOP_BRIDGE_CHANNEL,
        version: DESKTOP_BRIDGE_VERSION,
        kind: 'request',
        id: 'req-2',
        op: 'command',
      }),
      false,
    );
    assert.equal(
      isDesktopPetRequestMessage({
        type: DESKTOP_BRIDGE_CHANNEL,
        version: 2,
        kind: 'request',
        id: 'req-3',
        op: PET_OP_STOP,
      }),
      false,
    );
  });

  test('校验 pet:start、pet:bridge-request 与 pet:bridge-response 载荷', () => {
    const start = parseDesktopPetStartPayload({
      pets: [{ id: 'main', size: 320 }],
      trayEnabled: true,
      helperDir: '/tmp/runtime/electron-helper',
      openTarget: 'desktop',
      siteUrl: 'http://127.0.0.1:3080',
    });
    assert.deepEqual(start, {
      pets: [{ id: 'main', size: 320 }],
      trayEnabled: true,
      helperDir: '/tmp/runtime/electron-helper',
      openTarget: 'desktop',
      siteUrl: 'http://127.0.0.1:3080',
    });
    assert.equal(parseDesktopPetStartPayload({ pets: [{ id: 'a', size: -1 }], helperDir: '/a' }), undefined);
    assert.equal(
      isDesktopPetBridgeEvent({
        type: DESKTOP_BRIDGE_CHANNEL,
        version: DESKTOP_BRIDGE_VERSION,
        kind: 'event',
        id: 'ev-1',
        event: PET_EVENT_BRIDGE_REQUEST,
        payload: { id: 1, method: 'GET', url: '/dsh-pet-7340/config' },
      }),
      true,
    );
    assert.deepEqual(
      parseDesktopPetBridgeResponse({ id: 3, status: 200, contentType: 'application/json', body: '{}' }),
      { id: 3, status: 200, contentType: 'application/json', body: '{}' },
    );
  });
});

describe('desktop/geometry — 几何与平台配置', () => {
  test('窗口尺寸、桌面外接矩形与托盘平台配置符合预期', () => {
    assert.deepEqual(petWindowSize(400), { width: 800, height: 644 });
    const geo = buildDeskGeometry(
      [
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          workArea: { x: 0, y: 0, width: 1920, height: 1040 },
        },
      ],
      1,
      'win32',
    );
    assert.equal(geo.primaryIndex, 0);
    assert.deepEqual(geo.hull, { x: 0, y: 0, width: 1920, height: 1040 });
    assert.equal(
      decideWindowIgnore({ x: 0, y: 0, width: 400, height: 400 }, { x: 200, y: 200 }, true, false, 0),
      false,
    );
    assert.deepEqual(trayPlatformConfig('win32'), { templateImage: false, leftClickPopsMenu: true });
    assert.deepEqual(trayPlatformConfig('darwin'), { templateImage: true, leftClickPopsMenu: false });
  });
});

describe('desktop/proxy — 受鉴权环回静态与业务代理', () => {
  test('鉴权、静态目录穿越拦截、业务转发与文件 Range 支持', async (t) => {
    const root = makeFakeHelperDir();
    const helperDir = join(root, 'runtime', 'electron-helper');
    const mediaFile = join(root, 'assets', 'sample.bin');
    writeFileSync(mediaFile, Buffer.from('0123456789abcdef'));

    const received: Array<{ id: number; method: string; url: string; body?: string }> = [];
    const proxy = createDesktopPetProxy({
      sendBridgeRequest: (req) => {
        received.push(req);
        if (req.url === '/dsh-pet-7340/config') {
          proxy.resolveBridge({
            id: req.id,
            status: 200,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify({ main: { pets: [] } }),
          });
        } else if (req.url === '/dsh-pet-7340/webm/test.webm') {
          proxy.resolveBridge({
            id: req.id,
            status: 200,
            contentType: 'video/webm',
            file: mediaFile,
          });
        } else {
          proxy.resolveBridge({ id: req.id, status: 404, body: 'missing' });
        }
      },
    });
    t.after(async () => {
      await proxy.stop();
      rmSync(root, { recursive: true, force: true });
    });

    const origin = await proxy.start();
    proxy.setHelperDir(helperDir);
    const authHeader = { [PET_TOKEN_HEADER]: proxy.token() };

    // 无令牌与错令牌必须 403
    const unauth = await fetch(`${origin}${HELPER_MOUNT_PREFIX}index.html`);
    assert.equal(unauth.status, 403);
    const wrong = await fetch(`${origin}${HELPER_MOUNT_PREFIX}index.html`, {
      headers: { [PET_TOKEN_HEADER]: 'wrong-token' },
    });
    assert.equal(wrong.status, 403);

    // 静态页面与子目录脚本正常返回
    const html = await fetch(`${origin}${HELPER_MOUNT_PREFIX}index.html`, { headers: authHeader });
    assert.equal(html.status, 200);
    assert.match(await html.text(), /pet/);
    const sub = await fetch(`${origin}${HELPER_MOUNT_PREFIX}sprite/window-fit.js`, { headers: authHeader });
    assert.equal(sub.status, 200);
    assert.match(await sub.text(), /__fit/);

    // 目录穿越与非白名单后缀被拦
    assert.equal(resolveHelperStaticFile(helperDir, '../assets/logo.png'), undefined);
    assert.equal(resolveHelperStaticFile(helperDir, 'package.json'), undefined);
    const traversal = await fetch(`${origin}${HELPER_MOUNT_PREFIX}%2e%2e/assets/logo.png`, { headers: authHeader });
    assert.equal(traversal.status, 404);

    // 业务接口经 bridge 回调转发
    const cfg = await fetch(`${origin}/dsh-pet-7340/config`, { headers: authHeader });
    assert.equal(cfg.status, 200);
    assert.deepEqual(await cfg.json(), { main: { pets: [] } });
    assert.equal(received[0].method, 'GET');

    // 文件响应支持完整读取、206 Range 与 416 越界
    const full = await fetch(`${origin}/dsh-pet-7340/webm/test.webm`, { headers: authHeader });
    assert.equal(full.status, 200);
    assert.equal(await full.text(), '0123456789abcdef');

    const partial = await fetch(`${origin}/dsh-pet-7340/webm/test.webm`, {
      headers: { ...authHeader, Range: 'bytes=4-9' },
    });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 4-9/16');
    assert.equal(await partial.text(), '456789');

    const badRange = await fetch(`${origin}/dsh-pet-7340/webm/test.webm`, {
      headers: { ...authHeader, Range: 'bytes=99-120' },
    });
    assert.equal(badRange.status, 416);
  });
});

describe('desktop/host — Electron 主进程桌宠控制器', () => {
  test('完整生命周期：窗口创建、令牌隔离、IPC 门控、托盘联动与彻底清理', async (t) => {
    const root = makeFakeHelperDir();
    const helperDir = join(root, 'runtime', 'electron-helper');
    const env = createFakeElectronEnv();
    const mainWindow = new FakeBrowserWindow(1, 1, {});
    mainWindow.minimized = true;

    const host = createDesktopPetHost(env.api, {
      window: () => mainWindow,
      platform: 'win32',
    });

    const replies: Array<Record<string, unknown>> = [];
    const reply = (msg: object): void => {
      const record = msg as Record<string, unknown>;
      replies.push(record);
      // 自动响应主进程向宿主发出的 pet:bridge-request 事件（例如托盘拉取 /config）
      if (isDesktopPetBridgeEvent(record)) {
        const req = record.payload;
        const body =
          req.url === '/dsh-pet-7340/config'
            ? JSON.stringify({
                main: { trayEnabled: true, pets: [{ id: 'fish', name: '大肥鱼', display: 'desktop' }] },
              })
            : JSON.stringify({ ok: true });
        void host.handleHost(
          {
            type: DESKTOP_BRIDGE_CHANNEL,
            version: DESKTOP_BRIDGE_VERSION,
            kind: 'request',
            id: `br-${req.id}`,
            op: PET_OP_BRIDGE_RESPONSE,
            payload: { id: req.id, status: 200, contentType: 'application/json', body },
          },
          () => {},
        );
      }
    };

    t.after(async () => {
      await host.dispose();
      rmSync(root, { recursive: true, force: true });
    });

    await host.handleHost(
      {
        type: DESKTOP_BRIDGE_CHANNEL,
        version: DESKTOP_BRIDGE_VERSION,
        kind: 'request',
        id: 'start-1',
        op: PET_OP_START,
        payload: {
          pets: [{ id: 'fish', size: 300 }],
          trayEnabled: true,
          helperDir,
          openTarget: 'desktop',
          siteUrl: 'http://127.0.0.1:3080',
        },
      },
      reply,
    );

    const startReply = replies.find((item) => item.kind === 'result' && item.id === 'start-1');
    assert.deepEqual(startReply?.value, { ok: true, windows: 1 });
    assert.equal(env.createdWindows.length, 1);

    const petWin = env.createdWindows[0];
    assert.equal(petWin.options.transparent, true);
    assert.equal(petWin.options.frame, false);
    assert.equal(petWin.options.skipTaskbar, true);
    assert.equal((petWin.options.webPreferences as Record<string, unknown>).partition, PET_SESSION_PARTITION);
    assert.equal((petWin.options.webPreferences as Record<string, unknown>).sandbox, true);
    assert.equal(env.getRequestedPartition(), PET_SESSION_PARTITION);

    const loaded = new URL(petWin.loadedUrl);
    assert.equal(loaded.pathname, `${HELPER_MOUNT_PREFIX}index.html`);
    assert.equal(loaded.searchParams.get('bridge'), '0');
    assert.equal(loaded.searchParams.get('openTarget'), 'desktop');

    // 验证 webRequest 仅对所属桌宠窗口且同源代理注入令牌，非桌宠窗口的伪造令牌会被剥离
    const beforeSend = env.getBeforeSendHeaders();
    assert.ok(beforeSend);
    let petHeaders: Record<string, string> = {};
    beforeSend({ url: loaded.href, webContentsId: petWin.webContents.id, requestHeaders: {} }, (res) => {
      petHeaders = res.requestHeaders ?? {};
    });
    assert.ok(petHeaders['X-DSH-Pet-Token'] && petHeaders['X-DSH-Pet-Token'].length === 64);

    let spoofHeaders: Record<string, string> = {};
    beforeSend(
      {
        url: loaded.href,
        webContentsId: mainWindow.webContents.id,
        requestHeaders: { 'x-dsh-pet-token': 'forged' },
      },
      (res) => {
        spoofHeaders = res.requestHeaders ?? {};
      },
    );
    assert.equal(spoofHeaders['X-DSH-Pet-Token'], undefined);
    assert.equal(spoofHeaders['x-dsh-pet-token'], undefined);

    // 验证用真实注入令牌访问本地代理能完整打通到宿主 bridge
    const configRes = await fetch(`${loaded.origin}/dsh-pet-7340/config`, {
      headers: { [PET_TOKEN_HEADER]: petHeaders['X-DSH-Pet-Token'] },
    });
    assert.equal(configRes.status, 200);
    const configJson = (await configRes.json()) as { main: { pets: Array<{ id: string }> } };
    assert.equal(configJson.main.pets[0].id, 'fish');

    // 验证 ipcMain 门控：非桌宠窗口触发 pet:open-site 无效，桌宠窗口触发则恢复并聚焦主窗口
    const openSiteListeners = [...(env.ipcListeners.get('pet:open-site') ?? [])];
    assert.equal(openSiteListeners.length, 1);
    openSiteListeners[0]({ sender: mainWindow.webContents }, { url: 'http://127.0.0.1:3080' });
    assert.equal(mainWindow.focusCalls, 0);

    openSiteListeners[0]({ sender: petWin.webContents }, { url: 'http://127.0.0.1:3080' });
    assert.equal(mainWindow.restoreCalls, 1);
    assert.equal(mainWindow.showCalls, 1);
    assert.equal(mainWindow.focusCalls, 1);

    // 非桌宠窗口调 pet:capture-screen 必须拒绝；桌宠窗口正常返回截屏
    const captureHandler = env.ipcHandlers.get('pet:capture-screen');
    assert.ok(captureHandler);
    await assert.rejects(async () => captureHandler({ sender: mainWindow.webContents }), /non-pet window/);
    const shot = (await captureHandler({ sender: petWin.webContents })) as { mediaType: string; width: number };
    assert.equal(shot.mediaType, 'image/jpeg');
    assert.equal(shot.width, 1280);

    // 等待托盘异步同步完成并验证菜单
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(env.createdTrays.length, 1);
    assert.equal(env.createdTrays[0].destroyed, false);
    const menuItems = env.createdTrays[0].menu as Array<{ label: string; checked: boolean; click: () => void }>;
    assert.equal(menuItems[0].label, '大肥鱼');
    assert.equal(menuItems[0].checked, true);

    // 停用与销毁后窗口、托盘与全局监听全部清空
    await host.handleHost(
      {
        type: DESKTOP_BRIDGE_CHANNEL,
        version: DESKTOP_BRIDGE_VERSION,
        kind: 'request',
        id: 'stop-1',
        op: PET_OP_STOP,
      },
      reply,
    );
    assert.equal(petWin.destroyed, true);
    assert.equal(env.createdTrays[0].destroyed, true);

    await host.dispose();
    assert.equal(env.getBeforeSendHeaders(), null);
    assert.equal(env.ipcHandlers.has('pet:capture-screen'), false);
    assert.equal(env.screenEmitter.listenerCount('display-added'), 0);
    assert.equal(env.powerEmitter.listenerCount('resume'), 0);
  });
});
