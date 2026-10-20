/** Required Session/navigation regressions; own only the temporary web-app self-resolution link. */
import { lstat, mkdir, readlink, symlink, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), harness = resolve(root, '../../../deepseek-harness');
const link = resolve(harness, 'node_modules/@deepseek-ai/dsh-web-app'), target = resolve(harness, 'packages/bundle/web-app');
let owned = false;
try {
  try { await lstat(link); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await symlink(target, link, 'dir'); owned = true;
  }
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
    'packages/api/session-controller/tests/reference-ownership.client.spec.ts',
    'packages/api/session-controller/tests/transport.host.spec.ts',
    'packages/session/session-persistence-jsonl/tests/delete.spec.ts',
    'packages/client/ui-workspace/tests/apply.client.spec.ts', '--maxWorkers=2', '--reporter=dot'],
  { cwd: harness, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const output = resolve(root, 'test-results/tpco9-checks'); await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'dsh-regression.log'), result.stdout + result.stderr);
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (owned && (await lstat(link)).isSymbolicLink() && await readlink(link) === target) await unlink(link);
}
