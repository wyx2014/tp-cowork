import { execFileSync } from 'node:child_process';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const harness = resolve(root, '../deepseek-harness');
const inside = path => [root, harness].some(directory => {
  const offset = relative(directory, path);
  return offset !== '..' && !offset.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(offset);
});
if (!(await lstat(harness)).isDirectory()) throw new Error('deepseek-harness must be a local source directory');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
if (await realpath(git(['rev-parse', '--show-toplevel'])) !== root) {
  throw new Error('Run in the product repository beside the deepseek-harness fork');
}
const harnessRepository = await realpath(git(['rev-parse', '--show-toplevel'], harness));
if (harnessRepository !== harness) {
  throw new Error('deepseek-harness must be an independent sibling Git repository');
}
let links = 0;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', '.multica', '.agent_context', '.desktop-build', '.cache', 'artifacts', 'test-results'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      if (!inside(await realpath(path))) throw new Error(`Link leaves this worktree: ${relative(root, path)}`);
      links++;
    } else if (entry.isDirectory()) {
      await scan(path);
    }
  }
}
await scan(root);
await scan(harness);
console.log(JSON.stringify({ root, branch: git(['branch', '--show-current']), harnessRepository, links, isolated: true }));
