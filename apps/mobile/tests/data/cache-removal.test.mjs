import test from 'node:test';
import assert from 'node:assert/strict';
import {loadComponent} from '../reader/parity-host.mjs';
import {throwIfAborted} from '../../src/utils/abort.ts';

const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
async function fixture() {
  const calls = [], handles = new Set(), staged = new Set(); let active = true, wait;
  const native = {
    beginWrite(owner) {assert.equal(owner, 'account-a'); handles.add('id'); return 'id';},
    endWrite(owner, id) {assert.equal(owner, 'account-a'); handles.delete(id);},
    async stageRemoval(directory, owner, id, path, generation) {
      calls.push(['stage', directory, owner, path, generation]); await wait;
      assert(handles.has(id), 'Cancelled native operation cannot move files'); staged.add(`${path}:${generation}`);
    },
    async restoreRemoval(directory, owner, path, generation) {calls.push(['restore', directory, owner, path, generation]); await wait; staged.delete(`${path}:${generation}`);},
    async purgeRemoval(directory, owner, path, generation) {calls.push(['purge', directory, owner, path, generation]); await wait; staged.delete(`${path}:${generation}`);},
  };
  const {NativeFileStore} = await loadComponent('../../src/data/native-file-store.ts', {
    'expo-modules-core': {requireNativeModule: name => {assert.equal(name, 'SlaxStorage'); return native;}}, '../utils/abort.ts': {throwIfAborted},
  }, {Error});
  return {files: new NativeFileStore('/app', 'account-a', () => {if (!active) throw new Error('Account revoked');}), calls, handles, staged,
    hold(value) {wait = value;}, revoke() {active = false;}};
}

test('staged removal dispatches the exact scope and generation through async native ports', async () => {
  const f = await fixture();
  await f.files.stageRemoval('bookmark/doc', 'one'); assert.equal(f.handles.size, 0); assert(f.staged.has('bookmark/doc:one'));
  await f.files.restoreRemoval('bookmark/doc', 'one'); assert.equal(f.staged.size, 0);
  await f.files.stageRemoval('bookmark/doc', 'two'); await f.files.purgeRemoval('bookmark/doc', 'two');
  assert.deepEqual(f.calls, [['stage', '/app', 'account-a', 'bookmark/doc', 'one'], ['restore', '/app', 'account-a', 'bookmark/doc', 'one'],
    ['stage', '/app', 'account-a', 'bookmark/doc', 'two'], ['purge', '/app', 'account-a', 'bookmark/doc', 'two']]);
});

test('retention cancellation while native staging is queued prevents detaching the live files', async () => {
  const f = await fixture(), held = deferred(), controller = new AbortController(); f.hold(held.promise);
  const work = f.files.stageRemoval('bookmark/doc', 'one', controller.signal), rejected = assert.rejects(work, {name: 'AbortError'});
  await Promise.resolve(); assert.equal(f.handles.size, 1); controller.abort(); held.resolve(); await rejected;
  assert.equal(f.handles.size, 0); assert.equal(f.staged.size, 0);
});

test('revoked account cannot dispatch a staged move, rollback or purge', async () => {
  const f = await fixture(); f.revoke();
  await assert.rejects(f.files.stageRemoval('bookmark/doc', 'one'), /revoked/);
  await assert.rejects(f.files.restoreRemoval('bookmark/doc', 'one'), /revoked/);
  await assert.rejects(f.files.purgeRemoval('bookmark/doc', 'one'), /revoked/);
  assert.equal(f.calls.length, 0); assert.equal(f.handles.size, 0);
});

test('revocation after delayed native completion cannot report a successful removal', async () => {
  for (const operation of ['stageRemoval', 'restoreRemoval', 'purgeRemoval']) {
    const f = await fixture(), held = deferred(); f.hold(held.promise);
    const work = f.files[operation]('bookmark/doc', 'one'), rejected = assert.rejects(work, /revoked/);
    await Promise.resolve(); f.revoke(); held.resolve(); await rejected; assert.equal(f.handles.size, 0);
  }
});
