/** Preserve errors without emitting page contents or browser credentials. */
export const logger = {
  debug() {}, info() {},
  warn(message) { console.warn('[tpcowork-browser]', message); },
  error(message) { console.error('[tpcowork-browser]', message); },
};
