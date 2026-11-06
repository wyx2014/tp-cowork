import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** The reference product's (ZCode) interface zoom: whole-window steps of 1.1^level between -3 and +5. */
export const ZOOM_MIN = -3;
export const ZOOM_MAX = 5;
const ZOOM_STEP = 1.1;
/** DSH's macOS traffic lights sit at (16, 18) beside a 52px strip whose controls are centred at y 25. */
const MAC_LIGHTS = { x: 16, y: 18, center: 25 };
/** DSH's Windows caption overlay height in CSS pixels. */
const WINDOWS_TITLEBAR = 40;

export const zoomFactor = level => ZOOM_STEP ** level;
export const clampZoom = level => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(level)));

/**
 * Native window chrome does not scale with the page, so it is moved to stay level with the zoomed strip: the macOS
 * lights keep their x and follow the strip's centre line; the Windows caption buttons take the zoomed bar height.
 */
export function chromeForZoom(level, platform) {
  const factor = zoomFactor(level);
  if (platform === 'darwin') return { buttons: { x: MAC_LIGHTS.x, y: Math.max(4, Math.round(MAC_LIGHTS.y + MAC_LIGHTS.center * (factor - 1))) } };
  if (platform === 'win32') return { titleBarHeight: Math.round(WINDOWS_TITLEBAR * factor) };
  return {};
}

/**
 * Whole-window zoom for the DSH primary window. The level is saved in the application data and applied again
 * whenever the renderer asks for it, so a reloaded or recreated window comes back at the same size.
 */
export class WindowZoom {
  constructor(window, file, platform = process.platform) {
    this.window = window;
    this.file = file;
    this.platform = platform;
    this.level = 0;
    try { this.level = clampZoom(Number(JSON.parse(readFileSync(file, 'utf8')).level) || 0); }
    catch {}
  }

  /** @param payload - `{ action: 'get' | 'in' | 'out' | 'reset' }`. @returns the applied level and its bounds. */
  async request(payload) {
    const action = payload?.action ?? 'get';
    if (!['get', 'in', 'out', 'reset'].includes(action)) throw new Error('Unknown zoom action');
    const next = action === 'reset' ? 0 : clampZoom(this.level + (action === 'in' ? 1 : action === 'out' ? -1 : 0));
    const changed = next !== this.level;
    this.level = next;
    this.apply();
    if (changed) await this.save();
    return { level: this.level, min: ZOOM_MIN, max: ZOOM_MAX };
  }

  apply() {
    const window = this.window();
    if (!window || window.isDestroyed()) return;
    window.webContents.setZoomFactor(zoomFactor(this.level));
    const chrome = chromeForZoom(this.level, this.platform);
    try {
      if (chrome.buttons) window.setWindowButtonPosition?.(chrome.buttons);
      if (chrome.titleBarHeight) window.setTitleBarOverlay?.({ height: chrome.titleBarHeight });
    } catch (error) { console.warn('[tpcowork-zoom] window chrome was not adjusted', error); }
  }

  async save() {
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file, JSON.stringify({ level: this.level }));
    } catch (error) { console.warn('[tpcowork-zoom] zoom level was not saved', error); }
  }
}
