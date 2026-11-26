/**
 * 桌面模式窗口几何、命中区穿透、任务栏/置顶看门狗与托盘平台差异的纯计算模块。
 *
 * 与 `runtime/electron-helper/` 保持同一套规则，但不依赖 Electron，供主进程控制器与单测共用。
 * @module dsh-pet/src/desktop/geometry
 */
import { CANVAS_H, FEET_Y, HIT_BOX } from '../shared/constants.ts';

/** 动画舞台标准宽度（与 runtime/electron-helper/pointer-target.js 一致）。 */
export const STAGE_W = 640;

/** 兜底通道的光标轮询间隔（ms）。 */
export const POINTER_POLL_MS = 60;

/** 光标停在窗口余量区（非 busy）的最长保持时间（ms）：超过即恢复穿透。 */
export const OFF_BODY_RELEASE_MS = 400;

/** 置顶看门狗节拍（ms）。 */
export const TOPMOST_WATCHDOG_TICK_MS = 1000;

/** 置顶看门狗默认关闭（与 runtime/electron-helper/topmost-watchdog.js 保持一致）。 */
export const TOPMOST_WATCHDOG_ENABLED = false;

/** 重新置顶最小间隔（ms）。 */
export const TOPMOST_REASSERT_MS = 5000;

/** Windows 任务栏看门狗节拍（ms）。 */
export const TASKBAR_WATCHDOG_TICK_MS = 3000;

/** 矩形区域（DIP）。 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 光标坐标（DIP）。 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 窗口内偏移量（DIP）。 */
export interface WindowMargins {
  readonly l: number;
  readonly t: number;
  readonly r?: number;
}

/** 渲染端上报的控件交互矩形集。 */
export interface InputRegions {
  readonly dragging: boolean;
  readonly rects: readonly Rect[];
}

/** Electron 显示器信息子集。 */
export interface DisplayLike {
  readonly id: number;
  readonly bounds: Rect;
  readonly workArea: Rect;
}

/** 桌面几何汇总（屏幕坐标）。 */
export interface DeskGeometry {
  readonly hull: Rect;
  readonly areas: readonly Rect[];
  readonly workAreas: readonly Rect[];
  readonly panels: readonly Rect[];
  readonly primaryIndex: number;
  readonly topInsetRatio: number;
}

/** 光标相对宠物窗口的分区。 */
export type PointerZone = 'outside' | 'body' | 'margin';

/** 托盘平台差异开关。 */
export interface TrayPlatformConfig {
  readonly templateImage: boolean;
  readonly leftClickPopsMenu: boolean;
}

/**
 * 由显示器列表算出桌面几何。
 * @param displays - 显示器列表。
 * @param primaryId - 主屏 id。
 * @param platform - 运行平台。
 * @returns 桌面几何描述。
 */
export function buildDeskGeometry(
  displays: readonly DisplayLike[],
  primaryId: number,
  platform: NodeJS.Platform,
): DeskGeometry {
  const safeDisplays: readonly DisplayLike[] =
    displays.length > 0
      ? displays
      : [
          {
            id: primaryId,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1080 },
          },
        ];
  const workAreas = safeDisplays.map((d) => ({ ...d.workArea }));
  const panels = safeDisplays.map((d) => ({ ...d.bounds }));
  const areas = workAreas.map((a, i) => {
    if (platform !== 'darwin') return { ...a };
    return { ...a, y: panels[i].y, height: a.y + a.height - panels[i].y };
  });
  const x = Math.min(...areas.map((a) => a.x));
  const y = Math.min(...areas.map((a) => a.y));
  return {
    hull: {
      x,
      y,
      width: Math.max(...areas.map((a) => a.x + a.width)) - x,
      height: Math.max(...areas.map((a) => a.y + a.height)) - y,
    },
    areas,
    workAreas,
    panels,
    primaryIndex: Math.max(
      0,
      safeDisplays.findIndex((d) => d.id === primaryId),
    ),
    topInsetRatio: platform === 'darwin' ? (HIT_BOX.y0 + CANVAS_H - FEET_Y) / STAGE_W : 0,
  };
}

/**
 * 窗口初始尺寸 = 宠物包围盒 + 四周外扩余量。
 * @param size - 宠物宽度（px）。
 * @returns 初始内容区宽高。
 */
export function petWindowSize(size: number): { readonly width: number; readonly height: number } {
  const height = (size * 9) / 16;
  const bottomPad = (size * (9 / 16) * (CANVAS_H - FEET_Y)) / CANVAS_H;
  const margin = Math.round(size * 0.5);
  return { width: Math.round(size) + margin * 2, height: Math.round(height + bottomPad) + margin * 2 };
}

/**
 * 窗口矩形 → 宠物身体命中区的屏幕矩形（DIP）。
 * @param bounds - 窗口矩形。
 * @param margins - 渲染端上报的窗口边距偏移。
 * @returns 命中区边界。
 */
export function spriteHitRect(
  bounds: Rect,
  margins?: WindowMargins,
): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } {
  const legacy = Math.round(bounds.width / 4);
  const ml = margins !== undefined && Number.isFinite(margins.l) ? margins.l : legacy;
  const mt = margins !== undefined && Number.isFinite(margins.t) ? margins.t : legacy;
  const mr = margins !== undefined && margins.r !== undefined && Number.isFinite(margins.r) ? margins.r : ml;
  const stageW = Math.max(0, bounds.width - ml - mr);
  const stageH = (stageW * CANVAS_H) / STAGE_W;
  const bottomPad = (stageH * (CANVAS_H - FEET_Y)) / CANVAS_H;
  return {
    left: bounds.x + ml + (HIT_BOX.x0 / STAGE_W) * stageW,
    top: bounds.y + mt + bottomPad + (HIT_BOX.y0 / CANVAS_H) * stageH,
    right: bounds.x + ml + (HIT_BOX.x1 / STAGE_W) * stageW,
    bottom: bounds.y + mt + bottomPad + (HIT_BOX.y1 / CANVAS_H) * stageH,
  };
}

/**
 * 判断光标相对窗口的分区。
 * @param bounds - 窗口矩形。
 * @param point - 当前光标位置。
 * @param margins - 窗口边距偏移。
 * @returns 光标分区。
 */
export function pointerZone(bounds: Rect, point: Point, margins?: WindowMargins): PointerZone {
  const inWindow =
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height;
  if (!inWindow) return 'outside';
  const r = spriteHitRect(bounds, margins);
  const inSprite = point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
  return inSprite ? 'body' : 'margin';
}

/**
 * 计算该窗口此刻是否应保持点击穿透。
 * @param bounds - 窗口矩形。
 * @param point - 光标位置。
 * @param ignoring - 当前穿透镜像值。
 * @param busy - 渲染端是否持有输入租约。
 * @param offBodyMs - 光标停留在余量区的连续时长。
 * @param input - 控件交互矩形集。
 * @param margins - 窗口边距偏移。
 * @returns true 表示穿透，false 表示可交互。
 */
export function decideWindowIgnore(
  bounds: Rect,
  point: Point,
  ignoring: boolean,
  busy: boolean,
  offBodyMs = 0,
  input?: InputRegions,
  margins?: WindowMargins,
): boolean {
  if (busy) {
    if (!input || input.dragging) return false;
    const inControl = input.rects.some(
      (r) =>
        point.x >= bounds.x + r.x &&
        point.x < bounds.x + r.x + r.width &&
        point.y >= bounds.y + r.y &&
        point.y < bounds.y + r.y + r.height,
    );
    return !inControl && pointerZone(bounds, point, margins) !== 'body';
  }
  const zone = pointerZone(bounds, point, margins);
  if (zone === 'outside') return true;
  if (zone === 'body') return false;
  if (offBodyMs >= OFF_BODY_RELEASE_MS) return true;
  return ignoring;
}

/**
 * 判断这一拍光标是否刚离开宠物身体。
 * @param prevZone - 上一拍分区。
 * @param zone - 当前分区。
 * @returns 仅当从 body 离开到非 body 时返回 true。
 */
export function leavesBody(prevZone: PointerZone | undefined, zone: PointerZone): boolean {
  return prevZone === 'body' && zone !== 'body';
}

/**
 * 返回平台对应的置顶层级。
 * @param platform - 运行平台。
 * @returns Electron `setAlwaysOnTop` 层级名。
 */
export function topmostLevel(platform: NodeJS.Platform): 'floating' | 'screen-saver' {
  return platform === 'darwin' ? 'floating' : 'screen-saver';
}

/**
 * 判断这一拍是否应重申置顶。
 * @param state - 窗口运行状态。
 * @param enabled - 总开关。
 * @returns 需要重申置顶时为 true。
 */
export function shouldReassertTopmost(
  state: {
    readonly nowMs: number;
    readonly lastAssertMs: number;
    readonly destroyed: boolean;
    readonly visible: boolean;
  },
  enabled = TOPMOST_WATCHDOG_ENABLED,
): boolean {
  if (!enabled) return false;
  if (state.destroyed || !state.visible) return false;
  const elapsed = state.nowMs - state.lastAssertMs;
  return !(elapsed >= 0 && elapsed < TOPMOST_REASSERT_MS);
}

/**
 * 是否运行 Windows 任务栏看门狗。
 * @param platform - 运行平台。
 * @param rawEnv - `DSH_PET_TASKBAR_WATCHDOG` 环境变量值。
 * @returns 仅 Windows 且未显式关闭时为 true。
 */
export function shouldRunTaskbarWatchdog(platform: NodeJS.Platform, rawEnv?: string): boolean {
  return platform === 'win32' && rawEnv !== '0' && rawEnv !== 'false';
}

/**
 * 托盘平台差异配置（主进程内嵌模式绝不隐藏主应用 Dock 图标）。
 * @param platform - 运行平台。
 * @returns 图标模板与左键弹菜单配置。
 */
export function trayPlatformConfig(platform: NodeJS.Platform): TrayPlatformConfig {
  return {
    templateImage: platform === 'darwin',
    leftClickPopsMenu: platform === 'win32',
  };
}
