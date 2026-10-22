import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The reference desktop's in-app browser descriptor; tabs, CUA, screenshots and dialogs are core API. */
export const IAB_DESCRIPTOR = {
  id: 'tpcowork-dsh-iab', generation: 1, type: 'iab', name: 'TP Cowork In-app Browser',
  capabilities: {
    browser: [{ id: 'visibility', description: "Use to show or hide the browser to the user, and to determine the browser's current visibility. Keep browser work in the background unless the user asks to see it or live viewing is useful. When the browser should be visible, call set(true)." }],
    tab: [],
  },
  apiSupportOverrides: { 'BrowserUser.claimTab': true, 'Tabs.finalize': true, 'Tab.markDeliverable': true, 'Tab.markHandoff': true,
    'BrowserRecordingAPI.start': true, 'BrowserRecordingAPI.status': true, 'BrowserRecordingAPI.cancel': true },
  metadata: { provider: 'tpcowork-dsh-desktop' },
};

/** The reference CLI's managed headless descriptor; unsupported members are removed from the SDK. */
export const CDP_DESCRIPTOR = {
  id: 'tpcowork-dsh-cdp', generation: 1, type: 'cdp', name: 'TP Cowork Headless Chromium',
  capabilities: { browser: [], tab: [] },
  apiSupportOverrides: { 'BrowserUser.openTabs': false, 'BrowserUser.history': false, 'PlaywrightAPI.waitForEvent': false,
    'PlaywrightDownload.path': false, 'PlaywrightFileChooser.setFiles': false, 'PlaywrightLocator.downloadMedia': false,
    'PlaywrightLocator.evaluate': false, 'CUAAPI.downloadMedia': false, 'DomCUAAPI.downloadMedia': false },
  metadata: { provider: 'tpcowork-dsh-headless', launchMode: 'managed', headless: 'true' },
};

const MODULE = new URL('./browser-client.mjs', import.meta.url);
// Built output carries its docs; a source checkout reads them from the plugin root.
const DOCS = [new URL('./sdk-docs/', import.meta.url), new URL('../sdk-docs/', import.meta.url)].find(url => existsSync(url)) ?? new URL('./sdk-docs/', import.meta.url);

/** The SDK ships only in the built plugin; source checkouts and tests without a build have none. */
export function sdkAvailable() { return existsSync(MODULE) && existsSync(DOCS); }

/**
 * Copy the SDK where a run_code program can import it. Packaged plugins live in app.asar, which a
 * program's ESM loader cannot read. The copy goes into a fresh owner-only directory, so another local
 * user cannot plant a module at a predictable shared-temp path. Returns the module URL and a remover.
 */
export async function materializeSdk(descriptor, root = tmpdir()) {
  const directory = await mkdtemp(join(root, 'tpcowork-browser-sdk-'));
  try {
    await mkdir(join(directory, 'docs'));
    await writeFile(join(directory, 'descriptor.json'), JSON.stringify(descriptor, null, 2) + '\n');
    // Written from read bytes: asar-backed sources support reads, not every copy API.
    for (const name of (await readdir(DOCS)).sort()) await writeFile(join(directory, 'docs', name), await readFile(new URL(name, DOCS)));
    await writeFile(join(directory, 'browser-client.mjs'), await readFile(MODULE));
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  return { url: pathToFileURL(join(directory, 'browser-client.mjs')).href, remove: () => rm(directory, { recursive: true, force: true }) };
}
