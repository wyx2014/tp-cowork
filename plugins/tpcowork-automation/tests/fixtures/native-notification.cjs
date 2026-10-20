/** Native Electron test window; no permission overrides, user profile or shell IPC changes. */
const { app, BrowserWindow } = require('electron')
app.setPath('userData', process.argv.at(-1))
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1000, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false } })
  await window.loadURL(process.argv.at(-2))
}).catch(error => { console.error(error); app.exit(1) })
setTimeout(() => app.exit(2), process.argv.includes('--native-click') ? 180000 : 60000).unref()
app.on('window-all-closed', () => app.quit())
