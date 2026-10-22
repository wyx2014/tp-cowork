import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserError, OperationQueue } from './protocol.js';
import { importChromeBrowserData } from './reference.js';

/** Website permission decisions and browser-data operations owned by the desktop. */
export class BrowserData {
  permissions = {};
  security = { allowInsecureCertificates: false };
  /** The setting this process applied at start; Chromium caches verification results, so changes wait for a restart. */
  activeSecurity = { allowInsecureCertificates: false };
  pending = new Map();
  writes = Promise.resolve();
  decisions = new OperationQueue();
  constructor(browserSession, directory, emit, timeout) { this.session = browserSession; this.directory = directory; this.emit = emit; this.timeout = timeout; }
  async start(isGuest, allowedUrl) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const saved = JSON.parse(await readFile(join(this.directory, 'permissions.json'), 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid website permissions');
      for (const [origin, rules] of Object.entries(saved)) {
        if (new URL(origin).origin !== origin || !/^https?:/.test(origin) || !rules || typeof rules !== 'object' || Array.isArray(rules)) throw new Error('Invalid website permission origin');
        if (Object.keys(rules).some(key => !key || ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('Invalid website permission name');
        if (Object.values(rules).some(rule => !['allow', 'deny'].includes(rule))) throw new Error('Invalid website permission decision');
      }
      this.permissions = saved;
    } catch (error) { if (error.code !== 'ENOENT') throw new BrowserError('permissions_unreadable', 'Website permissions could not be read', { cause: error }); }
    try {
      const saved = JSON.parse(await readFile(join(this.directory, 'security.json'), 'utf8'));
      if (!saved || typeof saved.allowInsecureCertificates !== 'boolean' || Object.keys(saved).length !== 1) throw new Error('Invalid browser security settings');
      this.security = saved;
    } catch (error) { if (error.code !== 'ENOENT') throw new BrowserError('security_unreadable', 'Browser security settings could not be read', { cause: error }); }
    this.applySecurity();
    this.session.setPermissionCheckHandler((contents, permission, origin) => isGuest(contents)
      && this.permissions[origin]?.[permission] === 'allow');
    this.session.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (!isGuest(contents)) { callback(false); return; }
      let origin;
      try { origin = new URL(details.requestingUrl ?? contents.getURL()).origin; }
      catch { callback(false); return; }
      const decision = this.permissions[origin]?.[permission];
      if (decision) { callback(decision === 'allow'); return; }
      const id = randomUUID();
      const finish = allowed => { const entry = this.pending.get(id); if (!entry) return; clearTimeout(entry.timer); this.pending.delete(id); callback(allowed); this.emit(); };
      const timer = setTimeout(() => finish(false), this.timeout());
      this.pending.set(id, { id, origin, permission, callback: finish, timer, guestId: contents.id });
      this.emit();
    });
    this.session.setDevicePermissionHandler(() => false);
    this.session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
    this.session.webRequest.onBeforeRequest((details, callback) => {
      if (['about:', 'data:', 'blob:'].some(protocol => details.url.startsWith(protocol))) { callback({}); return; }
      callback({ cancel: !allowedUrl(details.url, true) });
    });
  }
  snapshot() {
    return { permissions: this.permissions, security: { ...this.security, restartRequired: this.security.allowInsecureCertificates !== this.activeSecurity.allowInsecureCertificates }, requests: [...this.pending.values()].map(({ id, origin, permission, guestId }) => ({ id, origin, permission, guestId })) };
  }
  /**
   * Accept every certificate only in this browser's own partition, as the reference does for its
   * embedded browser: the application's own traffic keeps full TLS verification.
   */
  applySecurity() {
    this.activeSecurity = { ...this.security };
    this.session.setCertificateVerifyProc(this.security.allowInsecureCertificates ? (_request, callback) => callback(0) : null);
  }
  setSecurity(input) {
    if (!input || typeof input.allowInsecureCertificates !== 'boolean') throw new BrowserError('invalid_security', 'Expected a boolean certificate setting');
    return this.decisions.run('permissions', undefined, async () => {
      const next = { allowInsecureCertificates: input.allowInsecureCertificates };
      // Saved for the next start, as in the reference: Chromium keeps earlier verification results
      // for the life of the process, so applying now would leave visited sites on the old decision.
      await this.persistFile('security.json', next);
      this.security = next;
      this.emit();
    });
  }
  setPermission(origin, permission, decision) {
    return this.decisions.run('permissions', undefined, () => this.updatePermission(origin, permission, decision));
  }
  async updatePermission(origin, permission, decision) {
    if (typeof origin !== 'string' || new URL(origin).origin !== origin || !/^https?:/.test(origin)
      || typeof permission !== 'string' || permission.length === 0 || permission.length > 100 || ['__proto__','constructor','prototype'].includes(permission) || !['ask', 'allow', 'deny'].includes(decision)) throw new BrowserError('invalid_permission', 'Invalid website permission');
    const next = structuredClone(this.permissions);
    next[origin] ??= {};
    if (decision === 'ask') delete next[origin][permission]; else next[origin][permission] = decision;
    await this.persist(next);
    this.permissions = next;
    this.emit();
  }
  async respond(id, allow, remember) {
    if (typeof id !== 'string' || typeof allow !== 'boolean' || typeof remember !== 'boolean') throw new BrowserError('invalid_permission', 'Expected a permission request ID and boolean decisions');
    const entry = this.pending.get(id);
    if (!entry) throw new BrowserError('expired_permission', 'The website permission request has expired');
    if (remember) await this.setPermission(entry.origin, entry.permission, allow ? 'allow' : 'deny');
    entry.callback(allow === true);
  }
  persist(next) { return this.persistFile('permissions.json', next); }
  async persistFile(name, next) {
    const content = JSON.stringify(next);
    this.writes = this.writes.catch(() => {}).then(async () => {
      const temporary = join(this.directory, `${name}-${randomUUID()}.tmp`);
      await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
      await rename(temporary, join(this.directory, name));
    });
    await this.writes;
  }
  clear(mode, confirmed) {
    return this.decisions.run('permissions', undefined, () => this.clearData(mode, confirmed));
  }
  async clearData(mode, confirmed) {
    if (!['cache', 'all'].includes(mode) || (mode === 'all' && confirmed !== true)) throw new BrowserError('confirmation_required', 'Confirm clearing all browser login data');
    await this.session.clearCache();
    if (mode === 'all') {
      await this.session.clearStorageData();
      await this.persist({}); this.permissions = {};
    } else await this.session.clearStorageData({ storages: ['shadercache', 'cachestorage'] });
    await this.session.cookies.flushStore();
    this.session.flushStorageData();
    this.emit();
    return { success: true };
  }
  async importChrome() {
    const result = await importChromeBrowserData({ targetSession: this.session, logger: { info() {}, warn(message) { console.warn('[tpcowork-browser]', message); } } });
    await this.session.cookies.flushStore(); this.session.flushStorageData();
    return result;
  }
  cancelPending() { for (const entry of [...this.pending.values()]) entry.callback(false); }
  async dispose() {
    this.cancelPending();
    this.session.setPermissionRequestHandler((_c, _p, callback) => callback(false));
    this.session.setPermissionCheckHandler(() => false);
    this.session.setCertificateVerifyProc(null);
    await this.decisions.drain();
    await this.writes;
    await this.session.cookies.flushStore(); this.session.flushStorageData();
  }
}
