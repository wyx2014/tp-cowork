import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserBody, BrowserTitle, Runtime } from '../../src/client.jsx';
import { en } from '../../src/locales.js';
import styles from '../../src/styles.css';

// A minimal stand-in for the DSH client services, around the real desktop adapter.
const style = document.createElement('style'); style.textContent = styles; document.head.appendChild(style);
let state = { enabled: false, tabs: [], downloads: [], permissions: {}, requests: [], bindings: {}, operations: {}, operationUntil: {}, surface: null, error: null };
const listeners = new Set();
const update = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
const useBrowser = select => select(useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state));
const request = (op, payload) => window.browser.request(op, payload);
window.browser.subscribe(({ kind, payload }) => {
  if (kind === 'state') update(payload);
  if (kind === 'surface') update({ surface: payload });
  if (kind === 'surfaceReleased') update({ surface: null });
  if (kind === 'operation') update({ operations: { ...state.operations, [payload.tabId ?? payload.sessionId]: payload.active } });
});
void request('snapshot', { sessionId: 'visual' }).then(update);
const anchors = new Map();
const t = key => en[key] ?? key;
const anchor = id => { const element = anchors.get(id); return element?.isConnected ? element : undefined; };
const fail = error => console.error(error);

function App() {
  const nativeId = useBrowser(value => value.tabs.find(row => row.sessionId === 'visual')?.id);
  if (!nativeId) return null;
  const tab = { id: 'ui', visible: true, signal: new AbortController().signal, navigation: { params: { nativeId } }, actions: { bindCommands: () => () => {} } };
  // The first-use import offer appears only in captures that ask for it.
  const stored = { byTab: {}, importPrompt: PANE_IMPORT ? undefined : { choice: 'dismissed' } };
  const props = { useTabInfo: () => ({ tab }), useBrowser, useStore: select => select(stored), request, fail, t, sessionId: 'visual',
    actions: { bind: () => {}, importPrompt: () => {} }, reveal: () => {}, mount: async value => { anchors.set(nativeId, value.element); return () => {}; }, unmount: () => {} };
  return <BrowserBody {...props} />;
}
function Title() {
  const nativeId = useBrowser(value => value.tabs.find(row => row.sessionId === 'visual')?.id);
  return nativeId ? <BrowserTitle useTabInfo={() => ({ tab: { id: 'ui', navigation: { params: { nativeId } } } })} useBrowser={useBrowser} useStore={select => select({ byTab: {} })} t={t} /> : null;
}
createRoot(document.getElementById('pane')).render(<App />);
createRoot(document.getElementById('tab-title')).render(<Title />);
createRoot(document.getElementById('overlay')).render(<Runtime useBrowser={useBrowser} anchor={anchor} request={request} fail={fail} t={t} />);
