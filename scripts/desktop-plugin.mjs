import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const harness = resolve(workspace, '../deepseek-harness');
const desktopHome = process.env.DSH_HOME ?? resolve(harness, 'apps/desktop/.desktop-build/development/home');
const operation = process.argv[2];
const target = process.argv[3] ?? 'base';
const plugins = {
  core: ['tpcowork-core', '@tpcowork/dsh-core'],
  ui: ['tpcowork-ui', '@tpcowork/dsh-ui'],
  workbench: ['tpcowork-workbench', '@tpcowork/dsh-workbench'],
  browser: ['tpcowork-browser', '@tpcowork/dsh-browser'],
  toolbox: ['tpcowork-toolbox', '@tpcowork/dsh-toolbox'],
  automation: ['tpcowork-automation', '@tpcowork/dsh-automation'],
};
const expertsPackage = resolve(workspace, 'plugins/tpcowork-experts/package.json');
const optionalPlugins = existsSync(expertsPackage)
  ? { experts: ['tpcowork-experts', JSON.parse(readFileSync(expertsPackage, 'utf8')).name] } : {};
if (target === 'experts' && !optionalPlugins.experts) {
  throw new Error('Experts is not included in this release; integrate the T6 package before installing it.');
}
Object.assign(plugins, optionalPlugins);
if (!Object.hasOwn(plugins, target) && target !== 'base' && target !== 'all') {
  throw new Error('Plugin must be core, ui, workbench, browser, toolbox, automation, experts (when delivered), base (core + ui), or all');
}
if (!['install', 'remove', 'list'].includes(operation)) {
  throw new Error('Usage: node scripts/desktop-plugin.mjs install|remove|list [base|core|ui|workbench|browser|toolbox|automation|experts|all] (default: base)');
}
if (!existsSync(resolve(desktopHome, 'profiles/desktop/package.json'))) {
  throw new Error('Start Desktop once to initialize its profile, then quit it before managing plugins.');
}
const { developmentRuntimeDirectory } = await import(pathToFileURL(resolve(harness, 'apps/desktop/scripts/desktop-build-paths.mjs')));
const { runDesktopCli } = await import(pathToFileURL(resolve(harness, 'apps/desktop-host/lib/cli.js')));
const selected = target === 'all' ? Object.values(plugins)
  : target === 'base' ? [plugins.core, plugins.ui] : [plugins[target]];
if (operation === 'install' && selected.some(([directory]) => directory === 'tpcowork-toolbox')
  && !existsSync(resolve(workspace, 'plugins/tpcowork-toolbox/lib/host.js'))) {
  throw new Error('Build the toolbox first: node scripts/build-toolbox.mjs --install --smoke');
}
if (operation === 'install' && selected.some(([directory]) => directory === 'tpcowork-automation')
  && !existsSync(resolve(workspace, 'plugins/tpcowork-automation/lib/host.js'))) {
  throw new Error('Build automation first: node plugins/tpcowork-automation/build.mjs');
}
if (operation === 'install' && selected.some(([directory]) => directory === 'tpcowork-browser')
  && !existsSync(resolve(harness, 'apps/desktop/lib/tpcowork-browser/desktop.js'))) {
  throw new Error('Build the browser and desktop bridge first: node scripts/build-browser.mjs');
}
const args = operation === 'install'
  ? ['add', ...selected.map(([directory]) => `link:${resolve(workspace, 'plugins', directory)}`), '--offline']
  : operation === 'remove' ? ['remove', ...selected.map(([, name]) => name)] : ['list'];
process.env.DSH_HOME = desktopHome;
process.env.pnpm_config_verify_deps_before_run = 'false';
process.env.pnpm_config_offline = 'true';
process.argv = [process.execPath, 'dsh', 'plugin', '--profile', 'desktop', ...args];
await runDesktopCli(resolve(harness, 'apps/desktop/.desktop-build/development/project'), dirname(developmentRuntimeDirectory()));
