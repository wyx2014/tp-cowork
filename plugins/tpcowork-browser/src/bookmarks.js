/**
 * Bookmarks imported from Chrome or Edge into a read-only snapshot. Both keep a Chromium `Bookmarks` JSON file in each
 * profile; the profile is chosen as the Chrome data import chooses it (last used, then Default, then the first that has
 * bookmarks). Only web addresses are kept. Importing a browser again replaces that browser's snapshot.
 */
import { readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserError } from './protocol.js';

export const BOOKMARK_BROWSERS = ['chrome', 'edge'];
/** A Bookmarks file this large is not a person's bookmarks; reading it would stall the desktop. */
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_BOOKMARKS = 20_000;
const MAX_DEPTH = 32;
const PROFILE_PATTERN = /^(?:Default|Profile \d+)$/;
/** Chromium's root folders, in the order its bookmark manager shows them. */
const ROOTS = ['bookmark_bar', 'other', 'synced'];

/**
 * The user-data directory of each supported browser on this platform.
 * @param options - platform and directory overrides, for tests.
 * @returns directories keyed by browser.
 */
export function bookmarkUserDataDirs({ platform = process.platform, homeDir = homedir(), env = process.env } = {}) {
  if (platform === 'darwin') {
    const support = join(homeDir, 'Library', 'Application Support');
    return { chrome: join(support, 'Google', 'Chrome'), edge: join(support, 'Microsoft Edge') };
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? join(homeDir, 'AppData', 'Local');
    return { chrome: join(local, 'Google', 'Chrome', 'User Data'), edge: join(local, 'Microsoft', 'Edge', 'User Data') };
  }
  const config = env.XDG_CONFIG_HOME ?? join(homeDir, '.config');
  return { chrome: join(config, 'google-chrome'), edge: join(config, 'microsoft-edge') };
}

const exists = path => stat(path).then(() => true, () => false);

/**
 * Find the profile whose bookmarks to import.
 * @param userDataDir - the browser's user-data directory.
 * @returns the profile directory name and Bookmarks path, or undefined when no profile has bookmarks.
 */
export async function findBookmarksFile(userDataDir) {
  let lastUsed;
  const names = new Set();
  try {
    const state = JSON.parse(await readFile(join(userDataDir, 'Local State'), 'utf8'));
    lastUsed = typeof state?.profile?.last_used === 'string' ? state.profile.last_used : undefined;
    for (const name of Object.keys(state?.profile?.info_cache ?? {})) names.add(name);
  } catch {}
  try {
    for (const entry of await readdir(userDataDir, { withFileTypes: true })) if (entry.isDirectory() && PROFILE_PATTERN.test(entry.name)) names.add(entry.name);
  } catch { return undefined; }
  const order = [lastUsed, 'Default', ...[...names].sort((a, b) => a.localeCompare(b))].filter(name => name !== undefined && names.has(name));
  for (const profile of new Set(order)) {
    const path = join(userDataDir, profile, 'Bookmarks');
    if (await exists(path)) return { profile, path };
  }
  return undefined;
}

const webUrl = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
};

/**
 * Convert a Chromium Bookmarks document into folders and web bookmarks.
 * @param document - the parsed Bookmarks JSON.
 * @returns root folders (empty ones dropped) and the number of bookmarks kept.
 */
export function parseChromiumBookmarks(document) {
  if (!document || typeof document !== 'object' || !document.roots || typeof document.roots !== 'object') {
    throw new BrowserError('bookmarks_unreadable', 'The bookmarks file is not in the expected format');
  }
  let count = 0;
  const convert = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return undefined;
    const title = typeof node.name === 'string' ? node.name.slice(0, 500) : '';
    if (node.type === 'url') {
      const url = webUrl(node.url);
      if (url === undefined || count >= MAX_BOOKMARKS) return undefined;
      count += 1;
      return { title: title || url, url };
    }
    if (node.type !== 'folder' || !Array.isArray(node.children)) return undefined;
    const children = node.children.map(child => convert(child, depth + 1)).filter(Boolean);
    return children.length === 0 ? undefined : { title, children };
  };
  const roots = ROOTS.map(key => {
    const folder = convert(document.roots[key], 0);
    return folder === undefined ? undefined : { ...folder, id: key };
  }).filter(Boolean);
  return { roots, count };
}

/**
 * Read one browser's bookmarks.
 * @param browser - `chrome` or `edge`.
 * @param userDataDir - that browser's user-data directory.
 * @returns the profile, roots and bookmark count.
 */
export async function readBrowserBookmarks(browser, userDataDir) {
  const found = await findBookmarksFile(userDataDir);
  if (found === undefined) throw new BrowserError('bookmarks_not_found', `No ${browser} bookmarks were found`);
  const info = await stat(found.path);
  if (info.size > MAX_FILE_BYTES) throw new BrowserError('bookmarks_too_large', 'The bookmarks file is too large to import');
  let document;
  try { document = JSON.parse(await readFile(found.path, 'utf8')); }
  catch (cause) { throw new BrowserError('bookmarks_unreadable', 'The bookmarks file could not be read', { cause }); }
  return { profile: found.profile, ...parseChromiumBookmarks(document) };
}

/** The saved snapshot per browser, and the summary every pane receives with the browser state. */
export class BookmarkStore {
  sources = {};
  revision = 0;
  writes = Promise.resolve();
  constructor(directory, emit, dirs = bookmarkUserDataDirs()) { this.directory = directory; this.emit = emit; this.dirs = dirs; }
  async start() {
    try {
      const saved = JSON.parse(await readFile(join(this.directory, 'bookmarks.json'), 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid bookmarks');
      this.sources = Object.fromEntries(Object.entries(saved).filter(([browser, source]) => BOOKMARK_BROWSERS.includes(browser)
        && source && Array.isArray(source.roots) && typeof source.count === 'number'));
    } catch (error) { if (error.code !== 'ENOENT') console.warn('[tpcowork-browser] saved bookmarks could not be read'); }
  }
  /** Counts and dates only; the pane fetches the folders when it shows them. */
  summary() {
    return { revision: this.revision, sources: Object.fromEntries(Object.entries(this.sources)
      .map(([browser, { profile, count, importedAt }]) => [browser, { profile, count, importedAt }])) };
  }
  /** Every imported browser's folders, and which browsers have a profile to import from. */
  async list() {
    const available = Object.fromEntries(await Promise.all(BOOKMARK_BROWSERS
      .map(async browser => [browser, (await findBookmarksFile(this.dirs[browser])) !== undefined])));
    return { revision: this.revision, available, sources: this.sources };
  }
  /**
   * Replace one browser's snapshot. Expected failures come back as a result, as the Chrome data import reports them,
   * because the desktop bridge keeps only an error's message.
   * @param browser - `chrome` or `edge`.
   * @returns `{ success, browser, profile?, count?, error? }`.
   */
  async import(browser) {
    if (!BOOKMARK_BROWSERS.includes(browser)) throw new BrowserError('invalid_browser', 'Bookmarks can be imported from Chrome or Edge');
    let read;
    try { read = await readBrowserBookmarks(browser, this.dirs[browser]); }
    catch (error) {
      if (error instanceof BrowserError) return { success: false, browser, error: error.code };
      throw error;
    }
    const next = { ...this.sources, [browser]: { ...read, importedAt: new Date().toISOString() } };
    const content = JSON.stringify(next);
    this.writes = this.writes.catch(() => {}).then(async () => {
      const temporary = join(this.directory, `bookmarks.json-${randomUUID()}.tmp`);
      await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
      await rename(temporary, join(this.directory, 'bookmarks.json'));
    });
    await this.writes;
    this.sources = next;
    this.revision += 1;
    this.emit();
    return { success: true, browser, profile: read.profile, count: read.count };
  }
}
