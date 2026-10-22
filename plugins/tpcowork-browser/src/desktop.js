import { app, BrowserWindow, dialog, nativeImage, session, shell, webContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { BrowserGuestManager, BrowserTabRecoveryStore, DesktopBrowserScreenshotSurfaceCoordinator, DesktopBrowserScreenshotActivityController, createElectronBrowserWebmRecorder } from './reference.js';
import { parseCommand } from './schema.js';
import { BrowserData } from './desktop-data.js';
import { resolveConfig } from './config.js';
import { BrowserError, CHANNEL, VERSION, PARTITION, IPC, envelope, failure, OperationQueue } from './protocol.js';

const SCOPE = 'dsh-desktop';
const BROWSER = 'tpcowork-dsh-iab';
const USER_OPERATIONS = new Set(['snapshot', 'humanOpen', 'command', 'close', 'pause', 'resume', 'ensure', 'surfaceReady', 'importChrome', 'clearData', 'permissionRespond', 'permissionSet', 'security', 'devtools', 'external', 'revealDownload', 'saveScreenshot', 'saveRecording', 'presentation']);

/** Favicons the renderer may load: page-supplied web or inline image addresses only. */
function faviconUrl(candidates) {
  for (const value of candidates ?? []) {
    try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href; if (url.protocol === 'data:' && /^data:image\//u.test(value) && value.length <= 65536) return value; }
    catch {}
  }
  return undefined;
}

/** Create the Electron adapter; all renderer calls are admitted by the shell's primary-frame check. */
export function createDesktopBrowser(options) { return new DesktopBrowser(options); }

class DesktopBrowser {
  enabled = false;
  records = new Map();
  leases = new Map();
  running = new Map();
  downloads = new Map();
  restored = new Map();
  downloadItems = new Map();
  automatedRecordings = new Map();
  lifecycle = new OperationQueue();
  dataQueue = new OperationQueue();
  queue = new OperationQueue();
  generation = 0;
  config = resolveConfig();
  constructor(options) {
    this.options = options;
    this.directory = join(options.userData, 'tpcowork-browser');
    this.browserSession = session.fromPartition(PARTITION);
    this.recovery = new BrowserTabRecoveryStore(join(this.directory, 'tabs.json'), { onWarning: message => console.warn('[tpcowork-browser]', message) });
    this.data = new BrowserData(this.browserSession, this.directory, () => this.publish(), () => this.config.permissionTimeoutMs);
    this.ready = this.data.start(contents => [...this.records.values()].some(record => record.guest === contents), (url, network) => this.allowedUrl(url, network));
    this.downloadListener = (_event, item, contents) => {
      const record = [...this.records.values()].find(row => row.guest === contents);
      if (!this.enabled || !record) { _event.preventDefault(); return; }
      const id = randomUUID();
      const path = join(this.directory, 'downloads', `${id}-${basename(item.getFilename())}`);
      item.setSavePath(path);
      const download = { id, tabId: record.id, sessionId: record.sessionId, name: item.getFilename(), path, status: 'progressing', received: 0, total: item.getTotalBytes() };
      const done = new Promise(resolve => item.once('done', resolve));
      this.downloads.set(id, download); this.downloadItems.set(id, { item, done });
      item.on('updated', (_event, state) => { Object.assign(download, { status: state, received: item.getReceivedBytes(), total: item.getTotalBytes() }); this.publish(); });
      item.once('done', (_event, state) => { download.status = state; this.downloadItems.delete(id); this.publish(); });
      this.publish();
    };
    this.browserSession.on('will-download', this.downloadListener);
  }
  window() {
    const window = this.options.window();
    if (!window || window.isDestroyed()) throw new BrowserError('window_unavailable', 'Open the DSH desktop window to use its browser');
    return window;
  }
  allowedUrl(value, network = false) {
    try {
      const url = new URL(value);
      if (!(network ? ['http:', 'https:', 'ws:', 'wss:'] : ['http:', 'https:']).includes(url.protocol) || url.username || url.password) return false;
      const host = this.options.hostUrl();
      if (!host) return true;
      const target = new URL(host);
      return !(url.port === target.port && [target.hostname, 'localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    } catch { return false; }
  }
  context(sessionId, requestId = randomUUID()) {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) throw new BrowserError('invalid_session', 'A browser session identity is required');
    return { requestId, sessionId, workspaceKey: SCOPE, browserId: BROWSER, browserGeneration: 1, windowId: this.window().id, clientMode: 'desktop-continuous' };
  }
  enable(config) {
    const resolved = resolveConfig(config);
    return this.lifecycle.run('lifecycle', undefined, () => this.start(resolved));
  }
  async start(config) {
    await this.ready;
    if (this.enabled) return { version: VERSION };
    this.config = config;
    await mkdir(join(this.directory, 'downloads'), { recursive: true, mode: 0o700 });
    await mkdir(join(this.directory, 'recordings'), { recursive: true, mode: 0o700 });
    this.enabled = true;
    this.generation++;
    const activity = new DesktopBrowserScreenshotActivityController({
      fromId: id => BrowserWindow.fromId(id), fromWebContentsId: id => webContents.fromId(id),
      allowTransparentWindowBootstrap: process.platform === 'darwin' || process.platform === 'win32',
      hideTaskbarDuringTransparentWindowBootstrap: process.platform === 'win32',
    });
    this.surfaces = new DesktopBrowserScreenshotSurfaceCoordinator({
      acquireActivity: (windowId, payload) => activity.acquire({ windowId, webContentsId: payload.webContentsId, requestId: payload.requestId, reason: 'browser-screenshot' }),
      sendPrepare: (_windowId, payload) => { this.surface = payload; this.emit('surface', payload); return true; },
      sendRelease: (_windowId, payload) => { if (this.surface?.requestId === payload.requestId) this.surface = undefined; this.emit('surfaceReleased', payload); },
    });
    this.manager = new BrowserGuestManager(undefined, config.attachTimeoutMs,
      id => { this.closeRecord(id); },
      (id, owner) => { this.reserve(id, owner); },
      (visible, owner, id) => { if (id) for (const row of this.records.values()) if (row.sessionId === owner.sessionId) row.active = row.id === id; this.publish(); this.emit('activate', { sessionId: owner.sessionId, tabId: id, visible }); },
      (viewport, _owner, id) => { const row = this.records.get(id); if (row) row.viewport = viewport; this.publish(); },
      (png, size) => nativeImage.createFromBuffer(Buffer.from(png, 'base64')).resize({ ...size, quality: 'best' }).toPNG().toString('base64'),
      this.surfaces,
      { tabLimit: config.tabLimit, recoveryStore: this.recovery,
        onResidencyChanged: payload => { const row = this.records.get(payload.tabId); if (row) { row.restoring = false; row.suspended = false; this.publish(); } },
        onRestoreTabRequested: payload => { const owner = this.manager.getTabOwner(payload.tabId); if (owner) this.reserve(payload.tabId, owner, payload.generation); },
        recording: { tempRoot: join(this.directory, 'recordings'), createRecorder: createElectronBrowserWebmRecorder } },
      windowId => BrowserWindow.fromId(windowId),
    );
    this.publish();
    return { version: VERSION, loginStorage: 'application', native: true };
  }
  async restore(sessionId) {
    if (this.restored.has(sessionId)) return this.restored.get(sessionId);
    const work = this.restoreSession(sessionId);
    this.restored.set(sessionId, work);
    try { await work; } catch (error) { this.restored.delete(sessionId); throw error; }
  }
  async restoreSession(sessionId) {
    const scope = this.context(sessionId);
    const rows = await this.manager.restoreTabs(scope);
    for (const row of rows) {
      if (this.records.has(row.tabId)) continue;
      this.records.set(row.tabId, { id: row.tabId, sessionId, title: row.title, url: row.restoreUrl, origin: row.origin, viewport: row.viewport, ready: false, active: false, suspended: true });
    }
    this.publish();
  }
  reserve(id, owner, residencyGeneration, reveal = true) {
    const current = this.records.get(id);
    if (current?.guest && !current.guest.isDestroyed()) return current;
    if (current?.lease) this.leases.delete(current.lease);
    const lease = `tpcowork-browser-${randomUUID()}`;
    const row = { ...current, id, sessionId: owner.sessionId, origin: current?.origin ?? 'agent', lease, partition: PARTITION,
      bootstrap: `about:blank#${lease}`, guest: undefined, attaching: false, ready: false, suspended: false, restoring: residencyGeneration !== undefined, residencyGeneration };
    this.records.set(id, row); this.leases.set(lease, row);
    this.publish();
    if (reveal) this.emit('activate', { sessionId: owner.sessionId, tabId: id, visible: true });
    return row;
  }
  /** Return true only when this extension owns this bootstrap; the shell handles ordinary guests. */
  willAttach(owner, event, preferences, params) {
    if (!params.src?.startsWith('about:blank#tpcowork-browser-')) return false;
    const row = this.leases.get(params.src.slice('about:blank#'.length));
    if (!this.enabled || owner !== this.window().webContents || !row || row.attaching || params.partition !== PARTITION) { event.preventDefault(); return true; }
    row.attaching = true;
    for (const key of Object.keys(preferences)) if (key !== 'disablePopups') delete preferences[key];
    Object.assign(preferences, { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, plugins: false, navigateOnDragDrop: false, backgroundThrottling: false, devTools: !app.isPackaged });
    params.httpreferrer = '';
    return true;
  }
  didAttach(owner, guest) {
    if (guest.session !== this.browserSession) return false;
    let row;
    guest.once('dom-ready', () => {
      row = this.leases.get(guest.getURL().slice('about:blank#'.length));
      if (!this.enabled || !row || row.guest || owner !== this.window().webContents) { guest.close(); return; }
      row.guest = guest;
      const attached = this.manager.attachGuest(row.id, guest.id, { active: true, windowId: this.window().id, workspaceKey: SCOPE, sessionId: row.sessionId, ...(row.residencyGeneration === undefined ? {} : { residencyGeneration: row.residencyGeneration }) });
      if (!attached.ok) { row.error = attached.reason; guest.close(); this.publish(); return; }
      row.ready = true; row.error = undefined;
      const update = () => {
        if (guest.isDestroyed()) return;
        Object.assign(row, { url: guest.getURL(), title: guest.getTitle(), loading: guest.isLoading(), ...(guest.isLoading() ? { error: undefined, loadErrorCode: undefined } : {}), canGoBack: guest.navigationHistory.canGoBack(), canGoForward: guest.navigationHistory.canGoForward() });
        this.publish();
      };
      for (const event of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) guest.on(event, update);
      // A new document has not announced its favicon yet; the previous site's icon must not linger.
      guest.on('did-navigate', () => { if (row.favicon) { row.favicon = undefined; this.publish(); } });
      guest.on('page-favicon-updated', (_event, favicons) => { const favicon = faviconUrl(favicons); if (favicon !== row.favicon) { row.favicon = favicon; this.publish(); } });
      // The Chromium net error code lets the pane explain certificate failures, as the reference does.
      guest.on('did-fail-load', (_e, code, message, _url, main) => { if (main && code !== -3) { row.error = message; row.loadErrorCode = code; this.publish(); } });
      guest.on('render-process-gone', () => { row.ready = false; row.error = 'Page process exited. Restoring the tab.'; this.publish(); if (!guest.isDestroyed()) guest.close({ waitForBeforeUnload: false }); });
      guest.once('destroyed', () => { if (row.guest === guest) { delete row.guest; row.ready = false; row.attaching = false; this.publish(); } });
      if (row.initialUrl) { const url = row.initialUrl; delete row.initialUrl; void guest.loadURL(url).catch(error => { row.error = error.message; this.publish(); }); }
      update();
    });
    guest.setWindowOpenHandler(({ url }) => {
      if (row && this.allowedUrl(url)) void this.humanOpen(row.sessionId, url).catch(error => { row.error = error.message; this.publish(); });
      return { action: 'deny' };
    });
    guest.on('will-frame-navigate', event => { if (event.isMainFrame && !this.allowedUrl(event.url)) event.preventDefault(); });
    guest.on('will-redirect', (event, url, _inPlace, main) => { if (main && !this.allowedUrl(url)) event.preventDefault(); });
    guest.on('will-attach-webview', event => event.preventDefault());
    return true;
  }
  async humanOpen(sessionId, url, reveal = true) {
    this.context(sessionId);
    if (url && !this.allowedUrl(url)) throw new BrowserError('invalid_url', 'Only HTTP(S) pages outside the DSH application are allowed');
    await this.restore(sessionId);
    if (!this.enabled) throw new BrowserError('disabled', 'Browser plugin is disabled');
    if (this.dataBusy) throw new BrowserError('data_busy', 'Browser data is being updated. Try again when it finishes.');
    const id = `browser:${randomUUID()}`;
    const row = this.reserve(id, this.context(sessionId), undefined, false);
    Object.assign(row, { origin: 'user', active: true, initialUrl: url });
    this.publish();
    if (reveal) this.emit('activate', { sessionId, tabId: id, visible: true });
    return { tabId: id };
  }
  async command(sessionId, input, requestId, signal, human = false) {
    if (!this.enabled) throw new BrowserError('disabled', 'Browser plugin is disabled');
    signal ??= AbortSignal.timeout(this.config.timeoutMs);
    const command = parseCommand(input);
    if ('outputPath' in command) throw new BrowserError('invalid_path', 'Use the tool outputPath parameter to save inside the workspace');
    if (['closeSession', 'turnEnded', 'cancelRequest'].includes(command.method)) throw new BrowserError('invalid_operation', 'Lifecycle commands are private to the browser adapter');
    if (command.method === 'navigate' && !this.allowedUrl(command.url)) throw new BrowserError('invalid_url', 'Only HTTP(S) pages outside the DSH application are allowed');
    await this.restore(sessionId);
    const row = command.tabId ? this.records.get(command.tabId) : undefined;
    if (row && row.sessionId !== sessionId) throw new BrowserError('wrong_session', 'This browser tab belongs to another session');
    if (!human && (row?.paused || [...this.records.values()].some(item => item.sessionId === sessionId && item.active && item.paused && !command.tabId))) throw new BrowserError('human_control', 'The user has taken control of this browser. Wait for them to resume automation.');
    const scope = human && row ? { ...(this.manager.getTabOwner(row.id) ?? this.context(sessionId)), requestId } : this.context(sessionId, requestId);
    const key = sessionId;
    const execute = async () => {
      if (!this.enabled) throw new BrowserError('disabled', 'Browser plugin is disabled');
      if (this.dataBusy) throw new BrowserError('data_busy', 'Browser data is being updated. Try again when it finishes.');
      if (!human && [...this.records.values()].some(item => item.sessionId === sessionId && item.paused && (!command.tabId || item.id === command.tabId))) throw new BrowserError('human_control', 'The user controls this page. Wait for them to resume automation.');
      this.emit('operation', { sessionId, tabId: command.tabId, active: true, method: command.method });
      try {
        const result = await this.manager.execute(scope, command, signal);
        if (result.recording && !human && command.method === 'recordingStart') this.automatedRecordings.set(result.recording.id, { sessionId, tabId: result.meta?.tabId ?? command.tabId });
        if (result.recording && result.recording.status !== 'running') this.automatedRecordings.delete(result.recording.id);
        if (result.tab) {
          const target = this.records.get(result.tab.id ?? result.tab.tabId);
          if (target) Object.assign(target, { active: true });
        }
        const completedId = result.tab?.tabId ?? result.meta?.tabId ?? command.tabId;
        const completed = this.records.get(completedId);
        if (completed && result.ok && !completed.restoring) await this.report(completed);
        this.publish();
        return result;
      } finally { this.emit('operation', { sessionId, tabId: command.tabId, active: false }); }
    };
    // Dialog replies must be able to settle a page action waiting for that dialog.
    return ['getDialog', 'handleDialog', 'recordingStatus', 'recordingCancel', 'list', 'listUserTabs'].includes(command.method)
      ? execute() : this.queue.run(key, signal, execute);
  }
  async handleHost(value, reply) {
    let message;
    try { message = envelope(value); } catch (error) { reply({ type: CHANNEL, version: VERSION, kind: 'result', id: value?.id ?? 'invalid', error: failure(error) }); return; }
    if (message.kind === 'cancel') { this.running.get(message.id)?.controller.abort(); return; }
    if (message.kind !== 'request') return;
    const controller = new AbortController();
    if (this.running.has(message.id)) { reply({ type: CHANNEL, version: VERSION, kind: 'result', id: message.id, error: { code: 'duplicate_request', message: 'Browser request is already running' } }); return; }
    this.running.set(message.id, { controller, sessionId: message.payload?.sessionId });
    try {
      let result;
      if (message.op === 'enable') result = await this.enable(message.payload);
      else if (message.op === 'disable') { await this.disable(); result = {}; }
      else if (message.op === 'command') result = await this.command(message.payload?.sessionId, message.payload?.command, message.id, controller.signal);
      else if (message.op === 'ambient') result = this.ambient(message.payload?.sessionId);
      else throw new BrowserError('invalid_operation', 'Unknown browser bridge operation');
      reply({ type: CHANNEL, version: VERSION, kind: 'result', id: message.id, value: result });
    } catch (error) { reply({ type: CHANNEL, version: VERSION, kind: 'result', id: message.id, error: failure(error) }); }
    finally { this.running.delete(message.id); }
  }
  async request(op, payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BrowserError('invalid_request', 'Invalid browser request');
    if (!USER_OPERATIONS.has(op)) throw new BrowserError('invalid_operation', 'Unknown browser UI operation');
    if (op === 'snapshot') { if (this.enabled && payload.sessionId) await this.restore(payload.sessionId); return this.snapshot(); }
    if (!this.enabled) throw new BrowserError('disabled', 'Enable the browser plugin to use this feature');
    if (op === 'humanOpen') return this.humanOpen(payload.sessionId, payload.url, payload.reveal !== false);
    if (op === 'command') return this.command(payload.sessionId, payload.command, randomUUID(), undefined, true);
    if (op === 'surfaceReady') { this.surfaces.handleReady({ windowId: this.window().id, senderWebContentsId: this.window().webContents.id, payload }); return {}; }
    if (op === 'saveScreenshot' || op === 'saveRecording') {
      const result = await this.command(payload.sessionId, op === 'saveScreenshot' ? { method: 'screenshot', tabId: payload.tabId } : { method: 'recordingStatus', tabId: payload.tabId, recordingId: payload.recordingId }, randomUUID(), undefined, true);
      if (!result.ok) throw new BrowserError('capture_failed', result.error?.message ?? 'Capture failed');
      const source = result.recording?.status === 'completed' && result.recording.artifact?.path;
      if (!result.image && !source) throw new BrowserError('not_ready', 'Recording has not completed');
      const chosen = await dialog.showSaveDialog(this.window(), { defaultPath: op === 'saveScreenshot' ? 'browser.png' : 'browser.webm' });
      if (chosen.canceled || !chosen.filePath) return { cancelled: true };
      if (result.image) await writeFile(chosen.filePath, Buffer.from(result.image.base64, 'base64'), { mode: 0o600 });
      else await copyFile(source, chosen.filePath);
      return { saved: true };
    }
    if (op === 'importChrome' || op === 'clearData') return this.dataQueue.run('data', undefined, async () => {
      if (op === 'clearData' && (!['cache','all'].includes(payload.mode) || (payload.mode === 'all' && payload.confirmed !== true))) throw new BrowserError('confirmation_required', 'Confirm clearing all browser login data');
      this.dataBusy = true;
      try {
        await this.queue.drain();
        if (op === 'importChrome') return await this.data.importChrome();
        if (payload.mode === 'all') {
          this.data.cancelPending();
          for (const row of [...this.records.values()]) {
            await this.manager.closeTabFromRenderer({ tabId: row.id, windowId: this.window().id, workspaceKey: SCOPE, sessionId: row.sessionId });
            this.closeRecord(row.id);
          }
        }
        return await this.data.clear(payload.mode, payload.confirmed);
      } finally { this.dataBusy = false; }
    });
    if (op === 'permissionRespond') { await this.data.respond(payload.id, payload.allow, payload.remember); return {}; }
    if (op === 'permissionSet') { await this.data.setPermission(payload.origin, payload.permission, payload.decision); return {}; }
    if (op === 'security') { await this.data.setSecurity(payload); return {}; }
    if (op === 'external') { if (!this.allowedUrl(payload.url)) throw new BrowserError('invalid_url', 'Invalid external URL'); await shell.openExternal(payload.url); return {}; }
    if (op === 'revealDownload') { const file = this.downloads.get(payload.id); if (!file || file.status !== 'completed') throw new BrowserError('not_ready', 'Download has not completed'); shell.showItemInFolder(file.path); return {}; }
    const row = this.records.get(payload.tabId);
    if (!row && op === 'close') return {};
    if (!row || row.sessionId !== payload.sessionId) throw new BrowserError('tab_unavailable', 'This browser tab is no longer available');
    if (op === 'presentation') {
      if (typeof payload.visible !== 'boolean') throw new BrowserError('invalid_request', 'Expected page visibility');
      row.visible = payload.visible; row.active = payload.visible;
      if (row.ready && !row.restoring) await this.report(row);
    }
    if (op === 'devtools') {
      if (app.isPackaged) throw new BrowserError('unavailable', 'Developer tools are available in development builds only');
      if (!row.guest || row.guest.isDestroyed()) throw new BrowserError('tab_unavailable', 'This browser tab is not loaded');
      row.guest.openDevTools({ mode: 'detach' });
    }
    if (op === 'close') { await this.manager.closeTabFromRenderer({ tabId: row.id, windowId: this.window().id, workspaceKey: SCOPE, sessionId: row.sessionId }); this.closeRecord(row.id); }
    if (op === 'pause' || op === 'resume') {
      row.paused = op === 'pause';
      this.publish();
      if (row.paused) {
        for (const entry of this.running.values()) if (entry.sessionId === row.sessionId) entry.controller.abort();
        for (const [id, recording] of this.automatedRecordings) if (recording.tabId === row.id) {
          await this.manager.execute(this.context(row.sessionId), { method: 'recordingCancel', recordingId: id, tabId: row.id });
          this.automatedRecordings.delete(id);
        }
      }
    }
    if (op === 'ensure') {
      if (row.suspended) await this.manager.ensureResidentFromRenderer({ tabId: row.id, windowId: this.window().id, workspaceKey: SCOPE, sessionId: row.sessionId });
      else if (!row.guest) this.reserve(row.id, this.context(row.sessionId));
    }
    return {};
  }
  /** Read-only: no tab restore, operation status or page access; the Host sanitizes the address. */
  ambient(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) throw new BrowserError('invalid_session', 'A browser session identity is required');
    const rows = this.enabled ? [...this.records.values()].filter(row => row.sessionId === sessionId) : [];
    const current = rows.find(row => row.active) ?? rows.find(row => row.origin === 'user') ?? rows.at(-1);
    return { tabCount: rows.length, ...(current?.url ? { currentUrl: current.url } : {}) };
  }
  async report(row) {
    if (!this.manager.getTabOwner(row.id)) return;
    await this.manager.reportResidency({ tabId: row.id, windowId: this.window().id, workspaceKey: SCOPE, sessionId: row.sessionId, restoreUrl: row.url?.startsWith('http') ? row.url : undefined, title: row.title, loading: row.loading === true, selected: row.active === true, visible: row.visible === true, currentTask: row.visible === true });
  }
  snapshot() {
    return { version: VERSION, enabled: this.enabled, generation: this.generation, devTools: !app.isPackaged,
      tabs: [...this.records.values()].map(({ guest, ...row }) => ({ ...row, guestId: guest && !guest.isDestroyed() ? guest.id : undefined })),
      downloads: [...this.downloads.values()], ...this.data.snapshot() };
  }
  emit(kind, payload) {
    const window = this.options.window();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC.event, { kind, payload });
  }
  publish() { this.emit('state', this.snapshot()); }
  closeRecord(id, notify = true) {
    const row = this.records.get(id);
    if (!row) return;
    this.records.delete(id); this.leases.delete(row.lease);
    for (const [recordingId, recording] of this.automatedRecordings) if (recording.tabId === id) this.automatedRecordings.delete(recordingId);
    if (notify) this.emit('closed', { sessionId: row.sessionId, tabId: id });
    if (row.guest && !row.guest.isDestroyed()) row.guest.close({ waitForBeforeUnload: false });
    this.publish();
  }
  disable() {
    return this.lifecycle.run('lifecycle', undefined, () => this.stop());
  }
  async stop() {
    if (!this.enabled) return;
    this.enabled = false;
    this.data.cancelPending();
    for (const entry of this.running.values()) entry.controller.abort();
    await this.queue.drain();
    await this.dataQueue.drain();
    const downloads = [...this.downloadItems.values()];
    for (const { item } of downloads) item.cancel();
    await Promise.allSettled(downloads.map(entry => entry.done));
    this.downloadItems.clear();
    await this.recovery.whenIdle();
    this.surfaces?.dispose(); await this.manager?.disposeAll(); await this.recovery.whenIdle();
    for (const row of [...this.records.values()]) this.closeRecord(row.id, false);
    this.restored.clear(); this.automatedRecordings.clear();
    await this.browserSession.cookies.flushStore(); this.browserSession.flushStorageData();
    this.publish();
  }
  async dispose() {
    await this.disable();
    await this.data.dispose();
    this.browserSession.removeListener('will-download', this.downloadListener);
  }
}
