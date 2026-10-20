import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';

/** Native facts enter one observable; only viewport anchors are retained outside serializable state. */
export class BrowserClient {
  state = createSnapshotStore({ enabled: false, tabs: [], downloads: [], permissions: {}, requests: [], bindings: {}, operations: {}, surface: null, error: null });
  anchors = new Map();
  opening = new Set();
  mounting = new Map();
  listeners = new Map();
  pending = new Map();
  disposed = false;
  constructor(ctx, carrier) {
    this.ctx = ctx; this.carrier = carrier;
    this.stop = carrier?.subscribe(event => this.receive(event));
    this.stopSession = ctx.sidebarRight.mounted.subscribe(() => { void this.refresh().catch(error => this.fail(error)); });
  }
  async refresh() {
    if (!this.carrier || this.disposed) return;
    const value = await this.carrier.request('snapshot', { sessionId: this.ctx.sidebarRight.mounted.getSnapshot() });
    this.receive({ kind: 'state', payload: value });
    const sessionId = this.ctx.sidebarRight.mounted.getSnapshot();
    for (const [id, owner] of this.pending) if (owner === sessionId) this.reveal(owner, id);
  }
  fail(error) { if (!this.disposed) this.state.update(draft => { draft.error = error.message ?? String(error); }); }
  receive({ kind, payload }) {
    if (this.disposed) return;
    if (kind === 'state') {
      this.state.update(draft => { Object.assign(draft, payload); });
      return;
    }
    if (kind === 'surface') this.state.update(draft => { draft.surface = payload; });
    if (kind === 'surfaceReleased') this.state.update(draft => { if (draft.surface?.requestId === payload.requestId) draft.surface = null; });
    if (kind === 'operation') this.state.update(draft => { draft.operations[payload.tabId ?? payload.sessionId] = payload.active; });
    if (kind === 'activate' && payload.visible && payload.tabId) { this.pending.set(payload.tabId, payload.sessionId); this.reveal(payload.sessionId, payload.tabId); }
    if (kind === 'activate' && !payload.visible && this.ctx.sidebarRight.mounted.getSnapshot() === payload.sessionId && this.ctx.sidebarRight.isExpanded()) this.ctx.sidebarRight.toggleExpanded();
    if (kind === 'closed') {
      this.pending.delete(payload.tabId);
      this.opening.delete(payload.tabId);
      const bindings = this.state.getSnapshot().bindings;
      if (this.ctx.sidebarRight.mounted.getSnapshot() === payload.sessionId) {
        const uiId = Object.keys(bindings).find(id => bindings[id] === payload.tabId);
        if (uiId) this.ctx.sidebarRight.close(uiId);
      }
      this.state.update(draft => { for (const [id, nativeId] of Object.entries(draft.bindings)) if (nativeId === payload.tabId) delete draft.bindings[id]; });
    }
  }
  reveal(sessionId, nativeId) {
    if (this.ctx.sidebarRight.mounted.getSnapshot() !== sessionId) return;
    this.pending.delete(nativeId);
    const inventory = this.ctx.sidebarRight.openTabs.getSnapshot();
    const existing = Object.entries(this.state.getSnapshot().bindings).find(([uiId, id]) => id === nativeId && inventory.some(tab => tab.tabId === uiId && tab.sessionId === sessionId));
    if (existing) { this.ctx.sidebarRight.focus(existing[0]); if (!this.ctx.sidebarRight.isExpanded()) this.ctx.sidebarRight.toggleExpanded(); return; }
    if (this.opening.has(nativeId)) return;
    this.opening.add(nativeId);
    this.ctx.sidebarRight.openTab('browser', { params: { nativeId } });
  }
  mount(value) {
    this.anchors.set(value.uiId, { element: value.element, sessionId: value.sessionId });
    let promise = this.mounting.get(value.uiId);
    if (!promise) {
      promise = this.attach(value).catch(error => {
        this.mounting.delete(value.uiId);
        this.listeners.get(value.uiId)?.(); this.listeners.delete(value.uiId);
        this.opening.delete(value.nativeId);
        throw error;
      });
      this.mounting.set(value.uiId, promise);
    }
    return promise;
  }
  async attach({ uiId, sessionId, nativeId, initialUrl, element, signal, save }) {
    this.anchors.set(uiId, { element, sessionId });
    let id = nativeId;
    await this.refresh();
    if (signal.aborted || this.disposed) return;
    if (!id || !this.state.getSnapshot().tabs.some(row => row.id === id)) id = (await this.request('humanOpen', { sessionId, url: initialUrl, reveal: false })).tabId;
    const close = () => {
      this.mounting.delete(uiId);
      this.listeners.delete(uiId);
      this.opening.delete(id);
      if (!this.disposed && !this.ctx.sidebarRight.openTabs.getSnapshot().some(tab => tab.tabId === uiId && tab.sessionId === sessionId)) {
        this.state.update(draft => { delete draft.bindings[uiId]; });
        void this.request('close', { sessionId, tabId: id }).catch(error => this.fail(error));
      }
    };
    if (signal.aborted || this.disposed) { close(); return; }
    save(id);
    this.state.update(draft => { draft.bindings[uiId] = id; });
    this.opening.delete(id);
    signal.addEventListener('abort', close, { once: true });
    this.listeners.set(uiId, () => signal.removeEventListener('abort', close));
    if (this.state.getSnapshot().tabs.find(row => row.id === id)?.suspended) await this.request('ensure', { sessionId, tabId: id });
    return () => {};
  }
  unmount(uiId) { this.anchors.delete(uiId); }
  anchor(nativeId) {
    const bindings = this.state.getSnapshot().bindings;
    for (const [uiId, anchor] of this.anchors) if (bindings[uiId] === nativeId && this.ctx.sidebarRight.mounted.getSnapshot() === anchor.sessionId
      && anchor.element?.isConnected && anchor.element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) return anchor.element;
  }
  async request(op, payload = {}) {
    if (!this.carrier) throw new Error('The desktop browser bridge is unavailable');
    const result = await this.carrier.request(op, payload);
    if (result?.ok === false) throw new Error(result.error?.message ?? 'Browser operation failed');
    if (!this.disposed) this.state.update(draft => { draft.error = null; });
    return result;
  }
  dispose() {
    this.disposed = true; this.stop?.(); this.stopSession();
    for (const stop of this.listeners.values()) stop();
    this.listeners.clear(); this.anchors.clear(); this.mounting.clear(); this.pending.clear(); this.opening.clear();
  }
}
