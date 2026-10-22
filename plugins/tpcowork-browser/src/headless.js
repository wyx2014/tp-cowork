/** The reference's managed headless Chromium, behind the desktop bridge's operation protocol. */
import { createManagedCdpBrowserRuntime } from '../vendor/tpcowork/apps/tpcowork-cli/packages/adapters/src/browser/index.ts';
import { BrowserError, VERSION } from './protocol.js';

/** The built plugin ships an intact playwright-core beside this module; sources use the dev install. */
async function loadPlaywright() {
  try { return await import(new URL('./playwright-core/index.mjs', import.meta.url).href); }
  catch (error) { if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  return import('playwright-core');
}

export class HeadlessBackend {
  closed = false;
  sessions = new Set();
  constructor(config, options = {}) {
    this.runtime = createManagedCdpBrowserRuntime({ executablePath: config.executablePath, loadPlaywright: options.loadPlaywright ?? loadPlaywright });
    this.port = this.runtime.browserControlPort;
  }
  /** Launch on first use: discovery starts Chromium and supplies the runtime's exact identity. */
  async identity(sessionId, signal) {
    this.descriptor ??= (async () => (await this.port.list({ sessionId, signal }))[0])();
    try { return await this.descriptor; }
    catch (error) { this.descriptor = undefined; throw error; }
  }
  async call(op, payload = {}, signal) {
    if (this.closed) throw new BrowserError('disposed', 'Browser plugin disabled');
    signal?.throwIfAborted();
    if (op === 'enable') return { version: VERSION, native: false, headless: true };
    if (op === 'disable') return {};
    const sessionId = payload.sessionId;
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) throw new BrowserError('invalid_session', 'A browser session identity is required');
    if (op === 'ambient') {
      // Never launch Chromium merely to describe a Session that has not used it.
      if (!this.sessions.has(sessionId)) return { tabCount: 0 };
      const result = await this.execute(sessionId, { method: 'list' }, signal);
      const tabs = result.ok ? result.tabs ?? [] : [];
      const current = tabs.find(tab => tab.active) ?? tabs.at(-1);
      return { tabCount: tabs.length, ...(current?.url ? { currentUrl: current.url } : {}) };
    }
    if (op === 'command') {
      this.sessions.add(sessionId);
      return this.execute(sessionId, payload.command, signal);
    }
    throw new BrowserError('invalid_operation', 'Unknown browser bridge operation');
  }
  async execute(sessionId, command, signal) {
    for (let attempt = 0; ; attempt++) {
      const { id, generation } = await this.identity(sessionId, signal);
      const result = await this.port.execute({ browserId: id, browserGeneration: generation, sessionId, command, signal });
      // A relaunched Chromium has a new generation; the stale check precedes dispatch, so one retry is safe.
      if (attempt > 0 || result.ok || result.error?.code !== 'backend_unavailable' || !/ is stale$/u.test(result.error.message ?? '')) return result;
      this.descriptor = undefined;
    }
  }
  /** A launched browser belongs to its Session; tabs end with it. */
  async closeSession(sessionId) {
    if (!this.sessions.delete(sessionId) || this.closed) return;
    await this.port.closeSession({ sessionId });
    if (this.sessions.size === 0) this.descriptor = undefined;
  }
  async dispose() {
    if (this.closed) return;
    this.closed = true;
    this.sessions.clear();
    await this.runtime.close();
  }
}

export function createHeadlessBackend(config, options) { return new HeadlessBackend(config, options); }
