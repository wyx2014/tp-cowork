import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Guest } from '../../src/guest.jsx';

const anchor = id => window.activeTab === id && document.getElementById('page').checkVisibility() ? document.getElementById('page') : undefined;
const request = (op, payload) => window.browser.request(op, payload);
const fail = error => { document.getElementById('error').textContent = error.message; };
function Runtime() {
  const [tabs, setTabs] = useState([]);
  const [surface, setSurface] = useState(null);
  useEffect(() => {
    const stop = window.browser.subscribe(({ kind, payload }) => {
      if (kind === 'state') { setTabs(payload.tabs); window.activeTab ??= payload.tabs.find(row => row.active)?.id; }
      if (kind === 'activate' && payload.visible) window.activeTab = payload.tabId;
      if (kind === 'surface') setSurface(payload);
      if (kind === 'surfaceReleased') setSurface(current => current?.requestId === payload.requestId ? null : current);
    });
    void request('snapshot').then(value => { setTabs(value.tabs); window.activeTab ??= value.tabs.find(row => row.active)?.id ?? value.tabs[0]?.id; });
    return stop;
  }, []);
  return tabs.map(row => <Guest key={`${row.id}:${row.lease}`} row={row} surface={surface} anchor={anchor} request={request} fail={fail} />);
}
createRoot(document.getElementById('root')).render(<Runtime />);
