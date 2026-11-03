/** Only page addresses belong in the browser chrome; bootstrap URLs stay private. */
export function browserAddress(row) {
  return [row?.pendingUrl, row?.initialUrl, row?.url].find(url => typeof url === 'string' && /^https?:\/\//iu.test(url)) ?? '';
}

export function beginBrowserNavigation(row, url) {
  Object.assign(row, { pendingUrl: url, loading: true, error: undefined, loadErrorCode: undefined });
}

/** Track the requested address separately until the main frame commits its document. */
export function trackBrowserNavigation(row, guest, allowedUrl, publish) {
  const update = () => {
    if (guest.isDestroyed()) return;
    const url = guest.getURL();
    if (!row.pendingUrl && allowedUrl(url)) Object.assign(row, { url, title: guest.getTitle() });
    Object.assign(row, { canGoBack: guest.navigationHistory.canGoBack(), canGoForward: guest.navigationHistory.canGoForward() });
    publish();
  };
  const start = (_event, url, _inPlace, main) => {
    if (!main || !allowedUrl(url)) return;
    beginBrowserNavigation(row, url);
    publish();
  };
  const commit = (url) => {
    if (!allowedUrl(url)) return;
    Object.assign(row, { url, pendingUrl: undefined, error: undefined, loadErrorCode: undefined, loading: guest.isLoading() });
    update();
  };
  guest.on('did-start-navigation', start);
  guest.on('did-redirect-navigation', start);
  guest.on('did-navigate', (_event, url) => commit(url));
  guest.on('did-navigate-in-page', (_event, url, main) => { if (main) commit(url); });
  guest.on('page-title-updated', update);
  guest.on('did-start-loading', () => { if (!row.error) row.loading = true; update(); });
  guest.on('did-stop-loading', () => { row.loading = false; update(); });
  guest.on('did-fail-load', (_event, code, message, url, main) => {
    if (!main || code === -3) return;
    if (allowedUrl(url)) row.pendingUrl = url;
    Object.assign(row, { error: message, loadErrorCode: code, loading: false });
    publish();
  });
  update();
}
