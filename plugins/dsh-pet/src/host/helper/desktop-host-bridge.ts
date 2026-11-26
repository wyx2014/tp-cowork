/**
 * 宿主进程侧的桌面主进程桥接客户端：通过 TP Cowork 既有的 `tpcowork-browser` IPC 通道
 * 向 Electron 主进程收发桌宠窗口生命周期指令与 `/dsh-pet-7340/...` 业务请求。
 *
 * 不启动任何外部子进程，也不触碰下载逻辑；在无 IPC 或主进程不支持 `pet:*` 操作时
 * 返回可区分的降级错误码，由调用方决定是否回退到独立 Electron Helper。
 * @module dsh-pet/src/host/helper/desktop-host-bridge
 */
import { randomUUID } from 'node:crypto';
import {
  DESKTOP_BRIDGE_CHANNEL,
  DESKTOP_BRIDGE_VERSION,
  PET_OP_BRIDGE_RESPONSE,
  PET_OP_START,
  PET_OP_STOP,
  isDesktopPetBridgeEvent,
  type DesktopPetResultEnvelope,
  type DesktopPetStartPayload,
} from '../../desktop/protocol.ts';
import type { LoggerLike } from '../log-file.ts';
import type { BridgeHandler, BridgeResponse } from './bridge.ts';

/** 默认 IPC 单次控制请求超时（毫秒）。 */
export const DEFAULT_DESKTOP_BRIDGE_TIMEOUT_MS = 10_000;

/** 表示当前宿主外部进程不支持内嵌桌宠桥接、应回退到外部 Electron 的错误码集合。 */
const UNSUPPORTED_BRIDGE_ERROR_CODES = new Set<string>([
  'native_unavailable',
  'invalid_operation',
  'disabled',
  'desktop_required',
  'timeout',
]);

/** 宿主进程 IPC 载体最小接口（默认即 `process`）。 */
export interface DesktopIpcCarrier {
  readonly connected?: boolean;
  send?: (message: unknown) => boolean;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'disconnect', listener: () => void): unknown;
  off?(event: 'message', listener: (message: unknown) => void): unknown;
  off?(event: 'disconnect', listener: () => void): unknown;
  removeListener?(event: 'message', listener: (message: unknown) => void): unknown;
  removeListener?(event: 'disconnect', listener: () => void): unknown;
}

/** 带错误码的桌宠桥接异常。 */
export interface DesktopBridgeError extends Error {
  readonly code: string;
}

/** 创建宿主侧桌宠桥接客户端的输入。 */
export interface DesktopHostBridgeOptions {
  /** IPC 载体（默认 `process`，测试可注入桩对象）。 */
  readonly carrier?: DesktopIpcCarrier;
  /** 处理来自主进程本地代理转发的 `/dsh-pet-7340/...` 请求。 */
  readonly bridgeHandler: BridgeHandler;
  /** 诊断日志出口。 */
  readonly log: LoggerLike;
  /** 单次 `pet:start`/`pet:stop` 等待超时（毫秒）。 */
  readonly timeoutMs?: number;
  /** IPC 断开时的回调。 */
  readonly onDisconnect?: () => void;
}

/** `pet:start` 成功返回结果。 */
export interface DesktopHostBridgeStartResult {
  readonly ok: true;
  readonly windows: number;
}

/** 宿主侧桌宠桥接客户端句柄。 */
export interface DesktopHostBridge {
  /** 请求主进程创建或重建透明桌宠窗口与系统托盘。 */
  start(payload: DesktopPetStartPayload): Promise<DesktopHostBridgeStartResult>;
  /** 请求主进程关闭全部桌宠窗口与托盘，并在收尾后移除本地监听。 */
  stop(reason?: string): Promise<void>;
  /** 仅移除本地 IPC 监听并取消挂起请求（不向主进程发 `pet:stop`）。 */
  detach(): void;
}

interface PendingCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

function createBridgeError(code: string, message: string): DesktopBridgeError {
  const error = new Error(message) as Error & { code: string };
  error.name = 'DesktopBridgeError';
  error.code = code;
  return error;
}

function isResultEnvelope(value: unknown): value is DesktopPetResultEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === DESKTOP_BRIDGE_CHANNEL &&
    record.version === DESKTOP_BRIDGE_VERSION &&
    record.kind === 'result' &&
    typeof record.id === 'string' &&
    record.id.length > 0
  );
}

/**
 * 判断错误是否表明主进程不支持内嵌桌宠桥接（应回退到外部 Electron）。
 * @param error - 捕获到的异常对象。
 * @returns 属于可回退的桥接不可用错误时为 true。
 */
export function isUnsupportedDesktopBridgeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && UNSUPPORTED_BRIDGE_ERROR_CODES.has(code);
}

/**
 * 判断当前宿主进程是否具备经 TP Cowork 桌面主进程托管桌宠的 IPC 条件。
 *
 * 显式设置 `DSH_PET_ELECTRON_PATH` 或 `DSH_PET_DISABLE_HOST_BRIDGE=1` 时返回 false，
 * 保留外部 Electron 覆写与调试逃生口。
 * @param carrier - IPC 载体，默认 `process`。
 * @param env - 环境变量映射，默认 `process.env`。
 * @returns 可以尝试桌面主进程桥接时为 true。
 */
export function canUseDesktopHostBridge(
  carrier: DesktopIpcCarrier = process,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.DSH_PET_DISABLE_HOST_BRIDGE === '1') return false;
  if (env.DSH_PET_ELECTRON_PATH) return false;
  return Boolean(carrier.connected && typeof carrier.send === 'function');
}

/**
 * 创建宿主侧的桌面桌宠 IPC 桥接客户端。
 * @param options - IPC 载体、业务路由处理器与超时配置。
 * @returns 可启停与解绑的桥接客户端句柄。
 */
export function createDesktopHostBridge(options: DesktopHostBridgeOptions): DesktopHostBridge {
  const carrier: DesktopIpcCarrier = options.carrier ?? process;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DESKTOP_BRIDGE_TIMEOUT_MS;
  const pending = new Map<string, PendingCall>();
  let attached = false;

  const detachCarrierListener = (event: 'message' | 'disconnect', listener: (...args: never[]) => void): void => {
    if (typeof carrier.off === 'function') {
      carrier.off(event as 'message', listener as (message: unknown) => void);
    } else if (typeof carrier.removeListener === 'function') {
      carrier.removeListener(event as 'message', listener as (message: unknown) => void);
    }
  };

  const rejectAllPending = (error: Error): void => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(error);
    }
  };

  const sendEnvelope = (envelope: object): boolean => {
    if (!carrier.connected || typeof carrier.send !== 'function') return false;
    try {
      return carrier.send(envelope) !== false;
    } catch {
      return false;
    }
  };

  const sendBridgeResponse = (response: BridgeResponse): void => {
    if (!attached) return;
    sendEnvelope({
      type: DESKTOP_BRIDGE_CHANNEL,
      version: DESKTOP_BRIDGE_VERSION,
      kind: 'request',
      id: `pet-br-${response.id}-${randomUUID()}`,
      op: PET_OP_BRIDGE_RESPONSE,
      payload: response,
    });
  };

  const onMessage = (message: unknown): void => {
    if (isDesktopPetBridgeEvent(message)) {
      const req = message.payload;
      void Promise.resolve()
        .then(() =>
          options.bridgeHandler({
            id: req.id,
            method: req.method,
            url: req.url,
            ...(req.body === undefined ? {} : { body: req.body }),
          }),
        )
        .then(
          (response) => {
            sendBridgeResponse(response);
          },
          (error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error);
            options.log.warn?.(`[dsh-pet] desktop bridge handler error (${req.method} ${req.url}): ${detail}`);
            sendBridgeResponse({
              id: req.id,
              status: 500,
              contentType: 'text/plain; charset=utf-8',
              body: detail,
            });
          },
        );
      return;
    }

    if (!isResultEnvelope(message)) return;
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error !== undefined) {
      entry.reject(createBridgeError(message.error.code || 'bridge_error', message.error.message || 'Bridge error'));
      return;
    }
    entry.resolve(message.value);
  };

  const onDisconnect = (): void => {
    detach();
    options.onDisconnect?.();
  };

  const attach = (): void => {
    if (attached) return;
    attached = true;
    carrier.on('message', onMessage);
    carrier.on('disconnect', onDisconnect);
  };

  const detach = (): void => {
    if (attached) {
      attached = false;
      detachCarrierListener('message', onMessage);
      detachCarrierListener('disconnect', onDisconnect);
    }
    rejectAllPending(createBridgeError('disconnected', 'Desktop pet host bridge detached'));
  };

  const call = (op: typeof PET_OP_START | typeof PET_OP_STOP, payload?: unknown): Promise<unknown> => {
    if (!carrier.connected || typeof carrier.send !== 'function') {
      return Promise.reject(createBridgeError('disconnected', 'Desktop host IPC channel is not connected'));
    }
    attach();
    const id = `pet-${op.slice(4)}-${randomUUID()}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(createBridgeError('timeout', `Desktop pet IPC timed out for ${op} after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      const ok = sendEnvelope({
        type: DESKTOP_BRIDGE_CHANNEL,
        version: DESKTOP_BRIDGE_VERSION,
        kind: 'request',
        id,
        op,
        ...(payload === undefined ? {} : { payload }),
      });
      if (!ok) {
        clearTimeout(timer);
        pending.delete(id);
        reject(createBridgeError('disconnected', `Failed to send ${op} over desktop host IPC`));
      }
    });
  };

  const start = async (payload: DesktopPetStartPayload): Promise<DesktopHostBridgeStartResult> => {
    const raw = await call(PET_OP_START, payload);
    const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const windows = typeof record.windows === 'number' && Number.isFinite(record.windows) ? record.windows : 0;
    return { ok: true, windows };
  };

  const stop = async (reason = 'settings-change'): Promise<void> => {
    // 取消任何仍在等待的旧控制调用（例如尚未返回的 pet:start），但先保持监听以接收 pet:stop 应答。
    rejectAllPending(createBridgeError('cancelled', `Desktop pet bridge stopped (${reason})`));
    try {
      if (carrier.connected && typeof carrier.send === 'function') {
        await call(PET_OP_STOP, { reason });
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      options.log.warn?.(`[dsh-pet] desktop pet host bridge stop error: ${detail}`);
    } finally {
      detach();
    }
  };

  return { start, stop, detach };
}
