import test from 'node:test';
import assert from 'node:assert/strict';
import {loadComponent} from '../reader/parity-host.mjs';
import {Sha256} from '../../src/data/pdf-sha256.ts';
import {PdfBlockCache} from '../../src/data/pdf-cache.ts';

async function fixture() {
  const files = new Map(), directories = new Set(); let active = true, denied = false, failMove = false, counter = 0, afterMove, moveWait, readWait, asyncMoves = 0, syncMoves = 0;
  const guard = () => {if (!active) throw new Error('revoked');};
  class Directory {
    constructor(uri) {this.uri = uri;}
    get name() {return this.uri.split('/').at(-1);}
    get exists() {return directories.has(this.uri);}
    create() {const parts = this.uri.split('/'); for (let i = 4; i <= parts.length; i++) directories.add(parts.slice(0, i).join('/'));}
    list() {
      const prefix = `${this.uri}/`, direct = uri => uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/');
      return [...[...directories].filter(direct).map(uri => new Directory(uri)), ...[...files.keys()].filter(direct).map(uri => new File(uri))];
    }
    delete() {for (const path of files.keys()) if (path.startsWith(`${this.uri}/`)) files.delete(path); for (const path of directories) if (path === this.uri || path.startsWith(`${this.uri}/`)) directories.delete(path);}
  }
  class File {
    constructor(uri) {this.uri = uri;}
    get name() {return this.uri.split('/').at(-1);}
    get exists() {return files.has(this.uri);}
    get size() {return files.get(this.uri)?.length ?? 0;}
    get parentDirectory() {return new Directory(this.uri.slice(0, this.uri.lastIndexOf('/')));}
    create() {assert(!files.has(this.uri)); files.set(this.uri, new Uint8Array());}
    write(bytes) {files.set(this.uri, bytes.slice());}
    async bytes() {await readWait; return files.get(this.uri)?.slice();}
    async move(target, options) {asyncMoves++; await moveWait; this.relocate(target, options);}
    moveSync(target, options) {syncMoves++; this.relocate(target, options);}
    relocate(target, options) {assert.equal(options, undefined, 'Never use the non-atomic overwrite operation'); if (failMove) throw new Error('interrupted move'); assert(files.has(this.uri), 'NoSuchFileException'); assert(!files.has(target.uri)); files.set(target.uri, files.get(this.uri)); files.delete(this.uri); this.uri = target.uri; afterMove?.();}
    delete() {files.delete(this.uri);}
  }
  const {PdfFileStorage} = await loadComponent('../../src/data/pdf-file-storage.ts', {
    'expo-file-system': {Directory, File}, 'expo-modules-core': {uuid: {v4: () => `unique-${counter++}`}, requireNativeModule: () => ({pdfCacheFileUri: (_directory, path) => denied ? null : `file:///app/${path}`})}, './pdf-sha256.ts': {Sha256},
  }, {TextEncoder});
  return {storage: new PdfFileStorage('/app', guard), files, deny() {denied = true;}, revoke() {active = false;}, failMove() {failMove = true;}, afterMove(callback) {afterMove = callback;}, waitMove(promise) {moveWait = promise;}, waitRead(promise) {readWait = promise;}, get asyncMoves() {return asyncMoves;}, get syncMoves() {return syncMoves;}, nextAccount() {return new PdfFileStorage('/app');}};
}

test('atomic PDF replacement keeps a prior committed generation if move is interrupted', async () => {
  const f = await fixture(), path = 'pdf/v1/account/doc/manifest.json';
  await f.storage.writeAtomic(path, new Uint8Array([1])); f.failMove();
  await assert.rejects(f.storage.writeAtomic(path, new Uint8Array([2])), /interrupted/);
  assert.deepEqual(await f.storage.read(path), new Uint8Array([1]));
  assert.equal([...f.files.keys()].some(path => path.endsWith('.tmp')), false);
  assert.deepEqual(Array.from(await f.storage.list('pdf/v1/account/doc/')), [path]);
});

test('committed newest generation survives interrupted cleanup and is chosen deterministically', async () => {
  const f = await fixture(), path = 'pdf/v1/account/doc/manifest.json';
  await f.storage.writeAtomic(path, new Uint8Array([1]));
  f.afterMove(() => {throw new Error('interrupted cleanup');});
  await assert.rejects(f.storage.writeAtomic(path, new Uint8Array([2])), /interrupted cleanup/);
  assert.deepEqual(await f.storage.read(path), new Uint8Array([2]));
  await f.storage.remove(path); assert.equal(await f.storage.read(path), null);
});

test('storage bounds paths, native containment denial and revoked scopes before file access', async () => {
  const f = await fixture();
  for (const path of ['/pdf/file', 'pdf/../foreign', 'pdf//file', 'pdf/%2f/file', 'bookmark/doc']) await assert.rejects(f.storage.read(path), /Invalid/);
  f.deny(); await assert.rejects(f.storage.writeAtomic('pdf/v1/account/doc', new Uint8Array([1])), /Unsafe/);
  assert.equal(f.files.size, 0);
  const old = await fixture(); old.revoke(); await assert.rejects(old.storage.read('pdf/v1/account/doc'), /revoked/);
});

test('a delayed Promise-based native move cannot outlive synchronous commit or repopulate logout cleanup', async () => {
  const f = await fixture(), path = 'pdf/v1/account-a/doc/manifest.json';
  let release; f.waitMove(new Promise(resolve => {release = resolve;}));
  try {
    await f.storage.writeAtomic(path, new Uint8Array([1]));
    await f.storage.writeAtomic(path, new Uint8Array([2]));
    assert.equal(f.asyncMoves, 0); assert.equal(f.syncMoves, 2);
    assert.deepEqual(await f.storage.read(path), new Uint8Array([2]));
    assert.equal(f.files.size, 1);
    f.revoke(); const next = f.nextAccount(); next.clear();
    const nextPath = 'pdf/v1/account-b/doc/manifest.json';
    await next.writeAtomic(nextPath, new Uint8Array([3]));
    release(); await Promise.resolve(); await Promise.resolve();
    assert.equal(await next.read(path), null);
    assert.deepEqual(await next.read(nextPath), new Uint8Array([3]));
    assert.equal(f.files.size, 1);
  } finally {release();}
});

test('revocation during an awaited native read cannot return the next account data', async () => {
  const f = await fixture(), path = 'pdf/v1/account/doc/manifest.json';
  await f.storage.writeAtomic(path, new Uint8Array([1]));
  let release; f.waitRead(new Promise(resolve => {release = resolve;}));
  const pending = f.storage.read(path), rejected = assert.rejects(pending, /revoked/);
  f.revoke(); const next = f.nextAccount(); next.clear();
  const nextPath = 'pdf/v1/new-account/doc/manifest.json';
  await next.writeAtomic(nextPath, new Uint8Array([2]));
  release(); await rejected;
  assert.deepEqual(await next.read(nextPath), new Uint8Array([2]));
});

test('revocation after synchronous native rename prevents old-generation cleanup', async () => {
  const f = await fixture(), path = 'pdf/v1/account/doc/manifest.json';
  await f.storage.writeAtomic(path, new Uint8Array([1]));
  f.afterMove(() => f.revoke());
  await assert.rejects(f.storage.writeAtomic(path, new Uint8Array([2])), /revoked/);
  assert.equal(f.files.size, 2, 'A revoked adapter must not delete any committed generation');
});

test('the Expo adapter synchronously commits a denial marker before waiting for a held cache read', async () => {
  const f = await fixture(), bytes = new Uint8Array([1, 2, 3]); let foreground = true;
  const pdf = {document_id: new Sha256().update(bytes).digest(), size: 3, url: '/v1/bookmark/pdf?bookmark_uid=doc', filename: 'doc.pdf', source: 'upload', text_status: 'ready'};
  const cache = new PdfBlockCache(f.storage, 'scope', () => {if (!foreground) throw new Error('inactive');}, () => {});
  await cache.setMetadata('doc', pdf); await cache.writeBlock('doc', pdf, 0, bytes);
  let release; f.waitRead(new Promise(resolve => {release = resolve;}));
  const reading = cache.read('doc', pdf, 0, 3), rejected = assert.rejects(reading, /inactive|revoked/);
  for (let index = 0; index < 10; index++) await Promise.resolve();
  const invalidating = cache.invalidate('doc');
  assert([...f.files.keys()].some(path => path.includes('/denials/denied-') && path.endsWith('.data')), 'Tombstone is committed before invalidate yields');
  foreground = false; release(); await rejected; await invalidating;
  const restarted = new PdfBlockCache(f.storage, 'scope', () => {});
  assert.equal(await restarted.metadata('doc'), null); assert.equal(await restarted.read('doc', pdf, 0, 3), null);
  assert.equal([...f.files.keys()].some(path => path.includes('.block.entries/')), false);
  await restarted.setMetadata('doc', pdf); await restarted.writeBlock('doc', pdf, 0, bytes);
  assert.deepEqual(await restarted.read('doc', pdf, 0, 3), bytes);
});
