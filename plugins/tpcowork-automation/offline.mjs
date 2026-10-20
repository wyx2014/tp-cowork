/** Offline kit entry: verify, manage the initialized Desktop profile, or run the ordinary Electron carrier. */
import { createHash } from 'node:crypto';
import { access, readFile, realpath, readlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const root = dirname(fileURLToPath(import.meta.url));
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  home: { type: 'string' },
} });
const operation = positionals[0];
if (!['verify', 'install', 'remove', 'list', 'launch', 'dump-config'].includes(operation)) {
  throw new Error('Usage: ./node offline.mjs verify|install|remove|list|launch|dump-config --home <DSH_HOME>');
}
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 1 || manifest.platform !== process.platform || manifest.arch !== process.arch) {
  throw new Error('This offline kit does not match this operating system and CPU architecture.');
}
if ((await readFile(join(root, '.building'), 'utf8')).trim() !== 'complete') throw new Error('Offline package is incomplete.');
for (const file of manifest.files) {
  const path = resolve(root, file.path);
  if (!path.startsWith(root + sep) || !(await realpath(path)).startsWith(root + sep)) throw new Error('Offline package contains an escaping path.');
  const bytes = await readFile(path);
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Offline integrity check failed: ${file.path}`);
}
for (const link of manifest.links) {
  const path = resolve(root, link.path);
  if (!path.startsWith(root + sep) || !(await realpath(path)).startsWith(root + sep) || await readlink(path) !== link.target) {
    throw new Error(`Offline link integrity check failed: ${link.path}`);
  }
}
if (operation === 'verify') {
  console.log(JSON.stringify({ verified: true, packages: manifest.packages.length, files: manifest.files.length, platform: manifest.platform, arch: manifest.arch }));
} else {
  if (!values.home) throw new Error('An explicit --home is required; existing user profiles are never selected implicitly.');
  const home = resolve(values.home);
  const runtime = join(root, 'runtime');
  const requireRuntime = createRequire(join(runtime, 'package.json'));
  const desktopDir = dirname(requireRuntime.resolve('@deepseek-ai/dsh-desktop/package.json'));
  const automationDir = dirname(requireRuntime.resolve('@tpcowork/dsh-automation/package.json'));
  process.env.DSH_HOME = home;
  process.env.pnpm_config_offline = 'true';
  process.env.pnpm_config_ignore_scripts = 'true';
  process.env.pnpm_config_verify_deps_before_run = 'false';
  if (operation === 'launch') {
    const electron = requireRuntime('electron');
    const child = spawn(electron, [desktopDir, `--user-data-dir=${join(home, 'automation-electron')}`], {
      stdio: 'inherit', env: { ...process.env,
        DSH_DESKTOP_DSH_DIR: runtime,
        DSH_DESKTOP_PNPM_ENTRY: join(runtime, 'node_modules/pnpm/bin/pnpm.mjs'),
        DSH_DESKTOP_PRIMARY_RUNTIME_DIR: join(root, 'support/primary-runtime'),
        DSH_DESKTOP_OPEN_DEVTOOLS: '0',
      },
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    await new Promise((done, reject) => { child.once('error', reject); child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); done(); }); });
  } else {
    try { await access(join(home, 'profiles/desktop/lock')); throw new Error('Quit Desktop before managing plugins.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (operation === 'install') {
      // Use the same first-profile initializer as Electron; it does not modify credentials or model selection.
      try { await access(join(home, 'profiles/desktop/package.json')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const { createPluginProfile } = await import(pathToFileURL(join(desktopDir, 'lib/types/project-manager.js')));
        createPluginProfile(join(home, 'profiles/desktop'));
      }
    }
    if (operation === 'dump-config') {
      // Configuration inspection does not launch the reserved profile through the CLI.
      const { loadProfile, loadOptionalPatches, renderConfigDump } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-app-boot')));
      const profile = loadProfile('dsh', 'desktop', join(runtime, 'package.json'));
      const layers = profile.layers.map(layer => ({ label: layer.packageName, patches: layer.patches }));
      layers.push({ label: profile.patchPath, patches: profile.patches });
      const homePatch = join(home, 'cordis.patch.yml');
      const patches = loadOptionalPatches('dsh', homePatch);
      if (patches) layers.push({ label: homePatch, patches });
      const config = join(profile.dir, 'cordis.yml');
      try { await writeFile(config, '[]\n', { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      process.stdout.write(renderConfigDump('dsh', config, layers));
    } else {
      const host = dirname(requireRuntime.resolve('@deepseek-ai/dsh-desktop-host/package.json'));
      const { runDesktopCli } = await import(pathToFileURL(join(host, 'lib/cli.js')));
      const args = operation === 'install' ? ['plugin', '--profile', 'desktop', 'add', `link:${automationDir}`, `link:${join(runtime, 'node_modules/@tpcowork/dsh-ui')}`, '--offline', '--ignore-scripts']
        : operation === 'remove' ? ['plugin', '--profile', 'desktop', 'remove', '@tpcowork/dsh-automation']
          : ['plugin', '--profile', 'desktop', 'list'];
      process.argv = [process.execPath, 'dsh', ...args];
      await runDesktopCli(runtime, join(root, 'support'));
    }
  }
}
