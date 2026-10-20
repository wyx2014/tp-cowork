import { copyFile, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { BrowserError } from './protocol.js';

/** Persist an artifact only beneath the authoritative current directory, including symlink checks. */
export async function materialize(cwd, outputPath, source, bytes) {
  if (typeof outputPath !== 'string' || outputPath.length === 0 || isAbsolute(outputPath)) throw new BrowserError('invalid_path', 'outputPath must be workspace-relative');
  const root = await realpath(cwd);
  const target = resolve(root, outputPath);
  if ((relative(root, target) === '..' || relative(root, target).startsWith('..' + sep)) || target === root) throw new BrowserError('invalid_path', 'outputPath must remain inside the workspace');
  // Check each existing ancestor before creating a child, including symlinks.
  let cursor = root;
  for (const part of relative(root, dirname(target)).split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    try { await mkdir(cursor, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const actual = await realpath(cursor);
    if (actual !== root && !actual.startsWith(root + sep)) throw new BrowserError('invalid_path', 'outputPath traverses a directory outside the workspace');
  }
  const parent = await realpath(dirname(target));
  if (parent !== root && !parent.startsWith(root + sep)) throw new BrowserError('invalid_path', 'outputPath traverses a directory outside the workspace');
  // Exclusive creation avoids following a pre-existing target symlink or overwriting user data.
  if (bytes) await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  else { if (!(await stat(source)).isFile()) throw new BrowserError('invalid_artifact', 'The browser artifact is not a file'); await copyFile(source, target, 1); }
  return target;
}
