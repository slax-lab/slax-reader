import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {BackgroundArticleCache, PERSONAL_CACHE_SQL, COLLECTION_CACHE_SQL, LOCAL_CACHE_SQL} from '../../src/data/background-cache.ts';
import {PdfBlockCache, PDF_BLOCK_SIZE, type PdfBlockStorage, type PdfDescriptor} from '../../src/data/pdf-cache.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {DataTransportError} from '../../src/data/transport-errors.ts';
import {MemoryPreferences} from './helpers.ts';
import type {SqlDatabase} from '../../src/data/repositories.ts';

const bytes = new Uint8Array(PDF_BLOCK_SIZE * 5 + 19).map((_, index) => index % 251);
const descriptor: PdfDescriptor = {document_id: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, url: '/v1/bookmark/pdf?bookmark_uid=doc', filename: 'test.pdf', source: 'upload', text_status: 'ready'};
const deferred = <T>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(yes => {resolve = yes;}); return {promise, resolve};};
function fixture(options: {range?: (id: string, begin: number, end: number, signal: AbortSignal) => Promise<Uint8Array>; metadata?: (signal: AbortSignal) => Promise<PdfDescriptor>; count?: number; storage?: Map<string, Uint8Array>; locals?: Map<string, Record<string, unknown>>; scope?: string} = {}) {
  const files = options.storage ?? new Map<string, Uint8Array>(), locals = options.locals ?? new Map<string, Record<string, unknown>>();
  const rows = {personal: [] as Record<string, unknown>[], collection: [] as Record<string, unknown>[]};
  const listeners = new Set<() => void>();
  let active = true, html = 0, metadataCalls = 0, requests = [] as {id: string; begin: number; signal: AbortSignal}[];
  let foreground = true, beforeRead: ((path: string) => Promise<void>) | undefined, beforeRemove: (() => Promise<void>) | undefined;
  let transactionTail: Promise<unknown> = Promise.resolve(), transactionQueued = 0, transactionEntered = 0, transactionActive = false;
  const guard = () => {if (!active) throw new Error('Account revoked');};
  const foregroundGuard = () => {guard(); if (!foreground) throw new Error('App inactive');};
  const storage: PdfBlockStorage = {async read(path) {guard(); await beforeRead?.(path); guard(); return files.get(path)?.slice() ?? null;}, async writeAtomic(path, value) {guard(); files.set(path, value.slice());}, async remove(path) {guard(); files.delete(path);}, async list(prefix) {guard(); return [...files.keys()].filter(path => path.startsWith(prefix));}};
  const cache = new PdfBlockCache(storage, options.scope ?? 'https://api.test/account', foregroundGuard, guard);
  const database: SqlDatabase = {
    async getOptional<T>(_sql: string, args: unknown[] = []) {const value = locals.get(String(args[0])); return (value ? {data: JSON.stringify(value)} : null) as T | null;},
    async execute(sql, args = []) {
      if (sql.startsWith('INSERT')) locals.set(String(args[0]), JSON.parse(String(args[1])));
      else if (sql.startsWith('UPDATE')) locals.set(String(args[1]), JSON.parse(String(args[0])));
      else if (sql.startsWith('DELETE')) locals.delete(String(args[0]));
    },
    async getAll<T>() {return [] as T[];},
    writeTransaction(work) {
      transactionQueued++;
      const result = transactionTail.then(async () => {
        transactionEntered++; transactionActive = true;
        try {const value = await work(database); listeners.forEach(notify => notify()); return value;}
        finally {transactionActive = false;}
      });
      transactionTail = result.catch(() => undefined); return result;
    },
    watch(sql, _args, handler, {signal}) {
      const notify = () => {if (!signal.aborted) handler.onResult({rows: {_array: sql === PERSONAL_CACHE_SQL ? rows.personal : sql === COLLECTION_CACHE_SQL ? rows.collection : sql === LOCAL_CACHE_SQL ? [...locals].map(([id, data]) => ({id, data: JSON.stringify(data)})) : []}});};
      listeners.add(notify); signal.addEventListener('abort', () => listeners.delete(notify), {once: true}); notify();
    },
  };
  const preferences = new PreferenceStore(new MemoryPreferences({cache_count: options.count ?? 0}));
  const worker = new BackgroundArticleCache({database, preferences, assertActive: guard,
    cache: {writeArticle() {html++;}, async removeArticle(key, check) {guard(); await beforeRemove?.(); await worker.forgetPdf(key); foregroundGuard(); check?.(); await cache.remove(key, check);}, async ensureImage() {return null;}},
    async content() {return '<p>HTML</p>';}, async image() {return new Uint8Array();},
    pdf: {cache, async metadata(_id, signal) {metadataCalls++; return options.metadata ? options.metadata(signal) : descriptor;}, async range(id, _documentId, begin, end, signal, expectedSize) {
      assert.equal(expectedSize, descriptor.size);
      requests.push({id, begin, signal}); return options.range ? options.range(id, begin, end, signal) : bytes.slice(begin, end);
    }},
  });
  return {worker, cache, database, files, locals, rows, requests, preferences, get html() {return html;}, get metadataCalls() {return metadataCalls;}, get transactionQueued() {return transactionQueued;}, get transactionEntered() {return transactionEntered;}, get transactionActive() {return transactionActive;}, revoke() {active = false;}, beforeRead(callback: (path: string) => Promise<void>) {beforeRead = callback;}, beforeRemove(callback: () => Promise<void>) {beforeRemove = callback;}, pause() {foreground = false; return worker.pause();}, resume() {foreground = true; worker.resume();}, notify() {listeners.forEach(notify => notify());}};
}
async function until(check: () => boolean) {for (let i = 0; i < 100; i++) {if (check()) return; await setImmediate();} assert(check(), 'condition did not settle');}

test('manual PDF caching validates all blocks, preserves pins/positions and never downloads HTML', async () => {
  const f = fixture(); f.locals.set('doc', {read_position: '42', outline: 'keep', extra: true});
  await f.worker.cachePdf('doc');
  assert.deepEqual(await f.worker.pdfCacheStatus('doc'), {downloadedBytes: bytes.length, totalBytes: bytes.length, complete: true});
  assert.equal(f.locals.get('doc')?.is_downloaded, 2); assert.equal(f.locals.get('doc')?.is_auto_cached, 0);
  assert.equal(f.locals.get('doc')?.read_position, '42'); assert.equal(f.html, 0); assert.equal(f.requests.length, 6);
  await f.worker.stop();
});

test('visible ranges join and promote prefetch work using the same three-slot domain limit', async () => {
  const held = new Map<string, ReturnType<typeof deferred<Uint8Array>>>();
  const f = fixture({range: async (id, begin) => {const gate = deferred<Uint8Array>(); held.set(`${id}:${begin}`, gate); return gate.promise;}});
  for (const id of ['busy-a', 'busy-b', 'busy-c', 'doc']) await f.cache.setMetadata(id, descriptor);
  const occupied = ['busy-a', 'busy-b', 'busy-c'].map(id => f.worker.readPdfRange(id, descriptor, 0, 10));
  await until(() => held.size === 3);
  const first = f.worker.readPdfRange('doc', descriptor, 0, 10, undefined, undefined, false);
  const second = f.worker.readPdfRange('doc', descriptor, PDF_BLOCK_SIZE, PDF_BLOCK_SIZE + 10, undefined, undefined, false);
  await setImmediate();
  const visible = f.worker.readPdfRange('doc', descriptor, PDF_BLOCK_SIZE + 1, PDF_BLOCK_SIZE + 11);
  await setImmediate();
  assert.equal(f.requests.length, 3);
  held.get('busy-a:0')!.resolve(bytes.slice(0, PDF_BLOCK_SIZE));
  await until(() => f.requests.length === 4);
  assert.equal(f.requests[3].begin, PDF_BLOCK_SIZE);
  held.get(`doc:${PDF_BLOCK_SIZE}`)!.resolve(bytes.slice(PDF_BLOCK_SIZE, PDF_BLOCK_SIZE * 2));
  await until(() => held.has('doc:0'));
  held.get('doc:0')!.resolve(bytes.slice(0, PDF_BLOCK_SIZE));
  held.get('busy-b:0')!.resolve(bytes.slice(0, PDF_BLOCK_SIZE)); held.get('busy-c:0')!.resolve(bytes.slice(0, PDF_BLOCK_SIZE));
  await Promise.all([...occupied, first, second, visible]);
  assert.equal(f.requests.filter(request => request.id === 'doc' && request.begin === PDF_BLOCK_SIZE).length, 1);
  await f.worker.stop();
});

test('reader abort detaches its waiter without cancelling a retained manual download', async () => {
  const gate = deferred<Uint8Array>();
  const f = fixture({range: async (_id, begin, end) => begin === 0 ? gate.promise : bytes.slice(begin, end)});
  const download = f.worker.cachePdf('doc'); await until(() => f.requests.length === 1);
  const reader = new AbortController(); const read = f.worker.readPdfRange('doc', descriptor, 0, 10, undefined, reader.signal);
  reader.abort(); await assert.rejects(read, {name: 'AbortError'});
  assert.equal(f.requests[0].signal.aborted, false);
  gate.resolve(bytes.slice(0, PDF_BLOCK_SIZE)); await download;
  assert.equal((await f.worker.pdfCacheStatus('doc')).complete, true); await f.worker.stop();
});

test('pause aborts network and reader waiters, retains valid blocks and resumes missing manual ranges', async () => {
  let blocked = true;
  const f = fixture({range: async (_id, begin, end, signal) => {
    if (begin === PDF_BLOCK_SIZE && blocked) return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('network aborted')), {once: true}));
    return bytes.slice(begin, end);
  }});
  const download = f.worker.cachePdf('doc'); const rejected = assert.rejects(download);
  await until(() => f.requests.length === 2);
  const read = f.worker.readPdfRange('doc', descriptor, PDF_BLOCK_SIZE, PDF_BLOCK_SIZE + 10); const detached = assert.rejects(read, {name: 'AbortError'});
  await f.worker.pause(); await rejected; await detached;
  assert.equal((await f.cache.status('doc')).downloadedBytes, PDF_BLOCK_SIZE); assert.equal(f.locals.get('doc')?.is_downloaded, 1);
  blocked = false; f.worker.resume(); await f.worker.settled();
  assert.equal((await f.worker.pdfCacheStatus('doc')).complete, true);
  assert.equal(f.requests.filter(request => request.begin === 0).length, 1); await f.worker.stop();
});

test('restart resumes a persisted manual pin outside the automatic cache window', async () => {
  const old = fixture(); await old.cache.setMetadata('doc', descriptor); await old.cache.writeBlock('doc', descriptor, 0, bytes.slice(0, PDF_BLOCK_SIZE));
  old.locals.set('doc', {is_auto_cached: 0, is_downloaded: 1, pdf_cache: {id: 'doc', owner: null}, read_position: '9'});
  await old.worker.stop();
  const next = fixture({storage: old.files, locals: old.locals, count: 0}); next.worker.start(); await next.worker.settled();
  assert.equal((await next.worker.pdfCacheStatus('doc')).complete, true); assert.equal(next.requests.some(request => request.begin === 0), false);
  assert.equal(next.locals.get('doc')?.read_position, '9'); await next.worker.stop();
});

test('automatic personal and collection PDFs use type mappings and owner-specific limits', async () => {
  const f = fixture({count: 1});
  f.rows.personal.push({id: 'doc', status: 'success', content_type: 2}, {id: 'ignored', status: 'success', content_type: 2});
  f.rows.collection.push({id: 'doc', owner_id: 'owner', status: 'success', content_type: 'pdf'});
  f.worker.start(); await f.worker.settled();
  assert.equal(f.html, 0); assert.equal(f.locals.get('doc')?.is_auto_cached, 1);
  assert.equal(f.locals.get('collection-owner-doc')?.is_downloaded, 2); assert.equal(f.locals.has('ignored'), false);
  assert.equal(f.requests.length, 12); await f.worker.stop();
});

test('cached descriptors are offline-only fallback, authorization failure clears blocks and prevents fallback', async () => {
  let error: unknown = new DataTransportError('network', 'pdf-metadata');
  const f = fixture({metadata: async () => {throw error;}});
  await f.cache.setMetadata('collection-owner-doc', descriptor); await f.cache.writeBlock('collection-owner-doc', descriptor, 0, bytes.slice(0, PDF_BLOCK_SIZE));
  assert.deepEqual(await f.worker.getPdfMetadata('doc', 'owner'), descriptor);
  error = Object.assign(new Error('Denied'), {status: 403});
  await assert.rejects(f.worker.getPdfMetadata('doc', 'owner'), /Denied/);
  assert.equal(await f.cache.metadata('collection-owner-doc'), null);
  error = new TypeError('Offline'); await assert.rejects(f.worker.getPdfMetadata('doc', 'owner'), /Offline/);
  await assert.rejects(f.worker.readPdfRange('doc', descriptor, 0, 10, 'owner'), /revoked/); await f.worker.stop();
});

test('account cancellation rejects readers immediately and late bytes never commit', async () => {
  const gate = deferred<Uint8Array>(); const f = fixture({range: () => gate.promise});
  await f.cache.setMetadata('doc', descriptor);
  const reading = f.worker.readPdfRange('doc', descriptor, 0, 10); const rejected = assert.rejects(reading, {name: 'AbortError'});
  await until(() => f.requests.length === 1); f.worker.cancel(); f.revoke(); await rejected;
  gate.resolve(bytes.slice(0, PDF_BLOCK_SIZE)); await f.worker.stop();
  assert.equal([...f.files.keys()].some(key => key.endsWith('.block')), false);
});

test('a range authorization failure discards previously cached bytes', async () => {
  const f = fixture({range: async () => {throw Object.assign(new Error('Forbidden'), {status: 403});}});
  await f.cache.setMetadata('doc', descriptor); await f.cache.writeBlock('doc', descriptor, 0, bytes.slice(0, PDF_BLOCK_SIZE));
  await assert.rejects(f.worker.readPdfRange('doc', descriptor, PDF_BLOCK_SIZE, PDF_BLOCK_SIZE + 10), /Forbidden/);
  await f.worker.settled(); assert.equal(await f.cache.metadata('doc'), null); await f.worker.stop();
});

test('checksum failure never reports completion and a manual retry replaces corrupt blocks', async () => {
  let corrupt = true;
  const f = fixture({range: async (_id, begin, end) => {const result = bytes.slice(begin, end); if (corrupt) result[0] ^= 1; return result;}});
  await assert.rejects(f.worker.cachePdf('doc'), /checksum/);
  assert.equal(f.locals.get('doc')?.is_downloaded, 3); assert.equal((await f.worker.pdfCacheStatus('doc')).complete, false);
  corrupt = false; await f.worker.cachePdf('doc'); assert.equal((await f.worker.pdfCacheStatus('doc')).complete, true); await f.worker.stop();
});

test('clearing a retained download aborts work and prevents late completion or block resurrection', async () => {
  const gate = deferred<Uint8Array>(); const f = fixture({range: () => gate.promise});
  const download = f.worker.cachePdf('doc'); const rejected = assert.rejects(download, {name: 'AbortError'});
  await until(() => f.requests.length === 1);
  const forgotten = f.worker.forgetPdf('doc'); gate.resolve(bytes.slice(0, PDF_BLOCK_SIZE)); await forgotten; await rejected;
  await f.cache.remove('doc');
  assert.equal((await f.worker.pdfCacheStatus('doc')).downloadedBytes, 0); assert.notEqual(f.locals.get('doc')?.is_downloaded, 2); await f.worker.stop();
});

test('automatic PDF eviction preserves non-file collection state', async () => {
  const f = fixture({count: 1}); f.rows.collection.push({id: 'doc', owner_id: 'owner', status: 'success', content_type: 'pdf'});
  f.locals.set('collection-owner-doc', {read_position: '20', mark_users: 'profiles', future_field: 'keep'});
  f.worker.start(); await f.worker.settled(); await f.preferences.update(values => {values.cache_count = 0;}); await f.worker.settled();
  assert.equal(await f.cache.metadata('collection-owner-doc'), null);
  assert.equal(f.locals.get('collection-owner-doc')?.read_position, '20'); assert.equal(f.locals.get('collection-owner-doc')?.mark_users, 'profiles');
  assert.equal(f.locals.get('collection-owner-doc')?.is_downloaded, 0); await f.worker.stop();
});

test('runtime-shaped eviction callback allows automatic recaching when the limit increases', async () => {
  for (const collection of [false, true]) {
    const f = fixture({count: 1});
    (collection ? f.rows.collection : f.rows.personal).push({id: 'doc', ...(collection ? {owner_id: 'owner'} : {}), status: 'success', content_type: 2});
    const key = collection ? 'collection-owner-doc' : 'doc';
    f.worker.start(); await f.worker.settled(); assert.equal(f.requests.length, 6);
    await f.preferences.update(values => {values.cache_count = 0;}); await f.worker.settled();
    assert.equal(await f.cache.metadata(key), null);
    await f.preferences.update(values => {values.cache_count = 1;}); await f.worker.settled();
    assert.equal(f.requests.length, 12); assert.equal((await f.cache.status(key)).complete, true);
    await f.worker.stop();
  }
});

test('denial persists before a held read drains and survives pause plus offline restart', async () => {
  const f = fixture({metadata: async () => {throw Object.assign(new Error('Denied'), {status: 403});}});
  const key = 'collection-owner-doc';
  await f.cache.setMetadata(key, descriptor); await f.cache.writeBlock(key, descriptor, 0, bytes.slice(0, PDF_BLOCK_SIZE));
  const started = deferred<void>(), release = deferred<void>();
  f.beforeRead(async path => {if (path.endsWith('.block')) {started.resolve(); await release.promise;}});
  const reading = f.cache.read(key, descriptor, 0, 3), readRejected = assert.rejects(reading, /inactive|revoked/);
  await started.promise;
  const metadata = f.worker.getPdfMetadata('doc', 'owner'), metadataRejected = assert.rejects(metadata, /Denied|cancelled/);
  await until(() => [...f.files.keys()].some(path => /denied-\d+-\d+\.json$/.test(path)));
  assert([...f.files.keys()].some(path => path.endsWith('.block')), 'Cleanup must still be waiting on the held read');
  const interruptedSnapshot = new Map(f.files), paused = f.pause();
  const restarted = fixture({storage: interruptedSnapshot, metadata: async () => {throw new TypeError('Offline');}, range: async () => {throw new TypeError('Offline');}});
  await assert.rejects(restarted.worker.getPdfMetadata('doc', 'owner'), /Offline/);
  assert.equal(await restarted.cache.metadata(key), null);
  assert.equal(await restarted.cache.read(key, descriptor, 0, 3), null);
  await assert.rejects(restarted.worker.readPdfRange('doc', descriptor, 0, 3, 'owner'), /Offline/);
  assert.equal((await restarted.worker.pdfCacheStatus('doc', 'owner')).complete, false);
  release.resolve(); await readRejected; await paused; await metadataRejected;
  assert.equal([...f.files.keys()].filter(path => path.endsWith('.block') || path.endsWith('/manifest.json')).length, 0);
  assert([...f.files.keys()].some(path => /denied-\d+-\d+\.json$/.test(path)));
  await restarted.worker.stop(); await f.worker.stop();
  const authorized = fixture({storage: f.files});
  assert.deepEqual(await authorized.worker.getPdfMetadata('doc', 'owner'), descriptor);
  assert.equal([...authorized.files.keys()].some(path => /denied-\d+-\d+\.json$/.test(path)), false);
  assert.deepEqual(await authorized.worker.readPdfRange('doc', descriptor, 0, 3, 'owner'), bytes.slice(0, 3));
  await authorized.worker.stop();
});

test('account revocation fences delayed denial cleanup without erasing its durable marker', async () => {
  const f = fixture({metadata: async () => {throw Object.assign(new Error('Denied'), {status: 403});}});
  await f.cache.setMetadata('doc', descriptor); await f.cache.writeBlock('doc', descriptor, 0, bytes.slice(0, PDF_BLOCK_SIZE));
  const started = deferred<void>(), release = deferred<void>();
  f.beforeRead(async path => {if (path.endsWith('.block')) {started.resolve(); await release.promise;}});
  const reading = f.cache.read('doc', descriptor, 0, 3), readRejected = assert.rejects(reading, /revoked/); await started.promise;
  const metadata = f.worker.getPdfMetadata('doc'), denied = assert.rejects(metadata);
  await until(() => [...f.files.keys()].some(path => /denied-\d+-\d+\.json$/.test(path)));
  f.worker.cancel(); f.revoke();
  const before = new Map(f.files); release.resolve(); await readRejected; await denied; await f.worker.stop();
  assert.deepEqual(f.files, before, 'Revoked cleanup cannot mutate the next account scope');
  const resumed = fixture({storage: f.files, metadata: async () => {throw new TypeError('Offline');}});
  await assert.rejects(resumed.worker.getPdfMetadata('doc'), /Offline/); assert.equal(await resumed.cache.read('doc', descriptor, 0, 3), null);
  await resumed.worker.stop();
});

test('eviction drains a denied PDF job before taking the serialized database writer', {timeout: 5000}, async () => {
  const requested = deferred<void>(), denial = deferred<void>();
  const f = fixture({metadata: async () => {requested.resolve(); await denial.promise; throw Object.assign(new Error('Denied'), {status: 403});}});
  f.rows.personal.push({id: 'doc', status: 'success', content_type: 2});
  f.locals.set('doc', {is_auto_cached: 1, is_downloaded: 2, read_position: 'keep'});
  await f.cache.setMetadata('doc', descriptor); await f.cache.writeBlock('doc', descriptor, 0, bytes.slice(0, PDF_BLOCK_SIZE));
  const metadata = f.worker.getPdfMetadata('doc'), rejected = assert.rejects(metadata);
  await requested.promise;
  const draining = deferred<void>(), forget = f.worker.forgetPdf.bind(f.worker);
  f.worker.forgetPdf = async key => {
    assert.equal(f.transactionActive, false, 'Relevant jobs must be drained before entering the database writer');
    draining.resolve(); await forget(key);
  };
  f.worker.start(); await draining.promise; denial.resolve();
  await rejected; await f.worker.settled();
  assert.equal(f.transactionQueued, f.transactionEntered);
  assert.equal(f.locals.get('doc')?.is_downloaded, 0); assert.equal(f.locals.get('doc')?.read_position, 'keep');
  assert.equal(await f.cache.metadata('doc'), null); await f.worker.stop();
});

test('eviction rechecks a newly pinned row after draining jobs and acquiring the database writer', {timeout: 5000}, async () => {
  const f = fixture(); f.rows.personal.push({id: 'doc', status: 'success', content_type: 2});
  f.locals.set('doc', {is_auto_cached: 1, is_downloaded: 2});
  await f.cache.setMetadata('doc', descriptor); await f.cache.writeBlock('doc', descriptor, 0, bytes.slice(0, PDF_BLOCK_SIZE));
  const entered = deferred<void>(), release = deferred<void>();
  const pin = f.database.writeTransaction(async tx => {
    entered.resolve(); await release.promise;
    await tx.execute('INSERT', ['doc', JSON.stringify({is_auto_cached: 0, is_downloaded: 2})]);
  });
  await entered.promise; f.worker.start(); await until(() => f.transactionQueued === 2);
  release.resolve(); await pin; await f.worker.settled();
  assert.equal(f.locals.get('doc')?.is_auto_cached, 0); assert.deepEqual(await f.cache.read('doc', descriptor, 0, 3), bytes.slice(0, 3));
  await f.worker.stop();
});

test('reader and manual retention arriving during eviction stop file deletion', {timeout: 5000}, async () => {
  for (const retention of ['reader', 'manual'] as const) {
    const f = fixture(); f.rows.personal.push({id: 'doc', status: 'success', content_type: 2});
    f.locals.set('doc', {is_auto_cached: 1, is_downloaded: 2});
    await f.cache.setMetadata('doc', descriptor); await f.cache.writeBlock('doc', descriptor, 0, bytes.slice(0, PDF_BLOCK_SIZE));
    const removing = deferred<void>(), release = deferred<void>();
    f.beforeRemove(async () => {removing.resolve(); await release.promise;});
    f.worker.start(); await removing.promise;
    const stopReading = retention === 'reader' ? f.worker.beginForeground('doc') : undefined;
    const pin = retention === 'manual' ? f.worker.cachePdf('doc') : undefined;
    release.resolve(); await pin; await f.worker.settled();
    assert.deepEqual(await f.cache.read('doc', descriptor, 0, 3), bytes.slice(0, 3));
    if (retention === 'manual') {assert.equal(f.locals.get('doc')?.is_auto_cached, 0); assert.equal(f.requests.some(request => request.begin === 0), false);}
    await f.worker.stop(); stopReading?.();
  }
});

test('forgetting a prefetch held in a cache read drains it without scheduling replacement work', {timeout: 5000}, async () => {
  const f = fixture(), entered = deferred<void>(), release = deferred<void>();
  const download = f.worker.cachePdf('doc'), rejected = assert.rejects(download, {name: 'AbortError'});
  f.beforeRead(async path => {if (path.endsWith('.block')) {entered.resolve(); await release.promise;}});
  await entered.promise;
  const forgotten = f.worker.forgetPdf('doc'); release.resolve();
  await forgotten; await rejected;
  assert.equal(f.requests.length, 0); await f.worker.stop();
});

test('admitted PDF cache tolerates offline credential backoff but not known reauthentication or paused credentials', async () => {
  const {OfflineCredentialError, ReauthenticationRequiredError, CredentialsUnavailableError} = await import('../../src/domain/credential-readiness.ts');
  let error: Error = new OfflineCredentialError();
  const f = fixture({metadata: async () => {throw error;}});
  await f.cache.setMetadata('doc', descriptor); await f.cache.writeBlock('doc', descriptor, 0, bytes.slice(0, PDF_BLOCK_SIZE));
  assert.deepEqual(await f.worker.getPdfMetadata('doc'), descriptor);
  assert.deepEqual(await f.worker.readPdfRange('doc', descriptor, 0, 10), bytes.slice(0, 10));
  error = new ReauthenticationRequiredError(); await assert.rejects(f.worker.getPdfMetadata('doc'), ReauthenticationRequiredError);
  error = new CredentialsUnavailableError(); await assert.rejects(f.worker.getPdfMetadata('doc'), CredentialsUnavailableError);
  assert.equal(f.requests.length, 0); await f.worker.stop();
});
