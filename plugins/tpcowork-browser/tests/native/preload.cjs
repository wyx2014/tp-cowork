const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('browser', {
  request: (op, payload) => ipcRenderer.invoke('test:browser', op, payload),
  subscribe: fn => { const receive = (_event, value) => fn(value); ipcRenderer.on('tpcowork-browser:event', receive); return () => ipcRenderer.removeListener('tpcowork-browser:event', receive); },
});
