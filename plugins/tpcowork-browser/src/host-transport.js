import { randomUUID } from 'node:crypto';
import { BrowserError, CHANNEL, VERSION, envelope } from './protocol.js';

/** Own correlated child-process requests and reject all waiters when the carrier disappears. */
export class DesktopTransport {
  pending = new Map();
  closed = false;
  constructor(carrier = process, timeoutMs = 40000) {
    this.carrier = carrier;
    this.timeoutMs = timeoutMs;
    this.receive = value => {
      if (value?.type !== CHANNEL || value.kind !== 'result') return;
      try { envelope(value); } catch (error) { this.dispose(error); return; }
      const pending = this.pending.get(value.id);
      if (!pending) return;
      if (value.error) pending.reject(new BrowserError(value.error.code, value.error.message));
      else pending.resolve(value.value);
    };
    this.disconnected = () => this.dispose(new BrowserError('disconnected', 'Desktop browser disconnected. Reopen the desktop before continuing.'));
    carrier.on('message', this.receive);
    carrier.on('disconnect', this.disconnected);
  }
  async call(op, payload = {}, signal) {
    if (this.closed || !this.carrier.connected || !this.carrier.send) throw new BrowserError('desktop_required', 'This browser plugin requires the matching DSH desktop bridge.');
    signal?.throwIfAborted();
    const id = randomUUID();
    let timer;
    let abort;
    try {
      return await new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        abort = () => {
          this.send({ type: CHANNEL, version: VERSION, kind: 'cancel', id });
          reject(signal.reason ?? new BrowserError('cancelled', 'Browser operation cancelled; an already delivered action may have completed.'));
        };
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => {
          this.send({ type: CHANNEL, version: VERSION, kind: 'cancel', id });
          reject(new BrowserError('timeout', 'Browser operation timed out. Inspect the page before repeating an action.'));
        }, this.timeoutMs);
        this.send({ type: CHANNEL, version: VERSION, kind: 'request', id, op, payload }, reject);
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      this.pending.delete(id);
    }
  }
  send(message, reject = () => {}) {
    if (!this.carrier.connected) { reject(new BrowserError('disconnected', 'Desktop browser disconnected')); return; }
    try { this.carrier.send(message, error => { if (error) reject(error); }); }
    catch (error) { reject(error); }
  }
  dispose(error = new BrowserError('disposed', 'Browser plugin disabled')) {
    if (this.closed) return;
    this.closed = true;
    this.carrier.off('message', this.receive);
    this.carrier.off('disconnect', this.disconnected);
    for (const [id, pending] of this.pending) {
      this.send({ type: CHANNEL, version: VERSION, kind: 'cancel', id });
      pending.reject(error);
    }
    this.pending.clear();
  }
}
