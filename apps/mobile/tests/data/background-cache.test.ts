import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {setImmediate} from 'node:timers/promises';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {fileURLToPath, URL} from 'node:url';
import {BackgroundArticleCache, prepareAutomaticCacheContent} from '../../src/data/background-cache.ts';
import {fetchCacheImage} from '../../src/data/image-fetch.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {MemoryPreferences} from './helpers.ts';
import type {SqlDatabase, SqlTransaction} from '../../src/data/repositories.ts';

// This test process exercises every worker scenario with React Native's actual signal class.
const nativeRequire = createRequire(realpathSync(fileURLToPath(new URL('../../node_modules/react-native/package.json', import.meta.url))));
globalThis.AbortController = nativeRequire('abort-controller/dist/abort-controller').AbortController;

function fixture(count = 50, load: (id: string, signal: AbortSignal) => Promise<string> = async id => `<p>${id}</p>`, image: (url: string, signal: AbortSignal) => Promise<Uint8Array> = async () => new Uint8Array([1])) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sr_user_bookmark(id TEXT PRIMARY KEY, metadata TEXT, archive_status INTEGER, deleted_at TEXT, created_at TEXT, updated_at TEXT, type INTEGER DEFAULT 0);
    CREATE TABLE sr_user_collection(id TEXT PRIMARY KEY, owner_id TEXT);
    CREATE TABLE sr_user_collection_subscriber(collection_id TEXT);
    CREATE TABLE sr_collection_bookmark(id TEXT, owner_id TEXT, metadata TEXT, starred_at TEXT, created_at TEXT);
    CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY, data TEXT);`);
  const watchers = new Set<() => void>(), files = new Map<string, string>(), downloadedImages: string[] = [], requests: string[] = [];
  let active = true, serial: Promise<unknown> = Promise.resolve();
  const transaction: SqlTransaction = {
    execute: async (sql, parameters = []) => db.prepare(sql).run(...parameters as (string | number | null)[]),
    getOptional: async <T>(sql: string, parameters: unknown[] = []) => db.prepare(sql).get(...parameters as (string | number | null)[]) as T ?? null,
  };
  const database: SqlDatabase = {...transaction,
    getAll: async <T>(sql: string, parameters: unknown[] = []) => db.prepare(sql).all(...parameters as (string | number | null)[]) as T[],
    writeTransaction<T>(work: (tx: SqlTransaction) => Promise<T>): Promise<T> {
      const result = serial.then(async () => {
        db.exec('BEGIN');
        try {const value = await work(transaction); db.exec('COMMIT'); watchers.forEach(notify => notify()); return value;}
        catch (error) {db.exec('ROLLBACK'); throw error;}
      });
      serial = result.catch(() => undefined); return result;
    },
    watch(sql, parameters, handler, options) {
      const notify = () => {if (!options.signal.aborted) handler.onResult({rows: {_array: db.prepare(sql).all(...parameters as string[])}});};
      watchers.add(notify); options.signal.addEventListener('abort', () => watchers.delete(notify), {once: true}); notify();
    },
  };
  const preferences = new PreferenceStore(new MemoryPreferences({cache_count: count, download_images: 1}));
  const guard = () => {assert(active, 'Old account attempted a cache write');};
  const worker = new BackgroundArticleCache({database, preferences, assertActive: guard,
    content: async (id, _owner, signal) => {requests.push(id); return load(id, signal);}, image,
    cache: {writeArticle(key, html) {guard(); files.set(key, html);}, removeArticle(key) {guard(); files.delete(key);}, async ensureImage(key, url, loadBytes) {const bytes = await loadBytes(); guard(); if (bytes.length) downloadedImages.push(`${key}:${url}`); return null;}},
  });
  function personal(id: string, created = id, status = 'success', archived = false) {db.prepare('INSERT INTO sr_user_bookmark VALUES (?, ?, ?, NULL, ?, ?, 0)').run(id, JSON.stringify({bookmark: {status}}), archived ? 1 : 0, created, created);}
  function collection(owner: string, id: string, created = id) {
    if (!db.prepare('SELECT id FROM sr_user_collection WHERE id = ?').get(owner)) {db.prepare('INSERT INTO sr_user_collection VALUES (?, ?)').run(owner, owner); db.prepare('INSERT INTO sr_user_collection_subscriber VALUES (?)').run(owner);}
    db.prepare('INSERT INTO sr_collection_bookmark VALUES (?, ?, ?, ?, ?)').run(id, owner, JSON.stringify({bookmark: {status: 'success'}}), created, created);
  }
  function local(id: string, values: Record<string, unknown>) {db.prepare('INSERT OR REPLACE INTO ps_data_local__local_bookmark_info VALUES (?, ?)').run(id, JSON.stringify(values));}
  function read(id: string): Record<string, unknown> | null {const row = db.prepare('SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?').get(id); return row ? JSON.parse(String(row.data)) : null;}
  async function settle() {await setImmediate(); await worker.settled(); await setImmediate(); await worker.settled();}
  async function close() {await worker.stop(); db.close();}
  return {db, worker, preferences, files, requests, downloadedImages, personal, collection, local, read, settle, close, revoke() {active = false;}};
}

test('unopened synchronized articles enter the latest automatic window, excluding manual and non-success rows', async () => {
  const f = fixture(2);
  f.personal('manual', '9'); f.local('manual', {is_downloaded: 2, is_auto_cached: false, read_position: '75'}); f.files.set('manual', 'manual');
  f.personal('pending', '8', 'pending'); f.personal('latest', '7'); f.personal('older', '6'); f.personal('outside', '5'); f.personal('archived', '4', 'success', true);
  f.worker.start(); await f.settle();
  assert.deepEqual([...f.files.keys()].sort(), ['latest', 'manual', 'older']);
  assert.equal(f.read('latest')?.is_downloaded, 2); assert.equal(f.read('older')?.is_auto_cached, 1);
  assert.equal(f.read('manual')?.is_auto_cached, false); assert.equal(f.read('manual')?.read_position, '75');
  assert.deepEqual(f.requests.sort(), ['latest', 'older']); await f.close();
});
test('collection limits apply independently to each owner, and unlimited caches all remaining candidates', async () => {
  const f = fixture(1);
  for (const owner of ['a', 'b']) {f.collection(owner, `${owner}-new`, '9'); f.collection(owner, `${owner}-old`, '8');}
  f.worker.start(); await f.settle();
  assert.deepEqual([...f.files.keys()].sort(), ['collection-a-a-new', 'collection-b-b-new']);
  await f.preferences.update(values => {values.cache_count = -1;}); await f.settle();
  assert.equal(f.files.size, 4); assert.equal(f.read('collection-a-a-old')?.is_downloaded, 2); await f.close();
});
test('automatic eviction preserves manual files and active personal local metadata', async () => {
  const f = fixture(0);
  f.personal('active'); f.personal('archived', '8', 'success', true);
  for (const id of ['active', 'archived', 'collection-x-old']) {f.local(id, {is_downloaded: 2, is_auto_cached: 1, read_position: '121', unknownLegacyField: 'preserve'}); f.files.set(id, 'cached');}
  f.local('manual', {is_downloaded: 2, is_auto_cached: 0}); f.files.set('manual', 'manual');
  f.worker.start(); await f.settle();
  assert.deepEqual([...f.files.keys()], ['manual']);
  assert.deepEqual(f.read('active'), {is_downloaded: 0, is_auto_cached: 1, read_position: '121', unknownLegacyField: 'preserve'});
  assert.equal(f.read('archived'), null); assert.equal(f.read('collection-x-old'), null); await f.close();
});
test('HTML transport processing avoids comments/raw text and decodes cached image attribute entities', () => {
  const value = prepareAutomaticCacheContent('<script>"<img src=\"https://bad.test/x.jpg\">"</script><!-- <img src="https://bad.test/y.jpg"> --><img src="https://image.test/a.png-v2?a=1&amp;b=2"><img src="data:image/png;base64,AA">');
  assert.deepEqual(value.imageUrls, ['https://image.test/a.png-v2?a=1&b=2']);
  assert(value.html.includes('src="slaxstatics://image.test/a.png-v2?a=1&amp;b=2"')); assert(value.html.includes('src="https://bad.test/x.jpg"'));
});
test('disabled images and individual image failures retain completed article content', async () => {
  let images = 0;
  const f = fixture(50, async () => '<img src="https://image.test/a.jpg"><p>article</p>', async () => {images++; throw new Error('image unavailable');});
  f.personal('without-image'); await f.preferences.update(values => {values.download_images = 0;});
  f.worker.start(); await f.settle(); assert.equal(images, 0); assert.equal(f.read('without-image')?.is_downloaded, 2);
  await f.close();
  const failed = fixture(50, async () => '<img src="https://image.test/a.jpg"><p>article</p>', async () => {images++; throw new Error('image unavailable');});
  failed.personal('failed-image'); failed.worker.start(); await failed.settle();
  assert.equal(images, 1); assert.equal(failed.read('failed-image')?.is_downloaded, 2); assert(failed.files.has('failed-image')); await failed.close();
});
test('opening an automatic article during image loading preserves its ongoing completion', async () => {
  let resume!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => {resume = resolve;}), started = new Promise<void>(resolve => {requested = resolve;});
  const f = fixture(50, async () => '<img src="https://image.test/a.jpg"><p>ready offline</p>', async () => {requested(); await gate; return new Uint8Array([1]);});
  f.collection('owner', 'article'); f.worker.start(); await started;
  assert(f.files.has('collection-owner-article')); assert.equal(f.read('collection-owner-article')?.is_downloaded, 1);
  const release = f.worker.beginForeground('collection-owner-article');
  resume(); await f.settle(); assert.equal(f.read('collection-owner-article')?.is_downloaded, 2);
  release(); await f.settle(); assert.equal(f.read('collection-owner-article')?.is_downloaded, 2); await f.close();
});
test('a stopped old-account body request cannot commit HTML or status after account revocation', async () => {
  let resume!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => {resume = resolve;}), started = new Promise<void>(resolve => {requested = resolve;});
  const f = fixture(50, async () => {requested(); await gate; return '<p>late account a</p>';});
  f.personal('a-article'); f.worker.start(); await started;
  f.worker.cancel(); f.revoke(); f.db.exec('DELETE FROM ps_data_local__local_bookmark_info'); f.files.clear();
  f.local('b-article', {is_downloaded: 2, is_auto_cached: 0}); f.files.set('b-article', 'account b');
  resume(); await f.worker.stop();
  assert.deepEqual([...f.files.keys()], ['b-article']); assert.equal(f.read('a-article'), null); assert.equal(f.read('b-article')?.is_auto_cached, 0); await f.close();
});
test('a stopped old-account image request cannot repopulate a cleared cache', async () => {
  let resume!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => {resume = resolve;}), started = new Promise<void>(resolve => {requested = resolve;});
  const f = fixture(50, async () => '<img src="https://image.test/a.jpg">', async () => {requested(); await gate; return new Uint8Array([1]);});
  f.personal('a-article'); f.worker.start(); await started; assert(f.files.has('a-article'));
  f.worker.cancel(); f.revoke(); f.db.exec('DELETE FROM ps_data_local__local_bookmark_info'); f.files.clear();
  resume(); await f.worker.stop();
  assert.equal(f.files.size, 0); assert.equal(f.downloadedImages.length, 0); assert.equal(f.read('a-article'), null); await f.close();
});
test('collection failures wait for foreground access instead of retrying on every local snapshot', async () => {
  let attempts = 0;
  const f = fixture(50, async () => {if (++attempts === 1) throw new Error('offline'); return '<p>recovered</p>';});
  f.collection('owner', 'article'); f.worker.start(); await f.settle();
  assert.equal(attempts, 1); assert.equal(f.read('collection-owner-article')?.is_downloaded, 3);
  await f.preferences.update(values => {values.cache_count = 51;}); await f.settle(); assert.equal(attempts, 1);
  const release = f.worker.beginForeground('collection-owner-article'); release(); await f.settle();
  assert.equal(attempts, 2); assert.equal(f.read('collection-owner-article')?.is_downloaded, 2); await f.close();
});
test('blank collection owners cannot fetch or overwrite a personal cache namespace', async () => {
  const f = fixture(50); f.collection('', 'blank'); f.collection('   ', 'spaces');
  f.worker.start(); await f.settle(); assert.equal(f.requests.length, 0); assert.equal(f.files.size, 0); await f.close();
});
test('foreground reservations defer eviction until the last overlapping read releases its lease', async () => {
  const f = fixture(0); f.collection('owner', 'article'); f.local('collection-owner-article', {is_downloaded: 2, is_auto_cached: 1}); f.files.set('collection-owner-article', 'cached');
  const first = f.worker.beginForeground('collection-owner-article'), second = f.worker.beginForeground('collection-owner-article');
  f.worker.start(); await f.settle(); assert(f.files.has('collection-owner-article'));
  first(); await f.settle(); assert(f.files.has('collection-owner-article'));
  second(); await f.settle(); assert(!f.files.has('collection-owner-article')); assert.equal(f.read('collection-owner-article'), null); await f.close();
});
test('successful image responses without Content-Type cache before article completion, explicit non-images do not', async () => {
  for (const contentType of [null, 'image/png', 'IMAGE/JPEG; charset=binary', 'text/html', 'application/octet-stream', '']) {
    let bodies = 0;
    const image = (url: string, signal: AbortSignal) => fetchCacheImage(async () => ({ok: true, headers: new Headers(contentType === null ? {} : {'content-type': contentType}), arrayBuffer: async () => {bodies++; return new Uint8Array([1, 2]).buffer;}}), url, signal);
    const f = fixture(50, async () => '<img src="https://example.com/image">', image);
    f.personal('header'); f.worker.start(); await f.settle();
    const accepted = contentType === null || contentType.toLowerCase().startsWith('image/');
    assert.equal(f.downloadedImages.length, accepted ? 1 : 0); assert.equal(bodies, accepted ? 1 : 0);
    assert.equal(f.read('header')?.is_downloaded, 2); assert(f.files.has('header')); await f.close();
  }
});
test('pause aborts queued network work, preserves foreground reservations and resumes the same cache owner', async () => {
  let requested!: () => void;
  const started = new Promise<void>(resolve => {requested = resolve;});
  let attempts = 0;
  const f = fixture(50, async (_id, signal) => {
    if (++attempts === 1) {requested(); await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('paused')), {once: true}));}
    return '<p>resumed</p>';
  });
  f.personal('pending'); f.worker.start(); await started;
  await f.worker.pause();
  assert.equal(f.files.size, 0); assert.equal(f.read('pending')?.is_downloaded, 1);
  const release = f.worker.beginForeground('pending');
  await f.preferences.update(values => {values.cache_count = 51;});
  f.worker.resume(); await f.settle(); assert.equal(attempts, 1);
  release(); await f.settle();
  assert.equal(attempts, 2); assert.equal(f.read('pending')?.is_downloaded, 2);
  await f.worker.pause(); await f.worker.stop(); f.worker.resume();
  await f.close();
});

test('image fetch rejects unsuccessful responses and late bodies after React Native cancellation', async () => {
  const controller = new AbortController(); let bodies = 0;
  await assert.rejects(fetchCacheImage(async () => ({ok: false, headers: new Headers(), arrayBuffer: async () => {bodies++; return new ArrayBuffer(1);}}), 'https://example.com/image', controller.signal), /failed/);
  assert.equal(bodies, 0);
  let requestSignal: AbortSignal | undefined;
  await assert.rejects(fetchCacheImage(async (_url, options) => {
    requestSignal = options.signal;
    return {ok: true, headers: new Headers(), arrayBuffer: async () => {controller.abort(); return new ArrayBuffer(1);}};
  }, 'https://example.com/image', controller.signal), error => error instanceof Error && error.name === 'AbortError');
  assert.equal(requestSignal?.aborted, true);
  await assert.rejects(fetchCacheImage(async () => {throw new Error('Must not request');}, 'https://example.com/image', controller.signal), error => error instanceof Error && error.name === 'AbortError');
});
