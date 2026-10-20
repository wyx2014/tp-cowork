/** Build a relocatable offline Desktop kit from this worktree's current artifacts and runtime dependency graph. */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, realpath, readdir, readlink, symlink, access } from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import { dirname, resolve, relative, join, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const plugin = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(plugin, '../..');
const harness = join(workspace, 'deepseek-harness');
const output = resolve(process.argv[2] ?? join(workspace, 'artifacts/tpco10/offline-kit'));
const runtime = join(output, 'runtime');
await mkdir(output, { recursive: true });
// Never replace another kit or mix stale artifacts into an update.
await writeFile(join(output, '.building'), '', { flag: 'wx' });
const records = new Map();
const top = new Map();
const topSources = new Map();
const skipped = new Set(['node_modules', '.git', '.desktop-build', '.pnpm-store', 'test-results', 'tests', 'test', 'coverage']);
async function link(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await symlink(relative(dirname(destination), source), destination, 'dir');
}
function resolveDependency(directory, name) {
  let current = directory;
  while (true) {
    const path = join(current, 'node_modules', name, 'package.json');
    try { return dirname(createRequire(join(directory, 'package.json')).resolve(path)); }
    catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
    const parent = dirname(current);
    if (parent === current) {
      if (!directory.startsWith(harness + sep) && topSources.has(name)) return topSources.get(name);
      throw new Error(`Offline package dependency missing: ${name}`);
    }
    current = parent;
  }
}
async function visit(directory) {
  const source = await realpath(directory);
  if (records.has(source)) return records.get(source);
  if (!source.startsWith(workspace + sep)) throw new Error('Offline input escapes this task worktree');
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  const local = !relative(harness, source).split(sep).includes('node_modules');
  const key = `${manifest.name.replaceAll('/', '+').replaceAll('@', '')}-${createHash('sha256').update(relative(workspace, source)).digest('hex').slice(0, 10)}`;
  const destination = join(runtime, 'packages', key);
  const record = { name: manifest.name, version: manifest.version, source: relative(workspace, source), directory: relative(output, destination), dependencies: [] };
  records.set(source, record);
  if (!top.has(manifest.name) || local) { top.set(manifest.name, destination); topSources.set(manifest.name, source); }
  await cp(source, destination, { recursive: true, verbatimSymlinks: true, filter(path) {
    const parts = relative(source, path).split(sep);
    return !parts.some(part => skipped.has(part) || part.startsWith('.env') || ['.npmrc', '.pypirc', '.DS_Store', 'deployment.local.json', 'CLAUDE.md'].includes(part))
      && !/\.(?:tgz|log|tsbuildinfo|map)$/.test(path);
  } });
  const required = { ...manifest.dependencies, ...manifest.peerDependencies };
  const optional = { ...manifest.optionalDependencies };
  for (const [name, spec] of Object.entries({ ...required, ...optional })) {
    if (isBuiltin(name)) continue;
    let dependency;
    try { dependency = await visit(resolveDependency(source, name)); }
    catch (error) {
      if (Object.hasOwn(optional, name) || manifest.peerDependenciesMeta?.[name]?.optional) continue;
      throw error;
    }
    await link(resolve(output, dependency.directory), join(destination, 'node_modules', name));
    record.dependencies.push({ name, version: dependency.version });
    if (spec.startsWith('workspace:')) {
      for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        if (manifest[section]?.[name]?.startsWith('workspace:')) manifest[section][name] = dependency.version;
      }
    }
  }
  // Source scripts are included for review; offline install never executes lifecycle scripts.
  await writeFile(join(destination, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  return record;
}
for (const directory of [
  'apps/cli', 'apps/desktop-host', 'apps/desktop', 'apps/web', 'packages/bundle/base', 'packages/bundle/web-app',
  'apps/desktop/node_modules/electron', 'apps/desktop/node_modules/pnpm',
  'apps/web/node_modules/react', 'apps/web/node_modules/react-dom',
]) await visit(join(harness, directory));
await visit(plugin);
await visit(join(workspace, 'plugins/tpcowork-ui'));
for (const [name, directory] of top) await link(directory, join(runtime, 'node_modules', name));
const desktop = top.get('@deepseek-ai/dsh-desktop');
// The Electron shell's development carrier reads these two package-manager paths directly.
for (const name of ['electron', 'pnpm']) {
  try { await access(join(desktop, 'node_modules', name)); }
  catch { await link(top.get(name), join(desktop, 'node_modules', name)); }
}
const { developmentRuntimeDirectory } = await import(join(harness, 'apps/desktop/scripts/desktop-build-paths.mjs'));
await cp(developmentRuntimeDirectory(), join(output, 'support/primary-runtime'), { recursive: true, verbatimSymlinks: true });
await cp(join(dirname(developmentRuntimeDirectory()), 'office-skills'), join(output, 'support/office-skills'), { recursive: true, verbatimSymlinks: true });
await cp(join(harness, 'apps/desktop/scripts/node-bin'), join(output, 'support/bin'), { recursive: true });
await cp(process.execPath, join(output, process.platform === 'win32' ? 'node.exe' : 'node'));
await cp(join(plugin, 'offline.mjs'), join(output, 'offline.mjs'));
await cp(join(plugin, 'OFFLINE.md'), join(output, 'README.md'));
const version = JSON.parse(await readFile(join(harness, 'apps/cli/package.json'), 'utf8')).version;
const { createDevelopmentProjectMetadata } = await import(join(harness, 'apps/desktop/lib/types/project-manager.js'));
const { DESKTOP_HOST_PROTOCOL_VERSION } = await import(join(harness, 'apps/desktop/lib/types/host-protocol.js'));
const requireKit = createRequire(join(runtime, 'package.json'));
const electron = requireKit('electron');
const release = { schemaVersion: 1, version, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
  nodeVersion: execFileSync(electron, ['-p', 'process.versions.node'], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).trim(),
  pnpmVersion: JSON.parse(await readFile(join(top.get('pnpm'), 'package.json'), 'utf8')).version };
createDevelopmentProjectMetadata(runtime, release);
await writeFile(join(runtime, 'desktop-runtime.json'), JSON.stringify({ schemaVersion: 1, release, platform: process.platform, arch: process.arch,
  sharedPackages: [...top].map(([name, directory]) => ({ name, version: [...records.values()].find(record => resolve(output, record.directory) === directory).version, path: `node_modules/${name}` })), files: [] }, null, 2) + '\n');
const files = [];
const links = [];
async function inventory(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await inventory(path);
    else if (item.isSymbolicLink()) {
      const target = await realpath(path);
      if (!target.startsWith(output + sep)) throw new Error(`Offline link escapes kit: ${relative(output, path)}`);
      links.push({ path: relative(output, path), target: await readlink(path) });
    } else {
      const bytes = await readFile(path);
      files.push({ path: relative(output, path), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
await inventory(output);
await writeFile(join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, platform: process.platform, arch: process.arch,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(),
  sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: workspace, encoding: 'utf8' }).trim()),
  packages: [...records.values()], files: files.filter(file => file.path !== '.building'), links,
}, null, 2) + '\n');
await writeFile(join(output, '.building'), 'complete\n');
console.log(JSON.stringify({ output, packages: records.size, files: files.length, platform: process.platform, arch: process.arch }));
