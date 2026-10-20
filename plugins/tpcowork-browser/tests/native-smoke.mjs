import { _electron as electron } from 'playwright-core';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({ entryPoints:[resolve(root,'tests/native/client.jsx')], outfile:resolve(root,'test-results/native-client.js'), bundle:true, platform:'browser', format:'iife', jsx:'automatic', nodePaths:[resolve(root,'../../../deepseek-harness/packages/client/ui-renderer/node_modules')] });
const home = await mkdtemp(resolve(tmpdir(), 'dsh-browser-'));
const server = createServer((req, res) => {
  if (req.url === '/file') { res.writeHead(200, {'Content-Disposition': 'attachment; filename="fixture.txt"'}); res.end('download evidence'); return; }
  if (req.url === '/slow') {
    res.writeHead(200, {'Content-Disposition':'attachment; filename="slow.txt"','Content-Type':'application/octet-stream','Content-Length':'10000000'});
    res.write(Buffer.alloc(4096,120)); const timer=setInterval(()=>res.write('x'),100);
    res.on('close',()=>clearInterval(timer)); return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>Browser acceptance</title><h1>Browser acceptance</h1><label>Username<input id="name"></label><button onclick="document.querySelector(\'h1\').textContent=\'Hello \'+document.querySelector(\'input\').value">Sign in</button><a href="/file">Download</a><a href="/popup" target="_blank">Popup</a><button onclick="window.confirmed=confirm(\'Continue?\')">Dialog</button><button id="target" style="position:absolute;left:30px;top:200px;width:100px;height:60px;background:#1234ab;border:0;color:white" onclick="window.manualClicks=(window.manualClicks||0)+1">Manual</button><script>window.seed=async()=>{document.cookie="login=fixture;max-age=86400;path=/";localStorage.setItem("login","fixture");await new Promise((yes,no)=>{const req=indexedDB.open("acceptance",1);req.onupgradeneeded=()=>req.result.createObjectStore("state");req.onsuccess=()=>{const tx=req.result.transaction("state","readwrite");tx.objectStore("state").put("fixture","login");tx.oncomplete=yes;tx.onerror=no;};});return true;}</script>');
});
await new Promise(yes => server.listen(0, '127.0.0.1', yes));
const url = `http://127.0.0.1:${server.address().port}`;
const executablePath = resolve(root, '../../../deepseek-harness/apps/desktop/.desktop-build/development/Harness Dev.app/Contents/MacOS/Electron');
let app;
const launch = async () => {
  const env = {...process.env, BROWSER_TEST_HOME: home}; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({timeout:15000,executablePath, args:[resolve(root, 'tests/native/main.mjs')], env});
  if (process.env.BROWSER_TEST_DEBUG) app.process().stderr.on('data',data=>process.stderr.write(data));
  // Playwright auto-dismisses guest dialogs without a listener; the native bridge owns replies.
  app.context().on('page', page => page.on('dialog', () => {}));
  await app.firstWindow();
};
const command = async (command, sessionId = 'acceptance') => {
  const result = await app.evaluate(async (_electron, {command, sessionId}) => globalThis.testBrowser.command(sessionId, command, crypto.randomUUID()), {command, sessionId});
  assert.equal(result.ok, true, JSON.stringify(result)); return result;
};
const waitForReplacement = async (tabId, previousGuest) => {
  for(let attempt=0;attempt<100;attempt++) {
    const recovered=await app.evaluate((_e,{tabId,previousGuest})=>{
      const guest=globalThis.testBrowser.records.get(tabId)?.guest;
      return guest && guest.id!==previousGuest && !guest.isDestroyed() && !guest.isLoading() && guest.getURL().startsWith('http');
    },{tabId,previousGuest});
    if(recovered)return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.fail('The replacement guest did not restore its page within 10 seconds');
};
try {
  await launch();
  const created = await command({method:'newTab'});

  const tabId = created.tab?.id ?? created.tab?.tabId;
  assert.ok(tabId);
  await command({method:'navigate', tabId, url});
  await command({method:'playwright', tabId, action:{name:'domSnapshot'}});
  const page = await app.firstWindow();
  await page.waitForFunction(() => document.querySelector('.tpcb-guest-host')?.style.left === '520px');
  await writeFile(resolve(root,'test-results/native-position.png'),Buffer.from(await app.evaluate(async()=>(await globalThis.testWindow.webContents.capturePage()).toPNG().toString('base64')),'base64'));
  const display = await page.evaluate(()=>{
    const element=document.querySelector('.tpcb-guest-host'); const rect=element.getBoundingClientRect();
    return {left:rect.left,top:rect.top,scale:rect.width/parseFloat(element.style.width)};
  });
  await page.mouse.click(display.left+50*display.scale, display.top+225*display.scale);
  assert.equal((await command({method:'evaluate',tabId,expression:'window.manualClicks'})).value,1);
  const pixel = await app.evaluate(async (_e,display) => {
    const image = (await globalThis.testWindow.webContents.capturePage()).resize({width:1200});
    const bytes = image.toBitmap(); const size = image.getSize();
    const index=(Math.round(display.top+210*display.scale)*size.width+Math.round(display.left+40*display.scale))*4;
    return [...bytes.subarray(index,index+3)];
  },display);
  assert.deepEqual(pixel,[171,52,18], 'Native page pixels must align with the right-pane anchor');
  await command({method:'playwright', tabId, action:{name:'locator', selector:'#name', operation:'fill', value:'DSH'}});
  await command({method:'playwright', tabId, action:{name:'locator', selector:'button:has-text("Sign in")', operation:'click'}});
  assert.match(JSON.stringify(await command({method:'snapshot',tabId})), /Hello DSH/);
  await command({method:'playwright',tabId,action:{name:'evaluate',expressionKind:'string',expression:'(()=>{setTimeout(()=>{window.confirmed=confirm("Continue?")},0);return true})()'}});
  let pendingDialog;
  for (let attempt=0;attempt<30;attempt++) {
    pendingDialog=await command({method:'getDialog',tabId});
    if (pendingDialog.dialog) break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(pendingDialog.dialog.message,'Continue?');
  await command({method:'handleDialog',tabId,accept:true});
  assert.equal((await command({method:'evaluate',tabId,expression:'window.confirmed'})).value,true);
  await command({method:'playwright',tabId,action:{name:'evaluate',expressionKind:'string',expression:'(()=>{Notification.requestPermission().then(value=>window.permissionResult=value);return true})()'}});
  let permission;
  for(let attempt=0;attempt<30;attempt++) {
    permission=await app.evaluate(()=>globalThis.testBrowser.snapshot().requests[0]);
    if(permission)break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(permission.permission,'notifications');
  await app.evaluate(async(_e,id)=>globalThis.testBrowser.request('permissionRespond',{id,allow:false,remember:true}),permission.id);
  assert.equal((await command({method:'evaluate',tabId,expression:'window.permissionResult'})).value,'denied');
  await command({method:'playwright',tabId,action:{name:'evaluate',expressionKind:'string',expression:'window.seed()'}});
  const imported=await app.evaluate(async()=>globalThis.testChromeImport());
  assert.equal(imported.success,true,JSON.stringify(imported));
  assert.equal(imported.cookies.imported,1);
  assert.match((await command({method:'evaluate',tabId,expression:'document.cookie'})).value,/chrome_import=imported-login/);
  assert.deepEqual((await command({method:'evaluate',tabId,expression:'[typeof require,typeof window.dshDesktop]'})).value,['undefined','undefined']);
  await command({method:'playwright',tabId,action:{name:'locator',selector:'a:has-text("Popup")',operation:'click'}});
  let popup;
  for(let i=0;i<30;i++) {
    popup=await app.evaluate(async()=>globalThis.testBrowser.snapshot().tabs.find(row=>row.origin==='user' && row.ready));
    if(popup)break;
    await new Promise(r=>setTimeout(r,80));
  }
  assert.ok(popup); assert.equal(popup.sessionId,'acceptance');
  await app.evaluate(async (_e,popup)=>globalThis.testBrowser.request('close',{sessionId:'acceptance',tabId:popup.id}),popup);

  const foreign = await app.evaluate(async (_e, tabId) => {
    try { return await globalThis.testBrowser.command('other-session',{method:'getState',tabId},crypto.randomUUID()); }
    catch(error) { return {error:error.code}; }
  },tabId);
  assert.equal(foreign.error,'wrong_session');
  await app.evaluate(async (_e,tabId)=>globalThis.testBrowser.request('pause',{sessionId:'acceptance',tabId}),tabId);
  await assert.rejects(command({method:'evaluate',tabId,expression:'document.title'}),/human_control|taken control|controls this page/);
  await app.evaluate(async (_e,tabId)=>globalThis.testBrowser.request('resume',{sessionId:'acceptance',tabId}),tabId);
  const automaticRecording=await command({method:'recordingStart',tabId,options:{fps:10,settleMs:0,maxDurationMs:10000,actions:[{type:'wait',durationMs:3000},{type:'type',selector:'#name',text:'unexpected'}]}});
  await app.evaluate(async(_e,tabId)=>globalThis.testBrowser.request('pause',{sessionId:'acceptance',tabId}),tabId);
  await app.evaluate(async(_e,tabId)=>globalThis.testBrowser.request('resume',{sessionId:'acceptance',tabId}),tabId);
  assert.equal((await command({method:'recordingStatus',tabId,recordingId:automaticRecording.recording.id})).recording.status,'cancelled');
  assert.equal((await command({method:'evaluate',tabId,expression:'document.querySelector("#name").value'})).value,'DSH');
  await command({method:'playwright',tabId,action:{name:'locator',selector:'a:has-text("Download")',operation:'click'}});
  const download=await command({method:'playwright',tabId,action:{name:'waitForEvent',event:'download'}});
  const file=await command({method:'playwright',tabId,action:{name:'downloadPath',downloadId:download.value.id}});
  assert.equal(await readFile(file.value,'utf8'),'download evidence');
  const recording=await command({method:'recordingStart',tabId,options:{fps:10,settleMs:0,maxDurationMs:10000,actions:[{type:'wait',durationMs:1200}]}});
  let status;
  for(let attempt=0;attempt<200;attempt++) {
    status=await command({method:'recordingStatus',tabId,recordingId:recording.recording.id});
    if(status.recording.status!=='running') break;
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  assert.equal(status.recording.status,'completed',JSON.stringify(status));
  assert.equal((await readFile(status.recording.artifact.path)).subarray(0,4).toString('hex'),'1a45dfa3');
  await app.evaluate(async (_e,url)=>globalThis.testBrowser.request('permissionSet',{origin:url,permission:'notifications',decision:'deny'}),url);
  await assert.rejects(command({method:'navigate',tabId,url:'file:///etc/hosts'}),/Only HTTP/);
  await assert.rejects(command({method:'navigate',tabId,url:'http://127.0.0.1:1/private'}),/Only HTTP/);
  const previousGuest=await app.evaluate(async (_e,tabId)=>{
    const guest=globalThis.testBrowser.records.get(tabId).guest;const id=guest.id;guest.forcefullyCrashRenderer();return id;
  },tabId);
  await waitForReplacement(tabId,previousGuest);
  assert.equal((await command({method:'evaluate',tabId,expression:'localStorage.getItem("login")'})).value,'fixture');
  const captured = await command({method:'screenshot',tabId});
  assert.ok(captured.image?.base64.length > 2000);
  await page.evaluate(()=>document.querySelector('#page').style.display='none');
  await app.evaluate(()=>globalThis.testWindow.hide());
  const hiddenCapture=await command({method:'screenshot',tabId});
  assert.ok(hiddenCapture.image?.base64.length > 2000);
  const hiddenPixel=await app.evaluate(({nativeImage},base64)=>{
    const image=nativeImage.createFromBuffer(Buffer.from(base64,'base64'));const size=image.getSize();const bytes=image.toBitmap();const index=(210*size.width+40)*4;
    return [...bytes.subarray(index,index+3)];
  },hiddenCapture.image.base64);
  assert.deepEqual(hiddenPixel,[171,52,18], 'A hidden capture contains the page, not an empty surface');
  await app.evaluate(()=>globalThis.testWindow.showInactive());
  await page.evaluate(()=>document.querySelector('#page').style.display='block');
  await command({method:'browserViewportSet',tabId,width:800,height:600});
  const viewport = await command({method:'evaluate',tabId,expression:'({width:innerWidth,height:innerHeight})'});
  assert.deepEqual(viewport.value, {width:800,height:600});
  const beforeReload = await app.evaluate((_e,tabId)=>globalThis.testBrowser.records.get(tabId).guest.id,tabId);
  await page.reload();
  await waitForReplacement(tabId,beforeReload);
  assert.equal((await command({method:'evaluate',tabId,expression:'localStorage.getItem("login")'})).value,'fixture');
  await command({method:'playwright',tabId,action:{name:'evaluate',expressionKind:'string',expression:'(()=>{const link=document.createElement("a");link.href="/slow";link.click();return true})()'}});
  for(let attempt=0;attempt<30;attempt++) {
    if(await app.evaluate(()=>globalThis.testBrowser.downloadItems.size>0))break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.ok(await app.evaluate(()=>globalThis.testBrowser.downloadItems.size>0));
  const before=await app.evaluate(async()=>globalThis.testBrowser.snapshot());
  assert.equal(before.tabs.find(row=>row.id===tabId).url,url+'/');
  await app.evaluate(async () => globalThis.testBrowser.disable());
  assert.equal(await app.evaluate(()=>globalThis.testBrowser.downloadItems.size),0);
  const saved=JSON.parse(await readFile(resolve(home,'tpcowork-browser/tabs.json'),'utf8'));
  assert.equal(saved.shells[0].restoreUrl,url+'/');
  assert.deepEqual(saved.shells[0].viewport,{width:800,height:600});
  await app.close(); app = undefined;
  await launch();
  const restored = await app.evaluate(async () => globalThis.testBrowser.request('snapshot',{sessionId:'acceptance'}));
  assert.ok(restored.tabs.some(row=>row.id===tabId));
  assert.equal(restored.permissions[url].notifications,'deny');
  const login = await command({method:'evaluate',tabId,expression:'({cookie:document.cookie,local:localStorage.getItem("login")})'});
  assert.equal(login.value.local,'fixture'); assert.match(login.value.cookie,/login=fixture/);
  const indexed=await command({method:'playwright',tabId,action:{name:'evaluate',expressionKind:'string',expression:'new Promise(resolve=>{const request=indexedDB.open("acceptance");request.onsuccess=()=>{const read=request.result.transaction("state").objectStore("state").get("login");read.onsuccess=()=>resolve(read.result);};})'}});
  assert.equal(indexed.value,'fixture');
  await app.evaluate(async ()=>globalThis.testBrowser.request('clearData',{mode:'cache'}));
  assert.equal((await command({method:'evaluate',tabId,expression:'localStorage.getItem("login")'})).value,'fixture');
  await assert.rejects(app.evaluate(async()=>globalThis.testBrowser.request('clearData',{mode:'all'})),/Confirm/);
  await app.evaluate(async()=>globalThis.testBrowser.request('clearData',{mode:'all',confirmed:true}));
  const cleared=await app.evaluate(async()=>({tabs:globalThis.testBrowser.snapshot().tabs,permissions:globalThis.testBrowser.snapshot().permissions,cookies:await globalThis.testBrowser.browserSession.cookies.get({})}));
  assert.deepEqual(cleared,{tabs:[],permissions:{},cookies:[]});
  console.log('PASS native actions, right-pane pixels/clicks, ownership, takeover and recording cancellation, downloads and cleanup, WebM, visible/hidden screenshots, viewport, popup/dialog, crash/reload recovery, encrypted Chrome-cookie fixture, sandbox, cache/all cleanup, restart recovery, cookies, localStorage, IndexedDB and permission prompts');
} finally {
  if (app) { await app.evaluate(async () => globalThis.testBrowser.dispose()).catch(()=>{}); await app.close(); }
  await new Promise(yes=>server.close(yes)); await rm(home,{recursive:true,force:true});
}
