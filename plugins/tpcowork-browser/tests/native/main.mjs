import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
const { createDesktopBrowser } = await import(new URL((process.env.BROWSER_TEST_LIB ?? '../../lib') + '/desktop.js', import.meta.url));
import { DesktopBrowserGuests } from '../../../../../deepseek-harness/apps/desktop/lib/types/browser-guests.js';
import { importFixture } from './chrome-fixture.mjs';

app.setPath('userData', process.env.BROWSER_TEST_HOME);
app.whenReady().then(async () => {
const window = new BrowserWindow({ width: Number(process.env.BROWSER_TEST_WIDTH ?? 1200), height: Number(process.env.BROWSER_TEST_HEIGHT ?? 900), show: true, webPreferences: {
  preload: fileURLToPath(new URL('preload.cjs', import.meta.url)), contextIsolation: true, sandbox: true, webviewTag: true,
} });
const browser = createDesktopBrowser({ userData: app.getPath('userData'), window: () => window, hostUrl: () => 'http://127.0.0.1:1' });
new DesktopBrowserGuests(() => 'http://127.0.0.1:1', browser).bind(window, () => () => {});
ipcMain.handle('test:browser', (event, op, payload) => {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Forbidden');
  return browser.request(op, payload);
});
globalThis.testBrowser = browser;
globalThis.testWindow = window;
globalThis.testChromeImport = () => importFixture(app.getPath('userData'),browser.browserSession);
await browser.enable();
await window.loadFile(fileURLToPath(new URL(process.env.BROWSER_TEST_PAGE ?? 'index.html', import.meta.url)));

}).catch(error => { console.error(error); app.exit(1); });
