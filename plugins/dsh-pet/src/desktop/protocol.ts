/**
 * TP Cowork 桌面主进程与 dsh-pet 宿主进程之间的 IPC 协议契约。
 *
 * 复用 TP Cowork 既有的 `tpcowork-browser` 通道信封（`type`/`version`/`id`/`kind`），
 * 无需修改底座即可在 Electron 主进程内直接托管透明桌宠窗口，避免内网环境下载独立 Electron。
 * @module dsh-pet/src/desktop/protocol
 */
import type { BridgeResponse } from '../host/helper/bridge.ts';

/** 复用的宿主↔主进程 IPC 通道名（与 tpcowork-browser 一致）。 */
export const DESKTOP_BRIDGE_CHANNEL = 'tpcowork-browser';

/** 通道协议版本号。 */
export const DESKTOP_BRIDGE_VERSION = 1;

/** 宿主 → 主进程：按最新配置创建/重建桌面宠物窗口与托盘。 */
export const PET_OP_START = 'pet:start';

/** 宿主 → 主进程：关闭全部桌面宠物窗口并清理托盘。 */
export const PET_OP_STOP = 'pet:stop';

/** 宿主 → 主进程：返回主进程发起的 bridge HTTP 请求应答。 */
export const PET_OP_BRIDGE_RESPONSE = 'pet:bridge-response';

/** 主进程 → 宿主：渲染端或托盘发往 `/dsh-pet-7340/...` 的业务请求事件名。 */
export const PET_EVENT_BRIDGE_REQUEST = 'pet:bridge-request';

/** 菜单首项去向。 */
export type DesktopPetOpenTarget = 'desktop' | 'standalone' | 'web';

/** 单只桌面宠物的窗口启动描述。 */
export interface DesktopPetSpec {
  readonly id: string;
  readonly size: number;
}

/** `pet:start` 的载荷。 */
export interface DesktopPetStartPayload {
  readonly pets: readonly DesktopPetSpec[];
  readonly trayEnabled: boolean;
  readonly helperDir: string;
  readonly openTarget: DesktopPetOpenTarget;
  readonly siteUrl?: string;
}

/** `pet:stop` 的载荷。 */
export interface DesktopPetStopPayload {
  readonly reason?: string;
}

/** 主进程发给宿主的 bridge 请求载荷。 */
export interface DesktopPetBridgeRequestPayload {
  readonly id: number;
  readonly method: string;
  readonly url: string;
  readonly body?: string;
}

/** 宿主发往主进程的请求信封。 */
export interface DesktopPetRequestEnvelope {
  readonly type: typeof DESKTOP_BRIDGE_CHANNEL;
  readonly version: typeof DESKTOP_BRIDGE_VERSION;
  readonly kind: 'request';
  readonly id: string;
  readonly op: typeof PET_OP_START | typeof PET_OP_STOP | typeof PET_OP_BRIDGE_RESPONSE;
  readonly payload?: unknown;
}

/** 主进程发往宿主的事件信封。 */
export interface DesktopPetEventEnvelope {
  readonly type: typeof DESKTOP_BRIDGE_CHANNEL;
  readonly version: typeof DESKTOP_BRIDGE_VERSION;
  readonly kind: 'event';
  readonly id: string;
  readonly event: typeof PET_EVENT_BRIDGE_REQUEST;
  readonly payload: DesktopPetBridgeRequestPayload;
}

/** 主进程回给宿主的应答信封。 */
export interface DesktopPetResultEnvelope {
  readonly type: typeof DESKTOP_BRIDGE_CHANNEL;
  readonly version: typeof DESKTOP_BRIDGE_VERSION;
  readonly kind: 'result';
  readonly id: string;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

const PET_OPS = new Set<string>([PET_OP_START, PET_OP_STOP, PET_OP_BRIDGE_RESPONSE]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 判断一条来自宿主进程的 IPC 消息是否归桌面桌宠主进程控制器处理。
 * @param value - 原始 IPC 消息。
 * @returns 属于 `pet:*` 请求或取消消息时为 true。
 */
export function isDesktopPetRequestMessage(value: unknown): value is DesktopPetRequestEnvelope {
  if (!isRecord(value)) return false;
  if (value.type !== DESKTOP_BRIDGE_CHANNEL || value.version !== DESKTOP_BRIDGE_VERSION) return false;
  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128) return false;
  return value.kind === 'request' && typeof value.op === 'string' && PET_OPS.has(value.op);
}

/**
 * 判断一条来自主进程的 IPC 消息是否是桌宠 bridge 请求事件。
 * @param value - 原始 IPC 消息。
 * @returns 为合法的 `pet:bridge-request` 事件时为 true。
 */
export function isDesktopPetBridgeEvent(value: unknown): value is DesktopPetEventEnvelope {
  if (!isRecord(value)) return false;
  if (value.type !== DESKTOP_BRIDGE_CHANNEL || value.version !== DESKTOP_BRIDGE_VERSION) return false;
  if (value.kind !== 'event' || value.event !== PET_EVENT_BRIDGE_REQUEST) return false;
  if (!isRecord(value.payload)) return false;
  return (
    typeof value.payload.id === 'number' &&
    Number.isFinite(value.payload.id) &&
    typeof value.payload.method === 'string' &&
    typeof value.payload.url === 'string' &&
    (value.payload.body === undefined || typeof value.payload.body === 'string')
  );
}

/**
 * 校验并规整 `pet:start` 的载荷。
 * @param value - 原始载荷。
 * @returns 合法时返回规整后的载荷，否则返回 undefined。
 */
export function parseDesktopPetStartPayload(value: unknown): DesktopPetStartPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (!Array.isArray(value.pets)) return undefined;
  const pets: DesktopPetSpec[] = [];
  for (const item of value.pets) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.trim() === '') return undefined;
    const size = Number(item.size);
    if (!Number.isFinite(size) || size <= 0) return undefined;
    pets.push({ id: item.id, size });
  }
  if (typeof value.helperDir !== 'string' || value.helperDir.trim() === '') return undefined;
  const openTarget: DesktopPetOpenTarget =
    value.openTarget === 'desktop' || value.openTarget === 'standalone' ? value.openTarget : 'web';
  const siteUrl = typeof value.siteUrl === 'string' ? value.siteUrl : undefined;
  return {
    pets,
    trayEnabled: value.trayEnabled !== false,
    helperDir: value.helperDir,
    openTarget,
    ...(siteUrl === undefined ? {} : { siteUrl }),
  };
}

/**
 * 校验 `pet:bridge-response` 的载荷。
 * @param value - 原始载荷。
 * @returns 合法时返回 {@link BridgeResponse}，否则返回 undefined。
 */
export function parseDesktopPetBridgeResponse(value: unknown): BridgeResponse | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== 'number' || !Number.isFinite(value.id)) return undefined;
  if (typeof value.status !== 'number' || !Number.isFinite(value.status)) return undefined;
  if (value.contentType !== undefined && typeof value.contentType !== 'string') return undefined;
  if (value.body !== undefined && typeof value.body !== 'string') return undefined;
  if (value.file !== undefined && typeof value.file !== 'string') return undefined;
  return {
    id: value.id,
    status: value.status,
    ...(value.contentType === undefined ? {} : { contentType: value.contentType }),
    ...(value.body === undefined ? {} : { body: value.body }),
    ...(value.file === undefined ? {} : { file: value.file }),
  };
}
