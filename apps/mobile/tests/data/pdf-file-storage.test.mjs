import test from 'node:test';
import assert from 'node:assert/strict';
import {loadComponent} from '../reader/parity-host.mjs';
import {Sha256} from '../../src/data/pdf-sha256.ts';
import {PdfBlockCache} from '../../src/data/pdf-cache.ts';

const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve};};
async function fixture() {
  const files = new Map(), calls = [], writes = new Map();
  let active = true, owner = 'account-a', writeWait, readWait, afterWrite, writeError, writeSequence = 0;
  const current = value => {if (value !== owner) throw new Error('native owner revoked');};
  const native = {
    beginWrite(captured) {current(captured); const id = String(++writeSequence); writes.set(id, captured); return id;},
    endWrite(captured, id) {if (writes.get(id) === captured) writes.delete(id);},
    async writeBlock(directory, captured, id, path, bytes) {
      calls.push({kind: 'block', directory, owner: captured, path, versioned: true}); current(captured);
      await writeWait; current(captured); if (!writes.has(id)) throw new Error('Native write cancelled'); if (writeError) throw writeError;
      files.set(path, bytes.slice()); afterWrite?.(); return `file:///app/${path}.entries/committed.data`;
    },
    async writeBytes(directory, captured, path, bytes, versioned) {
      calls.push({kind: 'write', directory, owner: captured, path, versioned}); current(captured);
      await writeWait; current(captured); if (writeError) throw writeError;
      files.set(path, bytes.slice()); afterWrite?.(); return `file:///app/${path}.entries/committed.data`;
    },
    async readBytes(directory, captured, path, versioned) {
      calls.push({kind: 'read', directory, owner: captured, path, versioned}); current(captured);
      const bytes = files.get(path)?.slice() ?? null; await readWait; current(captured); return bytes;
    },
    async size(directory, captured, path, versioned) {calls.push({kind: 'size', directory, owner: captured, path, versioned}); current(captured); return files.get(path)?.length ?? null;},
    async list(directory, captured, path, versioned) {calls.push({kind: 'list', directory, owner: captured, path, versioned}); current(captured); return [...files.keys()].filter(value => value.startsWith(`${path}/`));},
    async remove(directory, captured, path, versioned) {calls.push({kind: 'remove', directory, owner: captured, path, versioned}); current(captured); for (const key of files.keys()) if (key === path || !versioned && key.startsWith(`${path}/`)) files.delete(key);},
  };
  const {PdfFileStorage} = await loadComponent('../../src/data/pdf-file-storage.ts', {
    'expo': {requireNativeModule: name => {assert.equal(name, 'SlaxStorage'); return native;}}, './pdf-sha256.ts': {Sha256},
  }, {TextEncoder});
  return {files, calls, storage: new PdfFileStorage('/app', () => {if (!active) throw new Error('revoked');}, 'account-a'),
    waitWrite(value) {writeWait = value;}, waitRead(value) {readWait = value;}, failWrite(value) {writeError = value;}, afterWrite(value) {afterWrite = value;},
    revoke() {active = false; owner = 'account-b';}, nextAccount() {return new PdfFileStorage('/app', () => {}, 'account-b');}};
}

test('PDF adapter uses async native versioned storage for every read, write, size, inventory and removal', async () => {
  const f = await fixture(), path = 'pdf/v1/account/doc/manifest.json';
  await f.storage.writeAtomic(path, new Uint8Array([1])); await f.storage.writeAtomic(path, new Uint8Array([2, 3]));
  assert.deepEqual(await f.storage.read(path), new Uint8Array([2, 3])); assert.equal(await f.storage.size(path), 2);
  assert.deepEqual(Array.from(await f.storage.list('pdf/v1/account/doc/')), [path]);
  await f.storage.remove(path); assert.equal(await f.storage.read(path), null);
  assert(f.calls.every(call => call.directory === '/app' && call.owner === 'account-a' && call.versioned === true));
});

test('failed native atomic replacement preserves prior bytes and propagates failure rather than reporting completion', async () => {
  const f = await fixture(), path = 'pdf/v1/account/doc/manifest.json';
  await f.storage.writeAtomic(path, new Uint8Array([1])); f.failWrite(new Error('interrupted move'));
  await assert.rejects(f.storage.writeAtomic(path, new Uint8Array([2])), /interrupted/);
  assert.deepEqual(await f.storage.read(path), new Uint8Array([1]));
});

test('a held native write remains pending and cannot commit after owner replacement', async () => {
  const f = await fixture(), path = 'pdf/v1/account/doc/manifest.json', held = deferred();
  f.waitWrite(held.promise); let completed = false;
  const pending = f.storage.writeAtomic(path, new Uint8Array([1])).then(() => {completed = true;}), rejected = assert.rejects(pending, /revoked/);
  await Promise.resolve(); assert.equal(completed, false); assert.equal(f.files.size, 0);
  f.revoke(); held.resolve(); await rejected; assert.equal(f.files.size, 0);
  const next = f.nextAccount(); await next.writeAtomic('pdf/v1/new/doc', new Uint8Array([2]));
  assert.deepEqual(await next.read('pdf/v1/new/doc'), new Uint8Array([2]));
});

test('revocation during an async native read cannot publish old or replacement-account bytes', async () => {
  const f = await fixture(), path = 'pdf/v1/account/doc/manifest.json';
  await f.storage.writeAtomic(path, new Uint8Array([1])); const held = deferred(); f.waitRead(held.promise);
  const pending = f.storage.read(path), rejected = assert.rejects(pending, /revoked/);
  f.revoke(); const next = f.nextAccount(); await next.clear(); await next.writeAtomic('pdf/v1/new/doc', new Uint8Array([2]));
  held.resolve(); await rejected; assert.deepEqual(await next.read('pdf/v1/new/doc'), new Uint8Array([2]));
});

test('storage rejects traversal and oversized blocks before dispatch and checks owner again after native completion', async () => {
  const f = await fixture();
  for (const path of ['/pdf/file', 'pdf/../foreign', 'pdf//file', 'pdf/%2f/file', 'bookmark/doc']) await assert.rejects(f.storage.read(path), /Invalid/);
  await assert.rejects(f.storage.writeAtomic('pdf/v1/doc', new Uint8Array(1024 * 1024 + 1)), /limit/); assert.equal(f.calls.length, 0);
  f.afterWrite(() => f.revoke()); await assert.rejects(f.storage.writeAtomic('pdf/v1/doc', new Uint8Array([1])), /revoked/);
  assert.equal(f.calls.length, 1, 'The revoked adapter must not perform JS-driven cleanup');
});

test('clearScope awaits native deletion and keeps neighboring PDF namespaces', async () => {
  const f = await fixture(), scope = 'account', hash = new Sha256().update(new TextEncoder().encode(JSON.stringify(scope))).digest();
  await f.storage.writeAtomic(`pdf/v1/${hash}/doc`, new Uint8Array([1])); await f.storage.writeAtomic('pdf/v1/other/doc', new Uint8Array([2]));
  await f.storage.clearScope(scope); assert.equal(f.files.size, 1); assert(f.files.has('pdf/v1/other/doc'));
  assert.equal(f.calls.at(-1).versioned, false);
});

test('async native denial persistence precedes the held-reader cleanup and survives cache restart', async () => {
  const f = await fixture(), bytes = new Uint8Array([1, 2, 3]); let foreground = true;
  const pdf = {document_id: new Sha256().update(bytes).digest(), size: 3, url: '/v1/bookmark/pdf?bookmark_uid=doc', filename: 'doc.pdf', source: 'upload', text_status: 'ready'};
  const cache = new PdfBlockCache(f.storage, 'scope', () => {if (!foreground) throw new Error('inactive');}, () => {});
  await cache.setMetadata('doc', pdf); await cache.writeBlock('doc', pdf, 0, bytes);
  const held = deferred(); f.waitRead(held.promise);
  const reading = cache.read('doc', pdf, 0, 3), rejected = assert.rejects(reading, /inactive|revoked/);
  for (let index = 0; index < 10; index++) await Promise.resolve();
  const invalidating = cache.invalidate('doc');
  for (let index = 0; index < 10; index++) await Promise.resolve();
  assert([...f.files.keys()].some(path => path.includes('/denials/denied-')));
  assert([...f.files.keys()].some(path => path.endsWith('.block')), 'Cleanup remains behind the active read lock');
  foreground = false; held.resolve(); await rejected; await invalidating;
  const restarted = new PdfBlockCache(f.storage, 'scope', () => {});
  assert.equal(await restarted.metadata('doc'), null); assert.equal(await restarted.read('doc', pdf, 0, 3), null);
  await restarted.setMetadata('doc', pdf); await restarted.writeBlock('doc', pdf, 0, bytes); assert.deepEqual(await restarted.read('doc', pdf, 0, 3), bytes);
});

test('PDF cancellation reaches native atomic publication before a queued write can replace the prior file', async () => {
  const f = await fixture(), path = 'pdf/v1/account/doc/manifest.json', controller = new AbortController(), held = deferred();
  await f.storage.writeAtomic(path, new Uint8Array([1])); f.waitWrite(held.promise);
  const writing = f.storage.writeAtomic(path, new Uint8Array([2]), controller.signal), rejected = assert.rejects(writing, {name: 'AbortError'});
  await Promise.resolve(); assert.equal(f.calls.at(-1).kind, 'block');
  controller.abort(); held.resolve(); await rejected;
  assert.deepEqual(await f.storage.read(path), new Uint8Array([1]));
});

test('a full PDF uses cancellable native publication for both staged blocks and its final manifest', async () => {
  const f = await fixture(), bytes = new Uint8Array([1, 2, 3]), controller = new AbortController();
  const pdf = {document_id: new Sha256().update(bytes).digest(), size: 3, url: '/v1/bookmark/pdf?bookmark_uid=doc', filename: 'doc.pdf', source: 'upload', text_status: 'ready'};
  const cache = new PdfBlockCache(f.storage, 'scope', () => {});
  await cache.setMetadata('doc', pdf); f.calls.length = 0;
  await cache.writeComplete('doc', pdf, (async function* () {yield bytes;})(), controller.signal);
  const writes = f.calls.filter(call => call.kind === 'block'); assert.equal(writes.length, 2);
  assert(writes[0].path.endsWith('/0.block')); assert(writes[1].path.endsWith('/manifest.json'));
  assert.equal(await cache.verify('doc', pdf), true);
});
