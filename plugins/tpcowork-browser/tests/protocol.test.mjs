import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopTransport } from '../src/host-transport.js';
import { OperationQueue, envelope } from '../src/protocol.js';
import { materialize } from '../src/artifacts.js';

test('IPC correlates responses, cancels outstanding work and settles on disconnect', async () => {
  const carrier = new EventEmitter(); carrier.connected = true;
  const sent = []; carrier.send = (message, done) => { sent.push(message); done?.(); };
  const transport = new DesktopTransport(carrier, 500);
  const first = transport.call('command', {sessionId:'one'});
  const second = transport.call('command', {sessionId:'two'});
  carrier.emit('message', {...sent[1],kind:'result',value:2});
  carrier.emit('message', {...sent[0],kind:'result',value:1});
  assert.deepEqual(await Promise.all([first,second]), [1,2]);
  const controller = new AbortController();
  const aborted = transport.call('command',{},controller.signal);
  controller.abort(new Error('user cancelled'));
  await assert.rejects(aborted,/user cancelled/);
  assert.equal(sent.at(-1).kind,'cancel');
  const disconnected = transport.call('command');
  carrier.connected = false; carrier.emit('disconnect');
  await assert.rejects(disconnected,/disconnected/);
  assert.equal(transport.pending.size,0);
  assert.equal(carrier.listenerCount('message'),0);
  assert.throws(()=>envelope({type:'tpcowork-browser',version:2,id:'x',kind:'request'}),/Incompatible/);
});

test('DesktopTransport ignores shared-channel desktop pet events and unrelated result ids', async () => {
  const carrier = new EventEmitter(); carrier.connected = true;
  const sent = []; carrier.send = (message, done) => { sent.push(message); done?.(); };
  const transport = new DesktopTransport(carrier, 500);
  const pending = transport.call('command', { sessionId: 'browser-1' });
  carrier.emit('message', { type: 'tpcowork-browser', version: 1, kind: 'event', id: 'pet-bridge-1', event: 'pet:bridge-request', payload: { id: 1, method: 'GET', url: '/dsh-pet-7340/config' } });
  carrier.emit('message', { type: 'tpcowork-browser', version: 1, kind: 'result', id: 'pet-start-other', value: { ok: true, windows: 1 } });
  carrier.emit('message', { ...sent[0], kind: 'result', value: { ok: true } });
  assert.deepEqual(await pending, { ok: true });
});

test('a cancelled queued page action never executes and later actions can proceed', async () => {
  const queue = new OperationQueue(); const {promise,resolve:release}=Promise.withResolvers(); const actions=[];
  const first=queue.run('session',undefined,()=>promise);
  const abort=new AbortController();
  const second=queue.run('session',abort.signal,()=>actions.push('cancelled'));
  const rejected=assert.rejects(second);
  abort.abort(); await Promise.resolve(); release();
  await first; await rejected;
  await queue.run('session',undefined,()=>actions.push('next')); await queue.drain();
  assert.deepEqual(actions,['next']);
});

test('artifact paths cannot escape through traversal or symlinks and never overwrite', async () => {
  const directory=await mkdtemp(join(tmpdir(),'browser-artifacts-'));
  try {
    const root=join(directory,'workspace'),outside=join(directory,'outside');
    await mkdir(root);await mkdir(outside);await symlink(outside,join(root,'link'));
    await assert.rejects(materialize(root,'../escape',undefined,Buffer.from('secret')),/inside/);
    await assert.rejects(materialize(root,'link/created/file',undefined,Buffer.from('secret')),/outside/);
    assert.deepEqual(await readdir(outside),[]);
    const target=await materialize(root,'evidence/page.png',undefined,Buffer.from('image'));
    assert.equal(await readFile(target,'utf8'),'image');
    await assert.rejects(materialize(root,'evidence/page.png',undefined,Buffer.from('changed')),/EEXIST/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
