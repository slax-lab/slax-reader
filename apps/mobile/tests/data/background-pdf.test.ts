import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {setImmediate} from 'node:timers/promises';
import {BackgroundArticleCache, PERSONAL_CACHE_SQL, COLLECTION_CACHE_SQL, LOCAL_CACHE_SQL} from '../../src/data/background-cache.ts';
import {PdfBlockCache, PDF_BLOCK_SIZE, type PdfBlockStorage, type PdfDescriptor} from '../../src/data/pdf-cache.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {DataTransportError} from '../../src/data/transport-errors.ts';
import {createMobileApi} from '../../src/data/api.ts';
import {MemoryPreferences} from './helpers.ts';
import type {SqlDatabase} from '../../src/data/repositories.ts';

const bytes = new Uint8Array(PDF_BLOCK_SIZE * 5 + 19).map((_, index) => index % 251);
const descriptor: PdfDescriptor = {document_id: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, url: '/v1/bookmark/pdf?bookmark_uid=doc', filename: 'test.pdf', source: 'upload', text_status: 'ready'};
const deferred = <T>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(yes => {resolve = yes;}); return {promise, resolve};};
function fixture(options: {fetch?: typeof globalThis.fetch; range?: (id: string, begin: number, end: number, signal: AbortSignal) => Promise<Uint8Array>; metadata?: (signal: AbortSignal) => Promise<PdfDescriptor>; count?: number; storage?: Map<string, Uint8Array>; locals?: Map<string, Record<string, unknown>>; scope?: string; assertCachedAccess?: () => void; now?: () => number} = {}) {
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
    async getOptional<T>(sql: string, args: unknown[] = []) {
      const sqlite = new DatabaseSync(':memory:');
      try {
        sqlite.exec('CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY, data TEXT)');
        const insert = sqlite.prepare('INSERT INTO ps_data_local__local_bookmark_info VALUES (?, ?)');
        for (const [id, data] of locals) insert.run(id, JSON.stringify(data));
        return sqlite.prepare(sql).get(...args as (string | number | null)[]) as T ?? null;
      } finally {sqlite.close();}
    },
    async execute(sql, args = []) {
      const sqlite = new DatabaseSync(':memory:');
      try {
        sqlite.exec('CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY, data TEXT)');
        const insert = sqlite.prepare('INSERT INTO ps_data_local__local_bookmark_info VALUES (?, ?)');
        for (const [id, data] of locals) insert.run(id, JSON.stringify(data));
        const result = sqlite.prepare(sql).run(...args as (string | number | null)[]);
        const next = sqlite.prepare('SELECT id, data FROM ps_data_local__local_bookmark_info').all();
        locals.clear();
        for (const row of next) locals.set(String(row.id), JSON.parse(String(row.data)));
        return result;
      } finally {sqlite.close();}
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
    watch(sql, args, handler, {signal}) {
      const notify = () => {
        if (signal.aborted) return;
        if (sql === PERSONAL_CACHE_SQL || sql === COLLECTION_CACHE_SQL) {handler.onResult({rows: {_array: sql === PERSONAL_CACHE_SQL ? rows.personal : rows.collection}}); return;}
        const sqlite = new DatabaseSync(':memory:');
        try {
          sqlite.exec('CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY, data TEXT)');
          const insert = sqlite.prepare('INSERT INTO ps_data_local__local_bookmark_info VALUES (?, ?)');
          for (const [id, data] of locals) insert.run(id, JSON.stringify(data));
          handler.onResult({rows: {_array: sqlite.prepare(sql).all(...args as (string | number | null)[])}});
        } finally {sqlite.close();}
      };
      listeners.add(notify); signal.addEventListener('abort', () => listeners.delete(notify), {once: true}); notify();
    },
  };
  const preferences = new PreferenceStore(new MemoryPreferences({cache_count: options.count ?? 0}));
  const api = options.fetch ? createMobileApi({baseUrl: 'https://api.test', platform: 'ios', version: 'test', fetch: options.fetch, sleep: async () => {},
    sessions: {async getSession() {guard(); return {userId: 'account', token: 'test-token', refreshedAt: 0};}, async clearIfMatches() {return false;}, captureIdentity: () => guard}}) : undefined;
  const worker = new BackgroundArticleCache({database, preferences, assertActive: guard, assertCachedAccess: options.assertCachedAccess, now: options.now, random: () => 1,
    cache: {async writeArticle() {html++;}, async removeArticle(key, check) {guard(); await beforeRemove?.(); await worker.forgetPdf(key); foregroundGuard(); check?.(); await cache.remove(key, check);}, async ensureImage() {return null;}},
    async content() {return '<p>HTML</p>';}, async image() {return new Uint8Array();},
    pdf: {cache, async metadata(_id, signal) {metadataCalls++; return options.metadata ? options.metadata(signal) : descriptor;},
      acquire: api ? (id, descriptor, begin, end, complete, signal) => {requests.push({id, begin, signal}); return api.acquirePdf(id, descriptor, begin, end, complete, signal);} : undefined,
      async range(id, _documentId, begin, end, signal, expectedSize) {
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
    await tx.execute('INSERT INTO ps_data_local__local_bookmark_info (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', ['doc', JSON.stringify({is_auto_cached: 0, is_downloaded: 2})]);
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

test('last PDF range consumer cancellation aborts transport and rejects its late unretained bytes', async () => {
  const gate = deferred<Uint8Array>(), f = fixture({range: () => gate.promise});
  await f.cache.setMetadata('doc', descriptor);
  const controller = new AbortController();
  const reading = f.worker.readPdfRange('doc', descriptor, 0, 10, undefined, controller.signal), rejected = assert.rejects(reading, {name: 'AbortError'});
  await until(() => f.requests.length === 1); controller.abort(); await rejected;
  assert.equal(f.requests[0].signal.aborted, true);
  gate.resolve(bytes.slice(0, PDF_BLOCK_SIZE)); await f.worker.settled();
  assert.equal(await f.cache.read('doc', descriptor, 0, 10), null); await f.worker.stop();
});

test('last PDF metadata consumer cancellation aborts acquisition without persisting a late descriptor', async () => {
  const gate = deferred<PdfDescriptor>(); let transport: AbortSignal | undefined;
  const f = fixture({metadata: signal => {transport = signal; return gate.promise;}}), controller = new AbortController();
  const metadata = f.worker.getPdfMetadata('doc', undefined, controller.signal), rejected = assert.rejects(metadata, {name: 'AbortError'});
  await until(() => !!transport); controller.abort(); await rejected; assert.equal(transport?.aborted, true);
  gate.resolve(descriptor); await f.worker.settled(); assert.equal(await f.cache.metadata('doc'), null); await f.worker.stop();
});

test('known offline PDF opens admitted metadata and cached bytes without calling a stalled remote service', async () => {
  const f = fixture({metadata: async () => assert.fail('Known offline must not call metadata')});
  await f.cache.setMetadata('doc', descriptor); await f.cache.writeBlock('doc', descriptor, 0, bytes.slice(0, PDF_BLOCK_SIZE));
  await f.worker.setOnline(false);
  assert.deepEqual(await f.worker.getPdfMetadata('doc'), descriptor);
  assert.deepEqual(await f.worker.readPdfRange('doc', descriptor, 0, 10), bytes.slice(0, 10));
  await assert.rejects(f.worker.getPdfMetadata('missing'), {code: 'network_unavailable'});
  await assert.rejects(f.worker.readPdfRange('doc', descriptor, PDF_BLOCK_SIZE, PDF_BLOCK_SIZE + 10), {code: 'network_unavailable'});
  assert.equal(f.metadataCalls, 0); assert.equal(f.requests.length, 0); await f.worker.stop();
});

test('offline metadata cannot bypass known denial, revoked account, paused lifecycle or cached access guard', async () => {
  const denied = fixture({metadata: async () => {throw Object.assign(new Error('Denied'), {status: 403});}});
  await denied.cache.setMetadata('doc', descriptor); await assert.rejects(denied.worker.getPdfMetadata('doc'), /Denied/);
  await denied.worker.setOnline(false); await assert.rejects(denied.worker.getPdfMetadata('doc'), /revoked/); await denied.worker.stop();
  let rejected = false;
  const f = fixture({assertCachedAccess: () => {if (rejected) throw new Error('reauthentication-required');}});
  await f.cache.setMetadata('doc', descriptor); await f.cache.writeBlock('doc', descriptor, 0, bytes.slice(0, PDF_BLOCK_SIZE));
  await f.worker.setOnline(false); rejected = true;
  await assert.rejects(f.worker.getPdfMetadata('doc'), /reauthentication-required/);
  await assert.rejects(f.worker.readPdfRange('doc', descriptor, 0, 10), /reauthentication-required/);
  rejected = false; await f.worker.pause(); await assert.rejects(f.worker.getPdfMetadata('doc'), {name: 'AbortError'});
  f.worker.resume(); f.revoke(); await assert.rejects(f.worker.getPdfMetadata('doc'), /revoked/); await f.worker.stop();
});

test('offline metadata rejects account replacement during the admitted disk read', async () => {
  const f = fixture(), entered = deferred<void>(), release = deferred<void>();
  await f.cache.setMetadata('doc', descriptor); await f.worker.setOnline(false);
  f.beforeRead(async path => {if (path.endsWith('manifest.json')) {entered.resolve(); await release.promise;}});
  const reading = f.worker.getPdfMetadata('doc'), rejected = assert.rejects(reading, /revoked/);
  await entered.promise; f.revoke(); release.resolve(); await rejected; assert.equal(f.metadataCalls, 0); await f.worker.stop();
});

test('network loss suspends automatic PDF fill and reconnect resumes missing ranges without failing the body', async () => {
  let blocked = true;
  const f = fixture({count: 1, range: async (_id, begin, end, signal) => {
    if (begin === PDF_BLOCK_SIZE && blocked) await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('offline')), {once: true}));
    return bytes.slice(begin, end);
  }});
  f.rows.personal.push({id: 'doc', status: 'success', content_type: 2}); f.worker.start(); await until(() => f.requests.length === 2);
  await f.worker.setOnline(false); assert.equal(f.locals.get('doc')?.is_downloaded, 1);
  assert.equal((await f.cache.status('doc')).downloadedBytes, PDF_BLOCK_SIZE);
  blocked = false; await f.worker.setOnline(true); await f.worker.settled();
  assert.equal((await f.cache.status('doc')).complete, true); assert.equal(f.requests.filter(request => request.begin === 0).length, 1);
  await f.worker.stop();
});

test('automatic PDF retry persists its deadline across restart and reuses completed blocks', async () => {
  let now = 1000;
  const first = fixture({count: 1, now: () => now, range: async (_id, begin, end) => {if (begin === PDF_BLOCK_SIZE) throw Object.assign(new Error('rate limited'), {status: 429, retryAfterMs: 60_000}); return bytes.slice(begin, end);}});
  first.rows.personal.push({id: 'doc', status: 'success', content_type: 2}); first.worker.start(); await first.worker.settled();
  assert.equal(first.locals.get('doc')?.is_downloaded, 3); assert.equal((await first.cache.status('doc')).downloadedBytes, PDF_BLOCK_SIZE);
  const retry = first.locals.get('doc')?._slax_offline_retry as {retryAt: number; attempts: number};
  assert.equal(retry.retryAt, 61_000); assert.equal(retry.attempts, 1); await first.worker.stop();
  const next = fixture({count: 1, storage: first.files, locals: first.locals, now: () => now});
  try {
    next.rows.personal.push({id: 'doc', status: 'success', content_type: 2}); next.worker.start(); await next.worker.settled(); assert.equal(next.requests.length, 0);
    now = 60_999; await next.worker.pause(); next.worker.resume(); await next.worker.settled(); assert.equal(next.requests.length, 0);
    now = 61_000; await next.worker.pause(); next.worker.resume(); await next.worker.settled();
    assert.equal((await next.cache.status('doc')).complete, true); assert.equal(next.requests.some(request => request.begin === 0), false);
    assert.equal(next.locals.get('doc')?._slax_offline_retry, undefined);
  } finally {await next.worker.stop();}
});

test('automatic PDF denial and integrity failures cannot retry after pause or process restart', async () => {
  for (const failure of ['denied', 'integrity']) {
    const first = fixture({count: 1, now: () => 1000, range: async (_id, begin, end) => {
      if (failure === 'denied') throw Object.assign(new Error('denied'), {status: 403});
      const result = bytes.slice(begin, end); result[0] ^= 1; return result;
    }});
    first.rows.personal.push({id: 'doc', status: 'success', content_type: 2}); first.worker.start(); await first.worker.settled();
    assert.equal((first.locals.get('doc')?._slax_offline_retry as {state: string}).state, 'denied'); await first.worker.stop();
    const next = fixture({count: 1, storage: first.files, locals: first.locals, now: () => 1_001_000, metadata: async () => assert.fail('Denied automatic PDF cannot retry')});
    try {
      next.rows.personal.push({id: 'doc', status: 'success', content_type: 2}); next.worker.start(); await next.worker.settled();
      await next.worker.pause(); next.worker.resume(); await next.worker.settled(); assert.equal(next.requests.length, 0);
    } finally {await next.worker.stop();}
  }
});

function completeResponse(value = bytes, hold?: Promise<void>) {
  const state = {bytes: 0, cancelled: false, entered: deferred<void>()}; let offset = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      state.entered.resolve(); await hold;
      if (state.cancelled) return;
      if (offset >= value.length) {controller.close(); return;}
      const chunk = value.subarray(offset, offset + 73_019); offset += chunk.length; state.bytes += chunk.length; controller.enqueue(chunk);
    }, cancel() {state.cancelled = true;},
  }, {highWaterMark: 0}), {status: 200, headers: {'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length)}});
  return {response, state};
}
const requestedRange = (request?: RequestInit) => {
  const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(request?.headers).get('Range') ?? ''); assert(match); return {begin: Number(match[1]), end: Number(match[2]) + 1};
};
function partialResponse(begin: number, end: number) {
  return new Response(bytes.slice(begin, end), {status: 206, headers: {'Content-Type': 'application/pdf', 'Content-Range': `bytes ${begin}-${end - 1}/${bytes.length}`, 'Content-Length': String(end - begin)}});
}

test('real API, scheduler and disk cache share one complete response across simultaneous and subsequent ranges', {timeout: 5000}, async () => {
  const gate = deferred<void>(), full = completeResponse(bytes, gate.promise); let calls = 0;
  const f = fixture({fetch: async () => {calls++; return full.response;}});
  try {
    await f.worker.getPdfMetadata('doc');
    const ranges = [[9, 91], [PDF_BLOCK_SIZE + 9, PDF_BLOCK_SIZE + 59], [PDF_BLOCK_SIZE * 3 - 9, PDF_BLOCK_SIZE * 3 + 9]];
    const reads = ranges.map(([begin, end]) => f.worker.readPdfRange('doc', descriptor, begin, end));
    await full.state.entered.promise; assert.equal(calls, 1); gate.resolve();
    const results = await Promise.all(reads); results.forEach((value, index) => assert.deepEqual(value, bytes.slice(...ranges[index] as [number, number])));
    assert.deepEqual(await f.worker.readPdfRange('doc', descriptor, bytes.length - 7, bytes.length), bytes.slice(-7));
    assert.equal(calls, 1); assert.equal(full.state.bytes, bytes.length); assert.equal((await f.cache.status('doc')).complete, true);
    const restarted = fixture({storage: f.files, fetch: async () => assert.fail('complete cached PDF must not refetch')});
    try {await restarted.worker.setOnline(false); assert.deepEqual(await restarted.worker.getPdfMetadata('doc'), descriptor); assert.deepEqual(await restarted.worker.readPdfRange('doc', descriptor, 9, 91), bytes.slice(9, 91));}
    finally {await restarted.worker.stop();}
  } finally {gate.resolve(); await f.worker.stop();}
});

test('an automatic full PDF fill and a later foreground page retain independent consumers', {timeout: 5000}, async () => {
  const gate = deferred<void>(), full = completeResponse(bytes, gate.promise), reader = new AbortController(); let calls = 0;
  const f = fixture({count: 1, fetch: async () => {calls++; return full.response;}});
  try {
    f.rows.personal.push({id: 'doc', status: 'success', content_type: 2}); f.worker.start(); await full.state.entered.promise;
    const reading = f.worker.readPdfRange('doc', descriptor, PDF_BLOCK_SIZE * 4, PDF_BLOCK_SIZE * 4 + 7, undefined, reader.signal);
    const rejected = assert.rejects(reading, {name: 'AbortError'}); await setImmediate(); reader.abort(); await rejected;
    assert.equal(full.state.cancelled, false); gate.resolve(); await f.worker.settled();
    assert.equal(f.locals.get('doc')?.is_downloaded, 2); assert.equal(calls, 1); assert.equal(full.state.bytes, bytes.length);
  } finally {gate.resolve(); await f.worker.stop();}
});

test('a retained foreground consumer owns a full stream after its first requester cancels', {timeout: 5000}, async () => {
  const gate = deferred<void>(), full = completeResponse(bytes, gate.promise), first = new AbortController(); let calls = 0;
  const f = fixture({fetch: async () => {calls++; return full.response;}});
  try {
    await f.cache.setMetadata('doc', descriptor);
    const reading = f.worker.readPdfRange('doc', descriptor, 0, 7, undefined, first.signal), rejected = assert.rejects(reading, {name: 'AbortError'});
    await full.state.entered.promise;
    const retained = f.worker.readPdfRange('doc', descriptor, PDF_BLOCK_SIZE * 3, PDF_BLOCK_SIZE * 3 + 7);
    await setImmediate(); first.abort(); await rejected; assert.equal(full.state.cancelled, false);
    gate.resolve(); assert.deepEqual(await retained, bytes.slice(PDF_BLOCK_SIZE * 3, PDF_BLOCK_SIZE * 3 + 7)); assert.equal(calls, 1);
  } finally {gate.resolve(); await f.worker.stop();}
});

test('last full PDF consumer abort cancels transport without publishing staging or retrying', {timeout: 5000}, async () => {
  const gate = deferred<void>(), full = completeResponse(bytes, gate.promise), reader = new AbortController(); let calls = 0;
  const f = fixture({fetch: async () => {calls++; return full.response;}});
  try {
    await f.cache.setMetadata('doc', descriptor);
    const reading = f.worker.readPdfRange('doc', descriptor, 0, 7, undefined, reader.signal), rejected = assert.rejects(reading, {name: 'AbortError'});
    await full.state.entered.promise; reader.abort(); await rejected; await f.worker.settled();
    assert.equal(full.state.cancelled, true); assert.equal(calls, 1); assert.equal((await f.cache.status('doc')).downloadedBytes, 0);
    assert.equal([...f.files.keys()].some(path => path.endsWith('.block')), false);
  } finally {gate.resolve(); await f.worker.stop();}
});

test('range support is probed once then independent 206 ranges retain three-slot concurrency', {timeout: 5000}, async () => {
  const gates = new Map<number, ReturnType<typeof deferred<void>>>(); let calls = 0;
  const f = fixture({fetch: async (_url, request) => {calls++; const {begin, end} = requestedRange(request); if (begin) {const gate = deferred<void>(); gates.set(begin, gate); await gate.promise;} return partialResponse(begin, end);}});
  try {
    await f.cache.setMetadata('doc', descriptor); await f.worker.readPdfRange('doc', descriptor, 0, 7);
    const reads = [1, 2, 3].map(block => f.worker.readPdfRange('doc', descriptor, block * PDF_BLOCK_SIZE, block * PDF_BLOCK_SIZE + 7));
    await until(() => gates.size === 3); assert.equal(calls, 4);
    for (const gate of gates.values()) gate.resolve(); await Promise.all(reads);
  } finally {for (const gate of gates.values()) gate.resolve(); await f.worker.stop();}
});

test('a server switching from 206 to concurrent 200 responses streams only one full body', {timeout: 5000}, async () => {
  const gate = deferred<void>(), streams: ReturnType<typeof completeResponse>[] = [];
  const f = fixture({fetch: async (_url, request) => {const {begin, end} = requestedRange(request); if (!begin) return partialResponse(begin, end); const full = completeResponse(bytes, gate.promise); streams.push(full); return full.response;}});
  try {
    await f.cache.setMetadata('doc', descriptor); await f.worker.readPdfRange('doc', descriptor, 0, 7);
    const reads = [1, 2, 3].map(block => f.worker.readPdfRange('doc', descriptor, block * PDF_BLOCK_SIZE, block * PDF_BLOCK_SIZE + 7));
    await until(() => streams.length >= 1); await streams[0].state.entered.promise; await setImmediate(); gate.resolve();
    await Promise.all(reads);
    assert.equal(streams.filter(stream => stream.state.bytes > 0).length, 1);
    assert.equal(streams.reduce((sum, stream) => sum + stream.state.bytes, 0), bytes.length);
    assert.equal((await f.cache.status('doc')).complete, true);
  } finally {gate.resolve(); await f.worker.stop();}
});

for (const invalid of ['truncated', 'hash'] as const) {
  test(`shared full PDF ${invalid} failure rejects all consumers and retains prior partial bytes`, {timeout: 5000}, async () => {
    const bad = invalid === 'truncated' ? bytes.slice(0, -1) : bytes.slice(); if (invalid === 'hash') bad[0] ^= 1;
    const full = completeResponse(bad), f = fixture({fetch: async () => full.response});
    try {
      await f.cache.setMetadata('doc', descriptor); await f.cache.writeBlock('doc', descriptor, 0, bytes.subarray(0, PDF_BLOCK_SIZE));
      const reads = [1, 2, 3].map(block => f.worker.readPdfRange('doc', descriptor, block * PDF_BLOCK_SIZE, block * PDF_BLOCK_SIZE + 7));
      const results = await Promise.allSettled(reads); assert(results.every(value => value.status === 'rejected'));
      assert.equal(f.requests.length, 1); assert.equal((await f.cache.status('doc')).downloadedBytes, PDF_BLOCK_SIZE);
      assert.deepEqual(await f.cache.read('doc', descriptor, 0, 7), bytes.slice(0, 7));
      assert.equal([...f.files.keys()].some(path => path.includes('/full-')), false);
    } finally {await f.worker.stop();}
  });
}

test('full transfer scope excludes other collection owners, accounts and API environments', {timeout: 5000}, async () => {
  const files = new Map<string, Uint8Array>(); let calls = 0;
  const fetch: typeof globalThis.fetch = async () => {calls++; return completeResponse().response;};
  const f = fixture({storage: files, fetch}), other = fixture({storage: files, scope: 'https://api.test/other', fetch}), beta = fixture({storage: files, scope: 'https://beta.test/account', fetch});
  try {
    for (const value of [f, other, beta]) await value.cache.setMetadata('doc', descriptor);
    await f.cache.setMetadata('collection-owner-doc', descriptor);
    await Promise.all([f.worker.readPdfRange('doc', descriptor, 0, 7), f.worker.readPdfRange('doc', descriptor, 0, 7, 'owner'), other.worker.readPdfRange('doc', descriptor, 0, 7), beta.worker.readPdfRange('doc', descriptor, 0, 7)]);
    assert.equal(calls, 4);
  } finally {await Promise.all([f.worker.stop(), other.worker.stop(), beta.worker.stop()]);}
});

test('denial during a stalled full response persists before cancelling every shared reader', {timeout: 5000}, async () => {
  const gate = deferred<void>(), full = completeResponse(bytes, gate.promise); let forbidden = false;
  const f = fixture({fetch: async () => full.response, metadata: async () => {if (forbidden) throw Object.assign(new Error('Forbidden'), {status: 403}); return descriptor;}});
  try {
    await f.worker.getPdfMetadata('doc');
    const reading = f.worker.readPdfRange('doc', descriptor, 0, 7), rejected = assert.rejects(reading);
    await full.state.entered.promise; forbidden = true; await assert.rejects(f.worker.getPdfMetadata('doc'), /Forbidden/); await rejected; await f.worker.settled();
    assert.equal(full.state.cancelled, true); assert.equal(await f.cache.metadata('doc'), null);
    assert([...f.files.keys()].some(path => path.includes('/denials/')));
    await f.worker.setOnline(false); await assert.rejects(f.worker.getPdfMetadata('doc'), /revoked/);
  } finally {gate.resolve(); await f.worker.stop();}
});

test('an incomplete committed-result contract fails rather than repeatedly downloading the same PDF', {timeout: 5000}, async () => {
  const f = fixture({fetch: async () => completeResponse().response});
  try {
    await f.cache.setMetadata('doc', descriptor); f.cache.writeComplete = async () => {};
    await assert.rejects(f.worker.readPdfRange('doc', descriptor, 0, 7), /Incomplete PDF response consumption/);
    assert.equal(f.requests.length, 1);
  } finally {await f.worker.stop();}
});

test('full PDF transport retry discards failed staging before publishing a verified replacement', {timeout: 5000}, async () => {
  let calls = 0, reads = 0;
  const failed = new Response(new ReadableStream<Uint8Array>({pull(controller) {
    if (reads++ === 0) controller.enqueue(bytes.slice(0, PDF_BLOCK_SIZE)); else controller.error(new TypeError('connection reset'));
  }}, {highWaterMark: 0}), {status: 200, headers: {'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length)}});
  const f = fixture({fetch: async () => ++calls === 1 ? failed : completeResponse().response});
  try {
    await f.cache.setMetadata('doc', descriptor);
    const reads = [1, 2].map(block => f.worker.readPdfRange('doc', descriptor, block * PDF_BLOCK_SIZE, block * PDF_BLOCK_SIZE + 7));
    await Promise.all(reads);
    assert.equal(calls, 2); assert.equal(f.requests.length, 1); assert.equal(failed.body?.locked, false);
    assert.equal([...f.files.keys()].filter(path => path.endsWith('.block')).length, 6);
    assert.equal((await f.cache.status('doc')).complete, true);
  } finally {await f.worker.stop();}
});

test('late complete headers reuse a full generation that was committed before those headers arrived', {timeout: 5000}, async () => {
  const late = deferred<void>(), headerEntered = deferred<void>(), streams: ReturnType<typeof completeResponse>[] = [];
  const f = fixture({fetch: async (_url, request) => {
    const {begin, end} = requestedRange(request); if (!begin) return partialResponse(begin, end);
    if (begin === PDF_BLOCK_SIZE * 2) {headerEntered.resolve(); await late.promise;}
    const full = completeResponse(); streams.push(full); return full.response;
  }});
  try {
    await f.cache.setMetadata('doc', descriptor); await f.worker.readPdfRange('doc', descriptor, 0, 7);
    const first = f.worker.readPdfRange('doc', descriptor, PDF_BLOCK_SIZE, PDF_BLOCK_SIZE + 7);
    const second = f.worker.readPdfRange('doc', descriptor, PDF_BLOCK_SIZE * 2, PDF_BLOCK_SIZE * 2 + 7);
    await headerEntered.promise; await first; late.resolve(); await second;
    assert.equal(streams.length, 2); assert.equal(streams[1].state.bytes, 0); assert.equal(streams[1].state.cancelled, true);
  } finally {late.resolve(); await f.worker.stop();}
});

test('real loopback HTTP ignoring Range sends one complete file for overlapping viewer ranges', {timeout: 5000}, async () => {
  let requests = 0, transferred = 0;
  const server = createServer((request, response) => {
    requests++; assert.match(request.headers.range ?? '', /^bytes=\d+-\d+$/); assert.equal(request.headers.authorization, 'Bearer test-token');
    response.writeHead(200, {'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length)});
    for (let offset = 0; offset < bytes.length; offset += 65_537) {const part = bytes.subarray(offset, offset + 65_537); response.write(part); transferred += part.length;}
    response.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const f = fixture({fetch: (url, options) => globalThis.fetch(`http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`, options)});
  try {
    await f.cache.setMetadata('doc', descriptor);
    const ranges = [[0, 7], [PDF_BLOCK_SIZE - 3, PDF_BLOCK_SIZE * 2 + 9], [PDF_BLOCK_SIZE * 4, PDF_BLOCK_SIZE * 4 + 19]];
    const values = await Promise.all(ranges.map(([begin, end]) => f.worker.readPdfRange('doc', descriptor, begin, end)));
    values.forEach((value, index) => assert.deepEqual(value, bytes.slice(...ranges[index] as [number, number])));
    assert.equal(requests, 1); assert.equal(transferred, bytes.length); assert.equal((await f.cache.status('doc')).complete, true);
  } finally {await f.worker.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));}
});

test('a delayed 206 cannot replace verified full-response blocks with contradictory bytes', {timeout: 5000}, async () => {
  const gate = deferred<void>(), entered = deferred<void>();
  const f = fixture({fetch: async (_url, request) => {
    const {begin, end} = requestedRange(request); if (!begin) return partialResponse(begin, end);
    if (begin === PDF_BLOCK_SIZE * 2) {
      entered.resolve(); await gate.promise;
      return new Response(new Uint8Array(end - begin), {status: 206, headers: {'Content-Type': 'application/pdf', 'Content-Range': `bytes ${begin}-${end - 1}/${bytes.length}`, 'Content-Length': String(end - begin)}});
    }
    return completeResponse().response;
  }});
  try {
    await f.cache.setMetadata('doc', descriptor); await f.worker.readPdfRange('doc', descriptor, 0, 7);
    const complete = f.worker.readPdfRange('doc', descriptor, PDF_BLOCK_SIZE, PDF_BLOCK_SIZE + 7);
    const late = f.worker.readPdfRange('doc', descriptor, PDF_BLOCK_SIZE * 2, PDF_BLOCK_SIZE * 2 + 7);
    await entered.promise; await complete; gate.resolve();
    assert.deepEqual(await late, bytes.slice(PDF_BLOCK_SIZE * 2, PDF_BLOCK_SIZE * 2 + 7));
    assert.equal((await f.cache.status('doc')).complete, true);
  } finally {gate.resolve(); await f.worker.stop();}
});
