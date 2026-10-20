import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zh, en, pluginMeta } from './src/locales.js';
const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && (!process.argv[outputIndex + 1] || process.argv[outputIndex + 1].startsWith('--'))) throw new Error('--output requires a directory');
const output = resolve(root, outputIndex < 0 ? 'lib' : process.argv[outputIndex + 1]);
await mkdir(output, { recursive: true });
const localeOutput = outputIndex < 0 ? resolve(root, 'locale') : join(output, 'locale');
await mkdir(localeOutput, { recursive: true });
for (const [language, ui] of Object.entries({ zh, en })) await writeFile(join(localeOutput, `${language}.json`), JSON.stringify({ meta: pluginMeta[language], ui }, null, 2) + '\n');
const common = { bundle: true, format: 'esm', target: 'node22', platform: 'node', logLevel: 'warning',
  nodePaths: [resolve(root, 'node_modules')],
  external: ['electron', '@deepseek-ai/*'], tsconfigRaw: {},
};
const adaptations = { name: 'reference-adapters', setup(api) {
  api.onResolve({ filter: /^@tpcowork\/shared$/ }, () => ({ path: resolve(root, 'src/reference-shared.ts') }));
  api.onResolve({ filter: /\/logger\.js$/ }, () => ({ path: resolve(root, 'src/reference-logger.js') }));
  api.onResolve({ filter: /\/desktopElectronApp\.js$/ }, () => ({ path: resolve(root, 'src/reference-app.js') }));
  api.onLoad({ filter: /playwrightInjectedScriptSource\.ts$/ }, async ({ path }) => ({ loader: 'ts', contents:
    "import { fileURLToPath } from 'node:url';\n" + (await readFile(path, 'utf8')).replace('const packageJsonPath = runtimeRequire.resolve("playwright-core/package.json");', 'const packageJsonPath = fileURLToPath(new URL("./playwright/package.json", import.meta.url));') }));
  api.onLoad({ filter: /electronBrowserWebmRecorder\.ts$/ }, async ({ path }) => ({ loader: 'ts', contents:
    (await readFile(path, 'utf8')).replace('"../preload/browserVideoRecorder.cjs"', '"./browserVideoRecorder.cjs"') }));
} };
await build({ ...common, entryPoints: [resolve(root, 'src/reference-entry.js')], outfile: join(output, 'reference.js'), banner: { js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);" }, plugins: [adaptations] });
await build({ ...common, entryPoints: [resolve(root, 'src/schema.js')], outfile: join(output, 'schema.js'), plugins: [adaptations] });
for (const name of ['host', 'desktop']) {
  await build({ ...common, entryPoints: [resolve(root, `src/${name}.js`)], outfile: join(output, `${name}.js`), external: [...common.external, './reference.js', './schema.js'] });
}
await build({ ...common, format: 'cjs', entryPoints: [resolve(root, 'vendor/tpcowork/packages/desktop/src/preload/browserVideoRecorder.ts')], outfile: join(output, 'browserVideoRecorder.cjs') });
const client = await build({ bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2022',
  entryPoints: [resolve(root, 'src/client.jsx')], external: ['react', '@deepseek-ai/*'], jsx: 'automatic', loader: { '.css': 'text' }, logLevel: 'warning' });
await writeFile(join(output, 'client.js'), `window.__ModuleLoader__.load({id:'@tpcowork/dsh-browser',factory(require){const module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`);
await cp(resolve(root, 'src/styles.css'), join(output, 'styles.css'));
await mkdir(join(output, 'playwright/lib/generated'), { recursive: true });
await cp(resolve(root, 'vendor/playwright/injectedScriptSource.cjs'), join(output, 'playwright/lib/generated/injectedScriptSource.js'));
await cp(resolve(root, 'vendor/playwright/LICENSE'), join(output, 'playwright/LICENSE'));
await writeFile(join(output, 'playwright/package.json'), '{"name":"playwright-core","version":"1.59.1"}\n');
await mkdir(join(output, 'licenses'), { recursive: true });
for (const name of ['ws', 'zod']) await cp(resolve(root, `node_modules/${name}/LICENSE`), join(output, `licenses/${name}.txt`));
await cp(resolve(root, 'LICENSE'), join(output, 'licenses/tpcowork.txt'));
for (const name of ['NOTICE.md', 'UPSTREAM.md']) await cp(resolve(root, 'vendor', name), join(output, `licenses/tpcowork-${name}`));
if (process.argv.includes('--install-native')) {
  const target = resolve(root, '../../../deepseek-harness/apps/desktop/lib/tpcowork-browser');
  await mkdir(target, { recursive: true });
  for (const name of ['desktop.js', 'reference.js', 'schema.js', 'browserVideoRecorder.cjs', 'playwright', 'licenses']) await cp(join(output, name), join(target, name), { recursive: true });
}
console.log('Built @tpcowork/dsh-browser' + (process.argv.includes('--install-native') ? ' and installed desktop assets' : ''));
