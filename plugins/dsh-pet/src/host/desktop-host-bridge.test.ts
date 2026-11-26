/**
 * 宿主侧桌面桥接（DesktopHostBridge）与 createDesktopSpawn 内网免下载行为测试。
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
  isDesktopPetRequestMessage,
} from '../desktop/protocol.ts';
import {
  canUseDesktopHostBridge,
  createDesktopHostBridge,
  isUnsupportedDesktopBridgeError,
  type DesktopIpcCarrier,
} from './helper/desktop-host-bridge.ts';
import { createDesktopSpawn } from './plugin/desktop/spawn.ts';
import type { HostContext } from './plugin/context.ts';
import type { FileLogger } from './log-file.ts';

function makeFakeLogger(logs: string[]): FileLogger {
  return {
    file: '',
    isFileLogger: false,
    info: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
    debug: (m: unknown) => logs.push(String(m)),
    flush: () => {},
    dispose: () => {},
  } as unknown as FileLogger;
}

class FakeIpcCarrier extends EventEmitter implements DesktopIpcCarrier {
  connected = true;
  readonly sent: unknown[] = [];
  onSend: ((message: unknown) => void) | undefined;

  send = (message: unknown): boolean => {
    if (!this.connected) return false;
    this.sent.push(message);
    this.onSend?.(message);
    return true;
  };
}

function makeFakeContext(port = 4321): HostContext {
  return {
    webServer: {
      port,
      getOrigin: () => `http://127.0.0.1:${port}`,
    },
    emit: () => {},
  } as unknown as HostContext;
}

describe('canUseDesktopHostBridge — 桥接启用门控', () => {
  test('IPC 已连接且未显式覆盖外部 Electron 时启用', () => {
    const carrier = new FakeIpcCarrier();
    assert.equal(canUseDesktopHostBridge(carrier, {}), true);
    assert.equal(canUseDesktopHostBridge(carrier, { DSH_PET_ELECTRON_PATH: '/custom/electron' }), false);
    assert.equal(canUseDesktopHostBridge(carrier, { DSH_PET_DISABLE_HOST_BRIDGE: '1' }), false);
    carrier.connected = false;
    assert.equal(canUseDesktopHostBridge(carrier, {}), false);
  });
});

describe('createDesktopHostBridge — 请求配对与业务转发', () => {
  test('关联 pet:start/pet:stop 并处理主进程发来的 pet:bridge-request 事件', async () => {
    const carrier = new FakeIpcCarrier();
    const responses: Array<Record<string, unknown>> = [];

    carrier.onSend = (message) => {
      if (!isDesktopPetRequestMessage(message)) return;
      if (message.op === PET_OP_START) {
        queueMicrotask(() => {
          carrier.emit('message', {
            type: DESKTOP_BRIDGE_CHANNEL,
            version: DESKTOP_BRIDGE_VERSION,
            kind: 'event',
            id: 'ev-1',
            event: PET_EVENT_BRIDGE_REQUEST,
            payload: { id: 7, method: 'GET', url: '/dsh-pet-7340/config' },
          });
          carrier.emit('message', {
            type: DESKTOP_BRIDGE_CHANNEL,
            version: DESKTOP_BRIDGE_VERSION,
            kind: 'result',
            id: message.id,
            value: { ok: true, windows: 2 },
          });
        });
      } else if (message.op === PET_OP_BRIDGE_RESPONSE) {
        responses.push(message.payload as Record<string, unknown>);
      } else if (message.op === PET_OP_STOP) {
        queueMicrotask(() => {
          carrier.emit('message', {
            type: DESKTOP_BRIDGE_CHANNEL,
            version: DESKTOP_BRIDGE_VERSION,
            kind: 'result',
            id: message.id,
            value: { ok: true },
          });
        });
      }
    };

    const bridge = createDesktopHostBridge({
      carrier,
      bridgeHandler: async (req) => ({
        id: req.id,
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: req.url }),
      }),
      log: {},
    });

    const started = await bridge.start({
      pets: [{ id: 'a', size: 280 }],
      trayEnabled: true,
      helperDir: '/tmp/runtime/electron-helper',
      openTarget: 'desktop',
      siteUrl: 'http://127.0.0.1:4321',
    });
    assert.deepEqual(started, { ok: true, windows: 2 });

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(responses.length, 1);
    assert.equal(responses[0].id, 7);
    assert.equal(responses[0].status, 200);
    assert.equal(responses[0].body, JSON.stringify({ url: '/dsh-pet-7340/config' }));

    await bridge.stop('test-done');
    assert.equal(carrier.listenerCount('message'), 0);
    assert.equal(carrier.listenerCount('disconnect'), 0);
  });

  test('错误码判定区分可回退的桥接不可用与真实执行错误', () => {
    const unsupported = Object.assign(new Error('not supported'), { code: 'invalid_operation' });
    const nativeMissing = Object.assign(new Error('unavailable'), { code: 'native_unavailable' });
    const execErr = Object.assign(new Error('bad dir'), { code: 'execution_error' });
    assert.equal(isUnsupportedDesktopBridgeError(unsupported), true);
    assert.equal(isUnsupportedDesktopBridgeError(nativeMissing), true);
    assert.equal(isUnsupportedDesktopBridgeError(execErr), false);
  });
});

describe('createDesktopSpawn — 优先主进程桥接，内网不下载外部 Electron', () => {
  test('存在 IPC 主进程时直接走 pet:start 并在配置变更时先 pet:stop 再重启', async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-pet-intranet-'));
    const savedHome = process.env.DSH_HOME;
    const savedElectronPath = process.env.DSH_PET_ELECTRON_PATH;
    const savedDisplay = process.env.DISPLAY;
    t.after(() => {
      if (savedHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = savedHome;
      if (savedElectronPath === undefined) delete process.env.DSH_PET_ELECTRON_PATH;
      else process.env.DSH_PET_ELECTRON_PATH = savedElectronPath;
      if (savedDisplay === undefined) delete process.env.DISPLAY;
      else process.env.DISPLAY = savedDisplay;
      rmSync(home, { recursive: true, force: true });
    });
    // 模拟完全空白的内网环境：无 $DSH_HOME/electron，无 DSH_PET_ELECTRON_PATH
    process.env.DSH_HOME = home;
    delete process.env.DSH_PET_ELECTRON_PATH;
    if (process.platform === 'linux') process.env.DISPLAY = ':0';

    const helperDir = join(home, 'runtime', 'electron-helper');
    mkdirSync(helperDir, { recursive: true });
    writeFileSync(join(helperDir, 'index.html'), '<html></html>');
    writeFileSync(join(helperDir, 'preload.js'), '');

    const carrier = new FakeIpcCarrier();
    const ops: string[] = [];
    carrier.onSend = (message) => {
      if (!isDesktopPetRequestMessage(message)) return;
      ops.push(message.op);
      queueMicrotask(() => {
        carrier.emit('message', {
          type: DESKTOP_BRIDGE_CHANNEL,
          version: DESKTOP_BRIDGE_VERSION,
          kind: 'result',
          id: message.id,
          value: message.op === PET_OP_START ? { ok: true, windows: 1 } : { ok: true },
        });
      });
    };

    const logs: string[] = [];
    const reports: string[] = [];
    const spawn = createDesktopSpawn({
      ctx: makeFakeContext(4321),
      getHandlePetRoute: () => async () => ({ kind: 'json', status: 200, obj: { ok: true } }),
      log: makeFakeLogger(logs),
      reportDownload: (text) => reports.push(text),
      thumbUserRoot: home,
      getHasDesktopPet: () => true,
      desktopPetList: () => [{ id: 'main', size: 320 }],
      getTrayOn: () => true,
      desktopBridge: { carrier, env: {}, helperDir },
    });

    spawn.startHelper();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(ops, [PET_OP_START]);
    assert.ok(logs.some((line) => line.includes('desktop host bridge')));
    assert.equal(
      logs.some((line) => line.includes('开始下载 Electron')),
      false,
      '内网经主进程桥接启动时绝不应触发外部 Electron 下载',
    );
    assert.equal(reports.length, 0);

    await spawn.stopHelperAndWait('desktop-config-change');
    assert.deepEqual(ops, [PET_OP_START, PET_OP_STOP]);

    spawn.startHelper();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(ops, [PET_OP_START, PET_OP_STOP, PET_OP_START]);

    await spawn.stopHelperAndWait('dispose');
    spawn.markDisposed();
  });

  test('主进程返回 execution_error 时报告失败且不回退到公网下载 Electron', async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-pet-intranet-err-'));
    const savedHome = process.env.DSH_HOME;
    const savedDisplay = process.env.DISPLAY;
    t.after(() => {
      if (savedHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = savedHome;
      if (savedDisplay === undefined) delete process.env.DISPLAY;
      else process.env.DISPLAY = savedDisplay;
      rmSync(home, { recursive: true, force: true });
    });
    process.env.DSH_HOME = home;
    if (process.platform === 'linux') process.env.DISPLAY = ':0';

    const carrier = new FakeIpcCarrier();
    carrier.onSend = (message) => {
      if (!isDesktopPetRequestMessage(message)) return;
      queueMicrotask(() => {
        carrier.emit('message', {
          type: DESKTOP_BRIDGE_CHANNEL,
          version: DESKTOP_BRIDGE_VERSION,
          kind: 'result',
          id: message.id,
          error: { code: 'execution_error', message: 'helperDir missing' },
        });
      });
    };

    const logs: string[] = [];
    const reports: string[] = [];
    const spawn = createDesktopSpawn({
      ctx: makeFakeContext(4321),
      getHandlePetRoute: () => async () => ({ kind: 'json', status: 200, obj: { ok: true } }),
      log: makeFakeLogger(logs),
      reportDownload: (text) => reports.push(text),
      thumbUserRoot: home,
      getHasDesktopPet: () => true,
      desktopPetList: () => [{ id: 'main', size: 320 }],
      getTrayOn: () => true,
      desktopBridge: { carrier, env: {}, helperDir: join(home, 'runtime', 'electron-helper') },
    });

    spawn.startHelper();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(reports.some((text) => text.includes('helperDir missing')));
    assert.equal(
      logs.some((line) => line.includes('开始下载 Electron')),
      false,
      '主进程执行报错不应回退下载公网 Electron',
    );
    spawn.markDisposed();
  });
});
