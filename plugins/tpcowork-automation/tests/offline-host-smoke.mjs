/** macOS OS-network-denied launch of the kit-owned production Host; authenticate locally and drain shutdown. */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve,join } from 'node:path';
import assert from 'node:assert/strict';
const kit=resolve(process.argv[2]), home=resolve(process.argv[3]);
const version=JSON.parse(readFileSync(join(kit,'runtime/desktop-runtime.json'),'utf8')).release.version;
const req=createRequire(join(kit,'runtime/package.json'));
const args=[join(kit,'runtime/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'),join(kit,'runtime'),join(home,'profiles/desktop'),join(kit,'support/primary-runtime'),join(kit,'support/primary-runtime/dependencies/pnpm/bin/pnpm.mjs'),join(kit,'support/bin')];
const child=spawn('/usr/bin/sandbox-exec',['-p','(version 1)(allow default)(deny network*)(allow network* (remote ip "localhost:*"))(allow network* (local ip "localhost:*"))',req('electron'),'--expose-internals',...args],{cwd:kit,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',DSH_CLIENT_VERSION:version},stdio:['ignore','pipe','pipe','ipc']});
const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
const deadline=setTimeout(()=>child.kill('SIGKILL'),30000);
child.stderr.on('data',data=>process.stderr.write(data.toString().replace(/token=[^\s&]+/g,'token=[redacted]')));
child.stdout.on('data',data=>process.stdout.write(data.toString().replace(/token=[^\s&]+/g,'token=[redacted]')));
try {
 const ready=await new Promise((resolve,reject)=>{child.on('message',message=>{if(message.type==='ready')resolve(message);if(message.type==='fatal')reject(new Error(message.message));}); child.once('exit',code=>reject(new Error('Host exited before ready: '+code)));});
 assert.ok(ready.injections.length);
 const auth=await fetch(ready.url,{redirect:'manual'}); assert.equal(auth.status,303); const cookie=auth.headers.get('set-cookie').split(';')[0]; await auth.body?.cancel(); const response=await fetch(new URL('/',ready.url),{headers:{cookie}}); assert.equal(response.status,200); await response.body?.cancel();
 console.log(JSON.stringify({ready:true,network:'OS denies remote network; loopback allowed',injections:ready.injections.length}));
 child.send({type:'shutdown'});
 const result=await exited;assert.equal(result.code,0);
 console.log('Offline Host clean shutdown passes.');
} finally {clearTimeout(deadline);if(child.exitCode===null){child.kill('SIGKILL');await exited;}}
