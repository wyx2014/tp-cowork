/** The private IPC generation is shared by the plugin and the desktop adapter. */
export const VERSION = 1;
export const CHANNEL = 'tpcowork-browser';
export const PARTITION = 'persist:tpcowork-dsh-browser';
export const PLUGIN = '@tpcowork/dsh-browser';
export const IPC = { request: 'tpcowork-browser:request', event: 'tpcowork-browser:event' };

export class BrowserError extends Error {
  constructor(code, message, options) { super(message, options); this.name = 'BrowserError'; this.code = code; }
}

/** Validate the envelope before dispatch; individual operations validate their payload. */
export function envelope(value) {
  if (!value || typeof value !== 'object' || value.type !== CHANNEL || value.version !== VERSION
    || typeof value.id !== 'string' || value.id.length > 128
    || !['request', 'result', 'cancel', 'event'].includes(value.kind)) {
    throw new BrowserError('protocol', 'Incompatible desktop browser bridge. Rebuild the desktop and browser plugin together.');
  }
  return value;
}

export function failure(error) {
  return { code: error?.code ?? 'execution_error', message: error instanceof Error ? error.message : String(error) };
}

/** Serialize a page's mutations without leaving a failed operation in the queue. */
export class OperationQueue {
  entries = new Map();
  run(key, signal, operation) {
    const previous = this.entries.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(() => { signal?.throwIfAborted(); return operation(); });
    this.entries.set(key, current);
    const clear = () => { if (this.entries.get(key) === current) this.entries.delete(key); };
    void current.then(clear, clear);
    return current;
  }
  async drain() { await Promise.allSettled([...this.entries.values()]); }
}
