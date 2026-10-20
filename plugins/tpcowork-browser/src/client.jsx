import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { defineStore } from '@deepseek-ai/dsh-client-store';
import { BrowserClient } from './client-controller.js';
import { BrowserTool } from './tool-card.jsx';
import { Guest } from './guest.jsx';
import { zh, en } from './locales.js';
import styles from './styles.css';

const ID = '@tpcowork/dsh-browser';
const NS = 'tpcoworkBrowser';
export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'];

function ToolButton({ label, children, ...props }) { return <button type="button" className="tpcb-tool" title={label} aria-label={label} {...props}>{children}</button>; }


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
    <label><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />{t('remember')}</label><div><button onClick={() => answer(false)}>{t('deny')}</button><button onClick={() => answer(true)}>{t('allow')}</button></div></section>;
}

function BrowserBody(props) {
  const { useTabInfo, useBrowser, useStore, mount, unmount, request, fail, actions, t, sessionId } = props;
  const { tab } = useTabInfo();
  const state = useBrowser(value => value);
  const savedId = useStore(value => value.byTab[tab.id]);
  const nativeId = state.bindings[tab.id] ?? savedId ?? tab.navigation.params?.nativeId;
  const row = state.tabs.find(row => row.id === nativeId);
  const anchor = useRef();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [responsive, setResponsive] = useState(false);
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(720);
  const [zoom, setZoom] = useState('fit');
  const [recording, setRecording] = useState(null);
  const [duration, setDuration] = useState(10);
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
  const submit = event => {
    event.preventDefault();
    const url = draft.includes('://') ? draft : `https://${draft}`;
    setEditing(false); invoke(command('navigate', { url }));
  };
  useEffect(() => { if (nativeId && row?.ready) void request('presentation', { sessionId, tabId: nativeId, visible: tab.visible }).catch(fail); }, [nativeId, row?.ready, tab.visible, sessionId]);
  const busy = state.operations[nativeId] || state.operations[sessionId];
  return <div className="tpcb-browser" data-tpcowork-browser={nativeId ?? ''}>
    <form className="tpcb-toolbar" onSubmit={submit}>
      <ToolButton label={t('back')} disabled={!row?.canGoBack} onClick={() => invoke(command('back'))}>‹</ToolButton>
      <ToolButton label={t('forward')} disabled={!row?.canGoForward} onClick={() => invoke(command('forward'))}>›</ToolButton>
      <ToolButton label={t('reload')} disabled={!row?.ready} onClick={() => invoke(command('reload'))}>↻</ToolButton>
      <input aria-label={t('address')} placeholder={t('address')} value={editing ? draft : row?.url?.startsWith('about:blank') ? '' : row?.url ?? ''} onFocus={() => { setDraft(row?.url?.startsWith('http') ? row.url : ''); setEditing(true); }} onChange={event => setDraft(event.target.value)} spellCheck={false} />
      <button type="submit" className="tpcb-tool" title={t('go')} aria-label={t('go')}>↵</button>
      <ToolButton label={t('newTab')} onClick={() => invoke(run('humanOpen'))}>＋</ToolButton>
      <ToolButton label={t('external')} disabled={!row?.url?.startsWith('http')} onClick={() => invoke(run('external', { url: row.url }))}>↗</ToolButton>
    </form>
    {state.tabs.filter(item => item.sessionId === sessionId).length > 1 && <select aria-label={t('tabs')} value={nativeId ?? ''} onChange={event => props.reveal(sessionId, event.target.value)}>{state.tabs.filter(item => item.sessionId === sessionId).map(item => <option key={item.id} value={item.id}>{item.title || item.url || t('title')}</option>)}</select>}
    <div className="tpcb-status"><span className={busy ? 'tpcb-busy' : ''}>{row?.paused ? t('manual') : busy ? t('automation') : t('ready')}</span>
      <button onClick={() => invoke(run(row?.paused ? 'resume' : 'pause'))}>{t(row?.paused ? 'resume' : 'takeover')}</button>
      <ToolButton label={t('responsive')} onClick={() => setResponsive(!responsive)}>▣</ToolButton>
      <ToolButton label={t('screenshot')} disabled={!row?.ready} onClick={() => invoke(run('saveScreenshot'))}>▧</ToolButton>
      <ToolButton label={t('record')} onClick={() => invoke(command('recordingStart', { options: { fps: 25, maxDurationMs: Math.min(90000, duration * 1000 + 2000), actions: [{ type: 'wait', durationMs: duration * 1000 }] } }).then(result => setRecording(result.recording)))}>●</ToolButton>
      <input className="tpcb-duration" type="number" min="1" max="85" value={duration} aria-label={t('recordSeconds')} onChange={event => setDuration(Number(event.target.value))} />
    </div>
    {responsive && <div className="tpcb-viewport-controls"><label>{t('width')}<input type="number" min="320" max="3840" value={width} onChange={event => setWidth(Number(event.target.value))} /></label><span>×</span><label>{t('height')}<input type="number" min="320" max="2160" value={height} onChange={event => setHeight(Number(event.target.value))} /></label>
      <button onClick={() => invoke(command('browserViewportSet', { width, height }))}>{t('apply')}</button><button onClick={() => invoke(command('browserViewportReset'))}>{t('normal')}</button>
      <select aria-label={t('fit')} value={zoom} onChange={event => setZoom(event.target.value)}>{['fit', '50', '75', '100', '125', '150', '200'].map(value => <option key={value} value={value}>{value === 'fit' ? t('fit') : value + '%'}</option>)}</select></div>}
    {(error || row?.error || state.error) && <div className="tpcb-error" role="alert">{error || row?.error || state.error}</div>}
    {recording && <div className="tpcb-recording" role="status">{recording.status === 'completed' ? t('recordReady') : recording.status === 'running' ? t('recording') : recording.error ?? t('cancelled')}{recording.status === 'running' && <button onClick={() => invoke(command('recordingCancel', { recordingId: recording.id }).then(result => setRecording(result.recording)))}>{t('stopRecord')}</button>}{recording.artifact && <button onClick={() => invoke(run('saveRecording', { recordingId: recording.id }))}>{t('save')}</button>}</div>}
    <div className="tpcb-viewport" ref={anchor} data-browser-zoom={zoom}>
      {!state.enabled ? <p>{t('unavailable')}</p> : row?.suspended ? <button onClick={() => invoke(run('ensure'))}>{t('restore')}</button> : !row?.url || row.url.startsWith('about:blank') ? <p>{t('empty')}</p> : null}
    </div>
  </div>;
}

function BrowserTitle({ useTabInfo, useBrowser, useStore, t }) {
  const { tab } = useTabInfo(); const state = useBrowser(value => value);
  const saved = useStore(value => value.byTab[tab.id]);
  const id = state.bindings[tab.id] ?? saved ?? tab.navigation.params?.nativeId;
  return <span>{state.tabs.find(row => row.id === id)?.title || t('title')}</span>;
}

function Settings({ useBrowser, request, t }) {
  const state = useBrowser(value => value); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [confirm, setConfirm] = useState(false);
  const run = async (op, payload) => { setBusy(true); setMessage(''); try { const result = await request(op, payload); setMessage(op === 'importChrome' ? result.success ? t(result.issues?.length ? 'importPartial' : 'imported') : t(result.error === 'chrome_cookie_access_denied' ? 'importDenied' : 'importUnavailable') : t('done')); } catch (error) { setMessage(`${t('error')}: ${error.message}`); } finally { setBusy(false); } };
  return <section className="tpcb-settings"><h2>{t('settings')}</h2><p>{t('settingsIntro')}</p>
    {!state.enabled && <p role="alert">{t('unavailable')}</p>}
    <div className="tpcb-settings-card"><strong>{t('import')}</strong><p>{t('importHelp')}</p><button disabled={busy || !state.enabled} onClick={() => { void run('importChrome'); }}>{t('import')}</button></div>
    <div className="tpcb-settings-card"><button disabled={busy || !state.enabled} onClick={() => { void run('clearData', { mode: 'cache' }); }}>{t('clearCache')}</button><button disabled={busy || !state.enabled} onClick={() => setConfirm(true)}>{t('clearAll')}</button>
      {confirm && <div role="alertdialog" aria-label={t('clearAll')}><p>{t('clearConfirm')}</p><button onClick={() => setConfirm(false)}>{t('cancel')}</button><button disabled={busy} onClick={() => { setConfirm(false); void run('clearData', { mode: 'all', confirmed: true }); }}>{t('confirm')}</button></div>}</div>
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
  const store = defineStore({ init: () => ({ byTab: {} }), persist: 'tpcowork.browser-tabs.v1', actions: { bind(draft, tab, nativeId) { draft.byTab[tab] = nativeId; } } });
  const injected = { hooks: { browser: client.state }, request: (op, payload) => client.request(op, payload), fail: error => client.fail(error),
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
