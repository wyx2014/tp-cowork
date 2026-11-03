import { readFile, writeFile } from 'node:fs/promises';
import { upstreamCss } from './src/upstream-css.js';
import { upstreamStyles } from './src/upstream-styles.js';

const harness = new URL('../../../deepseek-harness/', import.meta.url);
const stylesheets = {
  sidebar: 'ui-sidebar/src/client/SidebarRoot.module.css',
  leading: 'ui-sidebar/src/client/HeaderLeadingControls.module.css',
  frame: 'ui-layout/src/client/AppFrame.module.css',
  sidebarRight: 'ui-sidebar-right/src/client/shell/SidebarRight.module.css',
  hero: 'ui-conversation/src/client/skeleton/HeroShell.module.css',
  conversation: 'ui-conversation/src/client/skeleton/ConversationRoot.module.css',
  input: 'ui-conversation/src/client/skeleton/InputBar.module.css',
  meter: 'ui-conversation/src/client/skeleton/ContextMeter.module.css',
  chat: 'ui-chat/src/client/chat/MessageItem.module.css',
  plugins: 'ui-plugin-manager/src/client/PluginManagerPage.module.css',
  settings: 'ui-settings-general/src/client/SettingsRoot.module.css',
  general: 'ui-settings-general/src/client/GeneralSection.module.css',
  models: 'ui-settings-models/src/client/ModelsSection.module.css',
  agentPreset: 'ui-agent-preset/src/client/AgentPresetSection.module.css',
  fontGroup: 'ui-theme/src/client/FontSettingsGroup.module.css',
  browser: 'ui-workspace/src/client/rows/WorkspaceBrowser.module.css',
  preferenceRow: 'ui-chat/src/client/settings/PreferenceRow.module.css',
  permissionRow: 'ui-permission-presets/src/client/PermissionRow.module.css',
  languageRow: 'locale/src/client/LanguageRow.module.css',
  developerRow: 'ui-settings-general/src/client/DeveloperToolsRow.module.css',
  enterRow: 'ui-conversation/src/client/settings/EnterBehaviorRow.module.css',
};
const modules = Object.fromEntries(await Promise.all(Object.entries(stylesheets).map(async ([id, path]) => {
  const file = new URL(`packages/client/${path}`, harness);
  const result = await upstreamCss(file);
  return [id, result.classes];
})));
const overlay = upstreamStyles(modules);
const columns = await readFile(new URL('packages/client/ui-layout/src/client/columns.ts', harness), 'utf8');
const defaultMatch = columns.match(/export const SIDEBAR_DEFAULT = (\d+)\b/);
if (defaultMatch === null) throw new Error('TP Cowork: upstream sidebar default is missing');
const defaultSidebarWidth = Number(defaultMatch[1]);

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [source, adapter, navigation, developerMode, modelControls, taskPanel, launcher, account, preferences, notifications, shortcutSettings, modelSettings, appearanceSettings, settingsSidebar, generalSettings, windowZoom, uiFontSize, firstRunGuide, baseCss, themeText, enText, zhText] = await Promise.all([
  read('src/runtime.js'), read('src/layout-adapter.js'), read('src/navigation.js'), read('src/developer-mode.js'), read('src/model-controls.js'), read('src/task-panel.js'), read('src/settings-launcher.js'), read('src/tpcoworkhub-account.js'), read('src/interface-preferences.js'), read('src/notifications.js'), read('src/shortcut-settings.js'), read('src/model-settings.js'), read('src/appearance-settings.js'), read('src/settings-sidebar.js'), read('src/general-settings.js'), read('src/window-zoom.js'), read('src/ui-font-size.js'), read('src/first-run-guide.js'),
  read('styles.css'), read('theme.json'), read('locale/en.json'), read('locale/zh.json'),
]);
const tokens = JSON.parse(themeText);
for (const [name, modes] of Object.entries(tokens)) {
  if (!name.startsWith('--') || typeof modes.light !== 'string' || typeof modes.dark !== 'string') {
    throw new Error(`Theme input ${name} must provide both light and dark values`);
  }
}
const locales = { en: JSON.parse(enText).ui, zh: JSON.parse(zhText).ui };
const brandIcon = `data:image/png;base64,${(await readFile(new URL('icon.png', import.meta.url))).toString('base64')}`;
// The home backdrop is the reference product's skyline, embedded because Client CSS has no asset origin.
const homeArt = async mode => `url("data:image/webp;base64,${(await readFile(new URL(`assets/home-${mode}.webp`, import.meta.url))).toString('base64')}")`;
tokens['--tpcowork-home-art'] = { light: await homeArt('light'), dark: await homeArt('dark') };
// Match upstream artwork rather than row order or translated labels. Keep the
// replacement scoped to settings navigation so other DSH icons stay intact.
const settingsIconSelectors = JSON.parse(await read('src/settings-icon-selectors.json'));
const settingsIconsCss = (await Promise.all(Object.entries(settingsIconSelectors).map(async ([name, match]) => {
  const svg = await read(`assets/settings-icons/${name}.svg`);
  const mask = `url("data:image/svg+xml,${encodeURIComponent(svg.replaceAll('currentColor', 'black'))}")`;
  const unassigned = match.startsWith('[data-tpcowork-nav-icon=') ? '' : ':not([data-tpcowork-nav-icon])';
  const selector = `html body[data-tpcowork-ui] .${modules.settings.navCell} > svg${unassigned}${match}`;
  return `${selector} { background-color: currentColor; mask: ${mask} center / contain no-repeat; }\n${selector} > * { visibility: hidden; }`;
}))).join('\n');
const css = baseCss + '\n' + overlay + '\n' + settingsIconsCss;
const output = `// Generated by build.mjs from plugin resources and the upstream CSS Modules class maps.\nwindow.__ModuleLoader__.load({\n  id: '@tpcowork/dsh-ui',\n  factory(require) {\n${adapter.replace('export function adaptSidebar', 'function adaptSidebar')}\n${navigation.replaceAll('export function ', 'function ')}\n${developerMode.replaceAll('export function ', 'function ')}\n${modelControls.replaceAll('export function ', 'function ')}\n${taskPanel.replace('export function createTaskDock', 'function createTaskDock')}\n${launcher.replace('export function createSettingsLauncher', 'function createSettingsLauncher')}\n${account.replace('export function createTpcoworkHubAccount', 'function createTpcoworkHubAccount')}\n${preferences.replace('export function createInterfacePreferences', 'function createInterfacePreferences')}\n${notifications.replaceAll('export function ', 'function ')}\n${shortcutSettings.replaceAll('export function ', 'function ').replaceAll('export const ', 'const ')}\n${modelSettings.replaceAll('export function ', 'function ')}\n${appearanceSettings.replaceAll('export function ', 'function ')}\n${settingsSidebar.replaceAll('export function ', 'function ')}\n${generalSettings.replaceAll('export function ', 'function ').replaceAll('export const ', 'const ')}\n${windowZoom.replaceAll('export function ', 'function ').replaceAll('export const ', 'const ')}\n${uiFontSize.replaceAll('export function ', 'function ')}\n${firstRunGuide.replaceAll('export function ', 'function ').replaceAll('export const ', 'const ')}\n${source.replace('export function createPlugin', 'function createPlugin')}\n    return createPlugin(require('react'), require('react-dom'), require('@deepseek-ai/dsh-client-ui-primitives'), ${JSON.stringify(tokens)}, ${JSON.stringify(css)}, ${JSON.stringify(locales)}, ${defaultSidebarWidth}, ${JSON.stringify(brandIcon)}, ${JSON.stringify({ sidebar: modules.sidebar, frame: modules.frame, leading: modules.leading, models: modules.models, settings: modules.settings })});\n  },\n});\n`;
const outputs = {
  'upstream.css': overlay,
  'upstream-classes.json': JSON.stringify(modules, null, 2) + '\n',
  'client.js': output,
};
const check = process.argv.includes('--check');
for (const [path, text] of Object.entries(outputs)) {
  if (check) {
    if (await read(path) !== text) throw new Error(`TP Cowork: ${path} is stale; run node build.mjs`);
  } else {
    await writeFile(new URL(path, import.meta.url), text);
  }
}
console.log(`${check ? 'Verified' : 'Built'} @tpcowork/dsh-ui with ${Object.keys(tokens).length} paired theme inputs`);
