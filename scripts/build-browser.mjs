import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const run = (cmd, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, {cwd, stdio:'inherit'});
  child.once('error',reject);
  child.once('exit',code=>code===0?resolve():reject(new Error(`${cmd} exited with ${code}`)));
});
const plugin = root + 'plugins/tpcowork-browser';
if (!existsSync(plugin + '/node_modules/esbuild')) await run('npm',['ci','--legacy-peer-deps'],plugin);
await run(process.execPath,['build.mjs','--install-native'],plugin);
await run('pnpm',['exec','tsc','-b','apps/desktop/tsconfig.host.json'],root+'../deepseek-harness');
await run('pnpm',['--filter','@deepseek-ai/dsh-desktop','run','bundle'],root+'../deepseek-harness');
