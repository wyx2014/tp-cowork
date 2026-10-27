import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { defineStore } from '@deepseek-ai/dsh-client-store';
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { BrowserClient } from './client-controller.js';
import { BrowserTool } from './tool-card.jsx';
import { Guest } from './guest.jsx';
import { importSummary } from './import-summary.js';
import { ImportPrompt } from './import-prompt.jsx';
import { createImportPromptPreferences, importPromptPending } from './import-preferences.js';
import { useOperationActive, useResizeWarning } from './viewport.jsx';
import { BrowserSurface, BrowserToolbar, DEFAULT_RESPONSIVE_VIEWPORT, MoreMenu, PageState, SiteSettings, ViewportToolbar } from './pane.jsx';
import { Icon } from './icons.jsx';
import { AddressSuggestions, BookmarkMenu, bookmarkFolderName, bookmarkImportMessage, useBookmarkList } from './bookmarks-ui.jsx';
import { flattenBookmarks, searchBookmarks } from './bookmark-search.js';
import { displayBrowserUrl, isCertificateBrowserLoadErrorCode, normalizeBrowserUrl } from '../vendor/tpcowork/packages/ui/src/embeddedBrowserHelpers.ts';
import { zh, en } from './locales.js';
import styles from './styles.css';

const ID = '@tpcowork/dsh-browser';
const NS = 'tpcoworkBrowser';
export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'];



function Runtime({ useBrowser, anchor, request, fail, t }) {
  const state = useBrowser(value => value);
  return <>
    {state.tabs.map(row => <Guest key={`${row.id}:${row.lease ?? 'saved'}`} row={row} surface={state.surface} anchor={anchor} request={request} fail={fail} />)}
    {state.requests.map(entry => <Permission key={entry.id} entry={entry} request={request} t={t} fail={fail} />)}
  </>;
}
function Permission({ entry, request, t, fail }) {
  const [remember, setRemember] = useState(true);
  const answer = allow => { void request('permissionRespond', { id: entry.id, allow, remember }).catch(fail); };
  return <section className="tpcb-permission" role="dialog" aria-label={t('permissionRequest')}><strong>{entry.origin}</strong><p>{t('permissionRequest')}: {entry.permission === 'media' ? t('permissionMedia') : entry.permission}</p>
    <label><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />{t('remember')}</label><div><Button variant="outline" onClick={() => answer(false)}>{t('deny')}</Button><Button variant="primary" onClick={() => answer(true)}>{t('allow')}</Button></div></section>;
}

function BrowserBody(props) {
  const { useTabInfo, useBrowser, useStore, useImportPrompt, decideImportPrompt, mount, unmount, request, fail, actions, t, sessionId } = props;
  const { tab } = useTabInfo();
  const state = useBrowser(value => value);
  const savedId = useStore(value => value.byTab[tab.id]);
  const importChoice = useImportPrompt(value => value);
  const nativeId = state.bindings[tab.id] ?? savedId ?? tab.navigation.params?.nativeId;
  const row = state.tabs.find(row => row.id === nativeId);
  const anchor = useRef();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState('fit');
  const [recording, setRecording] = useState(null);
  // The last free size a person chose, restored when they re-enter responsive mode.
  const freeSize = useRef(DEFAULT_RESPONSIVE_VIEWPORT);
  const surface = useRef();
  // A finished import keeps its card open until the person has read the result.
  const [importOpen, setImportOpen] = useState(false);
  const run = async (op, payload = {}) => {
    setError('');
    try { return await request(op, { sessionId, tabId: nativeId, ...payload }); }
    catch (cause) { setError(cause.message); throw cause; }
  };
  const command = (method, values = {}) => run('command', { command: { method, ...(nativeId ? { tabId: nativeId } : {}), ...values } });
  const invoke = operation => { void operation.catch(() => {}); };
  useLayoutEffect(() => {
    let release;
    let ended = false;
    void mount({ uiId: tab.id, sessionId, nativeId: savedId ?? tab.navigation.params?.nativeId, initialUrl: tab.navigation.params?.url,
      element: anchor.current, signal: tab.signal, save: id => actions.bind(tab.id, id) }).then(dispose => { if (ended) dispose?.(); else release = dispose; }).catch(fail);
    return () => { ended = true; release?.(); unmount(tab.id); };
  }, [tab.id, sessionId]);
  useEffect(() => tab.actions.bindCommands({ refresh: () => invoke(command('reload')) }), [tab.actions, nativeId]);
  useEffect(() => {
    if (!recording || recording.status !== 'running') return;
    const timer = setInterval(() => { void command('recordingStatus', { recordingId: recording.id }).then(result => setRecording(result.recording)).catch(() => {}); }, 1000);
    return () => clearInterval(timer);
  }, [recording?.id, recording?.status, nativeId]);
  // Imported bookmarks: the toolbar menu, and suggestions once the person types in the address.
  const bookmarks = useBookmarkList(request, state.bookmarks?.revision, state.enabled);
  const addressRef = useRef();
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);
  const bookmarkRows = useMemo(() => flattenBookmarks(bookmarks.list?.sources, bookmarkFolderName(t)), [bookmarks.list, t]);
  const matches = editing && typed ? searchBookmarks(bookmarkRows, draft, 6) : [];
  const go = url => { setEditing(false); setTyped(false); addressRef.current?.querySelector('input')?.blur(); invoke(command('navigate', { url })); };
  const addressKeyDown = event => {
    if (event.nativeEvent.isComposing || matches.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(index => event.key === 'ArrowDown' ? (index + 1) % matches.length : (index <= 0 ? matches.length : index) - 1);
    } else if (event.key === 'Enter' && active >= 0 && matches[active]) {
      event.preventDefault();
      go(matches[active].url);
    } else if (event.key === 'Escape') { event.preventDefault(); setTyped(false); }
  };
  const submit = event => {
    event.preventDefault();
    // The reference's address rules: local and port-qualified hosts use HTTP, public names HTTPS.
    const url = normalizeBrowserUrl(draft);
    if (!url || !/^https?:/i.test(url)) { setError(t('invalidAddress')); return; }
    setEditing(false); event.currentTarget.querySelector('input')?.blur(); invoke(command('navigate', { url }));
  };
  useEffect(() => { if (nativeId && row?.ready) void request('presentation', { sessionId, tabId: nativeId, visible: tab.visible }).catch(fail); }, [nativeId, row?.ready, tab.visible, sessionId]);
  const busy = useOperationActive(state, [nativeId, sessionId]);
  const [resizeWarning, resized] = useResizeWarning(busy && tab.visible);
  // As in the reference, a tab with a viewport override is in free-size mode, whoever set it.
  const responsive = Boolean(row?.viewport);
  const viewport = row?.viewport ?? freeSize.current;
  const resize = size => { freeSize.current = size; resized(); invoke(command('browserViewportSet', size)); };
  const toggleResponsive = () => invoke(responsive ? command('browserViewportReset') : command('browserViewportSet', freeSize.current));
  const origin = (() => { try { const value = new URL(row?.url ?? ''); return /^https?:$/.test(value.protocol) ? value.origin : undefined; } catch { return undefined; } })();
  const pages = state.tabs.filter(item => item.sessionId === sessionId);
  const record = seconds => invoke(command('recordingStart', { options: { fps: 25, maxDurationMs: Math.min(90000, seconds * 1000 + 2000), actions: [{ type: 'wait', durationMs: seconds * 1000 }] } }).then(result => setRecording(result.recording)));
  const menu = <MoreMenu t={t} items={[
    { icon: 'ExternalLink', label: t('external'), disabled: !row?.url?.startsWith('http'), onSelect: () => invoke(run('external', { url: row.url })) },
    { icon: 'Bug', label: t('devtools'), disabled: !row?.ready || state.devTools !== true, onSelect: () => invoke(run('devtools')) },
    { separator: true },
    { icon: 'MousePointer2', label: t(row?.paused ? 'resume' : 'takeover'), disabled: !row, onSelect: () => invoke(run(row?.paused ? 'resume' : 'pause')) },
    { label: t('screenshot'), disabled: !row?.ready, onSelect: () => invoke(run('saveScreenshot')) },
    ...[10, 30, 60].map(seconds => ({ label: t('recordFor').replace('{seconds}', String(seconds)), disabled: !row?.ready || recording?.status === 'running', onSelect: () => record(seconds) })),
    { separator: true },
    { label: t('newTab'), onSelect: () => invoke(run('humanOpen')) },
    ...(pages.length > 1 ? pages.filter(item => item.id !== nativeId).map(item => ({ icon: 'Globe', label: item.title || item.url || t('title'), onSelect: () => props.reveal(sessionId, item.id) })) : []),
  ]} />;
  const showImport = state.enabled && tab.visible && (importOpen || importPromptPending(importChoice));
  const importChrome = async () => {
    setImportOpen(true);
    const result = await request('importChrome');
    // Pages already open load the imported sign-ins on their next request.
    if (result.success && row?.url?.startsWith('http')) invoke(command('reload'));
    return result;
  };
  const decideImport = choice => { setImportOpen(false); decideImportPrompt(choice); };
  const blank = !row?.url || row.url.startsWith('about:blank');
  const pageState = !state.enabled ? <PageState kind="unavailable" t={t} />
    : row?.suspended ? <PageState kind="empty" onRetry={() => invoke(run('ensure'))} t={t} />
    : row?.error && row.loadErrorCode ? <PageState kind="error" message={row.error} certificate={isCertificateBrowserLoadErrorCode(row.loadErrorCode)} onRetry={() => invoke(command('reload'))} t={t} />
    : row?.error ? <PageState kind="crashed" message={row.error} t={t} />
    : blank ? <PageState kind={row && !row.ready ? 'starting' : 'empty'} t={t} /> : null;
  return <div className="tpcb-browser" ref={surface} data-tpcowork-browser={nativeId ?? ''}>
    {showImport && <ImportPrompt anchor={surface} onImport={importChrome} onDecide={decideImport} t={t} />}
    <BrowserToolbar row={row} t={t} editing={editing} address={editing ? draft : displayBrowserUrl(row?.url ?? 'about:blank')}
      onAddressChange={value => { setDraft(value); setTyped(true); setActive(-1); }}
      onAddressFocus={() => { setDraft(row?.url?.startsWith('http') ? row.url : ''); setEditing(true); setTyped(false); setActive(-1); bookmarks.want(); }}
      onAddressBlur={() => setEditing(false)} onAddressKeyDown={addressKeyDown} addressRef={addressRef}
      suggestion={matches.length > 0 ? (active >= 0 ? `tpcb-suggestion-${active}` : '') : undefined}
      bookmarks={<BookmarkMenu list={bookmarks.list} enabled={state.enabled} onOpen={bookmarks.want} onNavigate={go}
        onImport={browser => request('importBookmarks', { browser })} t={t} />}
      onSubmit={submit} onBack={() => invoke(command('back'))} onForward={() => invoke(command('forward'))} onReload={() => invoke(command('reload'))}
      responsive={responsive} onToggleResponsive={toggleResponsive} menu={menu}
      siteControl={origin ? <SiteSettings origin={origin} rules={state.permissions?.[origin]} t={t}
        onChange={(permission, decision) => invoke(run('permissionSet', { origin, permission, decision }))} /> : null} />
    {tab.visible && <AddressSuggestions anchor={addressRef} matches={matches} active={active} onPick={go} t={t} />}
    {responsive && <ViewportToolbar viewport={viewport} zoom={zoom} onViewportChange={resize} onZoomChange={setZoom} t={t} />}
    {(error || state.error) && <div className="tpcb-error" role="alert">{error || state.error}</div>}
    {recording && <div className="tpcb-recording" role="status">{recording.status === 'completed' ? t('recordReady') : recording.status === 'running' ? t('recording') : recording.error ?? t('cancelled')}{recording.status === 'running' && <button type="button" onClick={() => invoke(command('recordingCancel', { recordingId: recording.id }).then(result => setRecording(result.recording)))}>{t('stopRecord')}</button>}{recording.artifact && <button type="button" onClick={() => invoke(run('saveRecording', { recordingId: recording.id }))}>{t('save')}</button>}</div>}
    <BrowserSurface anchorRef={anchor} responsive={responsive && !pageState} viewport={viewport} zoom={zoom} onResize={resize} warning={resizeWarning} resized={resized} zoomLabel={t('viewportLabel')} t={t}
      overlay={pageState} hidePage={Boolean(pageState)}
      banner={row?.paused && tab.visible ? <><Icon name="MousePointer2" /><span>{t('manual')}</span><button type="button" onClick={() => invoke(run('resume'))}>{t('resume')}</button></> : null} />
  </div>;
}

/** The page's favicon, or a stable globe when it is missing or fails to load. */
function Favicon({ url }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  // A favicon request carrying the app's Referer is refused by some CDNs; the page's own request had none.
  if (!url || failed) return <Icon name="Globe" size={14} className="tpcb-favicon" />;
  return <img className="tpcb-favicon" src={url} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function BrowserTitle({ useTabInfo, useBrowser, useStore, t }) {
  const { tab } = useTabInfo(); const state = useBrowser(value => value);
  const saved = useStore(value => value.byTab[tab.id]);
  const id = state.bindings[tab.id] ?? saved ?? tab.navigation.params?.nativeId;
  const row = state.tabs.find(item => item.id === id);
  const operating = useOperationActive(state, [id, row?.sessionId]);
  return <span className="tpcb-title">{operating ? <span className="tpcb-operating" role="img" aria-label={t('automation')}><Icon name="MousePointer2" size={14} /></span> : <Favicon url={row?.favicon} />}<span>{row?.title || t('title')}</span></span>;
}


function Settings({ useBrowser, request, t }) {
  const state = useBrowser(value => value); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [confirm, setConfirm] = useState(false);
  const run = async (op, payload) => { setBusy(true); setMessage(''); try { const result = await request(op, payload); setMessage(op === 'importChrome' ? importSummary(result, t) : op === 'importBookmarks' ? bookmarkImportMessage(result, t) : t('done')); } catch (error) { setMessage(`${t('error')}: ${error.message}`); } finally { setBusy(false); } };
  return <section className="tpcb-settings"><h2>{t('settings')}</h2><p>{t('settingsIntro')}</p>
    {!state.enabled && <p role="alert">{t('unavailable')}</p>}
    <div className="tpcb-settings-card"><strong>{t('import')}</strong><p>{t('importHelp')}</p><button disabled={busy || !state.enabled} onClick={() => { void run('importChrome'); }}>{t('import')}</button></div>
    <div className="tpcb-settings-card"><strong>{t('bookmarks')}</strong><p>{t('bookmarksSettingsHelp')}</p>
      {Object.entries(state.bookmarks?.sources ?? {}).map(([browser, source]) => <p key={browser} className="tpcb-hint">
        {t('bookmarksSummary').replace('{browser}', browser === 'edge' ? 'Edge' : 'Chrome').replace('{count}', String(source.count))
          .replace('{time}', new Date(source.importedAt).toLocaleString())}</p>)}
      {['chrome', 'edge'].map(browser => <button key={browser} disabled={busy || !state.enabled} onClick={() => { void run('importBookmarks', { browser }); }}>
        {t(state.bookmarks?.sources?.[browser] ? 'bookmarksReimport' : 'bookmarksImportFrom').replace('{browser}', browser === 'edge' ? 'Edge' : 'Chrome')}</button>)}</div>
    <div className="tpcb-settings-card"><button disabled={busy || !state.enabled} onClick={() => { void run('clearData', { mode: 'cache' }); }}>{t('clearCache')}</button><button disabled={busy || !state.enabled} onClick={() => setConfirm(true)}>{t('clearAll')}</button>
      <Modal open={confirm} className="tp-confirm-dialog" title={t('clearAll')} description={t('clearConfirm')} closeLabel={t('cancel')} showCloseButton={false} onClose={() => setConfirm(false)}
        footer={<><Button variant="outline" data-modal-autofocus onClick={() => setConfirm(false)}>{t('cancel')}</Button><Button variant="primary" className="tp-dialog-danger" disabled={busy} onClick={() => { setConfirm(false); void run('clearData', { mode: 'all', confirmed: true }); }}>{t('confirm')}</Button></>} /></div>
    <h3>{t('security')}</h3>
    <div className="tpcb-settings-card"><label className="tpcb-permission-rule"><span><strong>{t('insecureCertificates')}</strong><br /><span className="tpcb-hint">{t('insecureCertificatesHelp')}</span></span>
      <input type="checkbox" role="switch" aria-label={t('insecureCertificates')} checked={state.security?.allowInsecureCertificates === true} disabled={busy || !state.enabled}
        onChange={event => { void run('security', { allowInsecureCertificates: event.target.checked }); }} /></label>
      {state.security?.restartRequired && <p role="status" className="tpcb-hint">{t('insecureCertificatesRestart')}</p>}</div>
    <div role="status">{busy ? t('busy') : message}</div>
    <h3>{t('permissions')}</h3>{Object.keys(state.permissions).length === 0 && <p>{t('noPermissions')}</p>}
    {Object.entries(state.permissions).map(([origin, rules]) => <div key={origin} className="tpcb-settings-card"><strong>{origin}</strong>{Object.entries(rules).map(([permission, value]) => <label className="tpcb-permission-rule" key={permission}>{permission}<select aria-label={`${origin} ${permission}`} value={value} disabled={busy} onChange={event => { void run('permissionSet', { origin, permission, decision: event.target.value }); }}>{['ask', 'allow', 'deny'].map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label>)}</div>)}
    <h3>{t('downloads')}</h3>{!state.downloads.length && <p>{t('noDownloads')}</p>}{state.downloads.map(file => <div key={file.id} className="tpcb-settings-card"><strong>{file.name}</strong><span> {t(file.status in en ? file.status : 'interrupted')}</span>{file.status === 'completed' && <button onClick={() => { void run('revealDownload', { id: file.id }); }}>{t('reveal')}</button>}</div>)}
  </section>;
}

export function apply(ctx) {
  const client = new BrowserClient(ctx, globalThis.dshDesktop?.browserAutomation);
  ctx.effect(() => () => client.dispose(), 'tpcowork-browser: client');
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'tpcowork-browser: copy');
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = ID; style.textContent = styles; document.head.appendChild(style); return () => style.remove(); }, 'tpcowork-browser: styles');
  const store = defineStore({ init: () => ({ byTab: {} }), persist: 'tpcowork.browser-tabs.v1', actions: {
    bind(draft, tab, nativeId) { draft.byTab[tab] = nativeId; },
  } });
  const importPrompt = createImportPromptPreferences();
  const request = async (op, payload) => {
    const result = await client.request(op, payload);
    if (op === 'importChrome' && result.success === true) importPrompt.decide({ choice: 'imported' });
    return result;
  };
  const injected = { hooks: { browser: client.state, importPrompt: importPrompt.state }, decideImportPrompt: importPrompt.decide,
    request, fail: error => client.fail(error),
    reveal: (sessionId, nativeId) => client.reveal(sessionId, nativeId), anchor: id => client.anchor(id), mount: value => client.mount(value), unmount: id => client.unmount(id) };
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: ID, kind: 'browser', priority: 'extension', multiple: true, keepMounted: true,
    title: () => t('title'), guide: [{ id: 'new', order: 30, title: () => t('title'), description: () => t('description'), icon: () => <span>◎</span> }] }), 'tpcowork-browser: tab');
  for (const [name, component, extra] of [
    ['sidebar.right.pane.tab', BrowserBody, { key: ID, store }], ['sidebar.right.pane.tab.title', BrowserTitle, { key: ID, store }],
    ['shell.overlay', Runtime, { id: ID }], ['settings.section', Settings, { id: ID, order: 45, label: () => t('settings') }],
  ]) ctx.slots.inject(name, () => ctx.slots.register({ name, ...extra, locale: NS, inject: () => injected }, component));
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of ['browser_tabs', 'browser_navigate', 'browser_snapshot', 'browser_act', 'browser_screenshot', 'browser_dialog', 'browser_download', 'browser_viewport', 'browser_recording']) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key, locale: NS, inject: () => injected }, BrowserTool);
    }
  });
  void client.refresh().catch(error => client.fail(error));
}

// The native visual harness renders these with the real desktop adapter.
export { BrowserBody, BrowserTitle, Runtime };
