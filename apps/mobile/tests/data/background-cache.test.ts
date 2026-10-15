import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {fileURLToPath, URL} from 'node:url';
import {BackgroundArticleCache, prepareAutomaticCacheContent} from '../../src/data/background-cache.ts';
import {fetchCacheImage} from '../../src/data/image-fetch.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {MemoryPreferences} from './helpers.ts';
import type {SqlDatabase, SqlTransaction} from '../../src/data/repositories.ts';
import {AutomaticCachePlan} from '../../src/data/cache-plan.ts';

// This test process exercises every worker scenario with React Native's actual signal class.
const nativeRequire = createRequire(realpathSync(fileURLToPath(new URL('../../node_modules/react-native/package.json', import.meta.url))));
globalThis.AbortController = nativeRequire('abort-controller/dist/abort-controller').AbortController;

function fixture(count = 50, load: (id: string, signal: AbortSignal) => Promise<string> = async id => `<p>${id}</p>`, image: (url: string, signal: AbortSignal) => Promise<Uint8Array> = async () => new Uint8Array([1]), options: {now?: () => number; afterWrite?: () => void; beforeFingerprint?: () => Promise<void>; snapshot?: {locals: [string, string][]; files: [string, string][]}} = {}) {
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
  const worker = new BackgroundArticleCache({database, preferences, assertActive: guard, now: options.now, random: () => 1,
    content: async (id, _owner, signal) => {requests.push(id); return load(id, signal);}, image,
    cache: {async writeArticle(key, html) {guard(); files.set(key, html); options.afterWrite?.();},
      async contentFingerprint(html) {return {size: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex')};},
      async articleFingerprint(key) {await options.beforeFingerprint?.(); guard(); const html = files.get(key); return html === undefined ? null : {size: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex')};},
      async removeArticle(key) {guard(); files.delete(key);}, async ensureImage(key, url, loadBytes) {assert(loadBytes); const bytes = await loadBytes(); guard(); if (!bytes.length) return null; downloadedImages.push(`${key}:${url}`); return `file:///cache/${encodeURIComponent(key)}/${encodeURIComponent(url)}.png`;}},
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
  for (const [id, data] of options.snapshot?.locals ?? []) db.prepare('INSERT INTO ps_data_local__local_bookmark_info VALUES (?, ?)').run(id, data);
  for (const [key, html] of options.snapshot?.files ?? []) files.set(key, html);
  return {db, worker, preferences, files, requests, downloadedImages, personal, collection, local, read, settle, close,
    snapshot: () => ({locals: db.prepare('SELECT id, data FROM ps_data_local__local_bookmark_info').all().map(row => [String(row.id), String(row.data)] as [string, string]), files: [...files]}),
    notify() {watchers.forEach(notify => notify());}, revoke() {active = false;}};
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
  assert(f.files.has('collection-owner-article')); assert.equal(f.read('collection-owner-article')?.is_downloaded, 2);
  assert.equal(f.downloadedImages.length, 0);
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
test('successful image responses without Content-Type cache independently of readable HTML, explicit non-images do not', async () => {
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

test('running worker does not replan or retry on unrelated local, synchronized or preference publications', async t => {
  const f = fixture(2); t.after(() => f.close());
  f.personal('one'); f.personal('two'); f.worker.start(); await f.settle();
  const refresh = t.mock.method(AutomaticCachePlan.prototype, 'refresh');
  for (let index = 0; index < 20; index++) {
    f.local('one', {...f.read('one'), read_position: String(index), outline: `chunk-${index}`});
    f.local('position-only', {read_position: String(index)});
    f.db.prepare('UPDATE sr_user_bookmark SET updated_at = ? WHERE id = ?').run(`updated-${index}`, 'one');
    f.notify();
    await f.preferences.update(values => {values.continue_reading_bookmark = JSON.stringify({bookmarkId: 'one', title: `title-${index}`});});
    await f.settle();
  }
  assert.equal(refresh.mock.callCount(), 0); assert.equal(f.requests.length, 2);
  await f.preferences.update(values => {values.cache_count = 1;}); await f.settle();
  assert.ok(refresh.mock.callCount() > 0);
  assert.deepEqual([...f.files.keys()], ['two']);
});

test('equivalent local observations cannot trigger personal failure retries', async t => {
  let attempts = 0;
  const f = fixture(1, async () => {attempts++; throw new Error('offline');}); t.after(() => f.close());
  f.personal('offline'); f.worker.start(); await f.settle(); assert.equal(attempts, 1);
  f.local('offline', {...f.read('offline'), read_position: '9', outline: 'safe cached data'}); f.notify();
  await f.preferences.update(values => {values.user_language = 'zh';}); await f.settle();
  assert.equal(attempts, 1);
});

test('shrinking a cache window removes queued work without replacing active transfers', {timeout: 5000}, async t => {
  let started!: () => void, release!: () => void, count = 0;
  const running = new Promise<void>(resolve => {started = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const f = fixture(5, async id => {if (++count === 2) started(); await gate; return `<p>${id}</p>`;});
  t.after(async () => {release(); await f.close();});
  for (let index = 0; index < 5; index++) f.personal(`doc-${index}`);
  f.worker.start(); await running;
  await f.preferences.update(values => {values.cache_count = 0;}); await setImmediate();
  release(); await f.settle();
  assert.equal(f.requests.length, 2); assert.equal(f.files.size, 0);
  await f.preferences.update(values => {values.cache_count = 1;}); await f.settle();
  assert.equal(f.requests.length, 3); assert.deepEqual([...f.files.keys()], ['doc-4']);
});

test('stalled personal and collection images do not hold later body capacity or readable completion', {timeout: 5000}, async t => {
  let release!: () => void, images = 0;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const f = fixture(50, async id => `<img src="https://images.test/${id}.jpg"><p>${id}</p>`, async () => {images++; await gate; return new Uint8Array([1]);});
  t.after(async () => {release(); await f.close();});
  for (let index = 0; index < 10; index++) {f.personal(`personal-${index}`); f.collection('owner', `shared-${index}`);}
  f.worker.start();
  for (let attempt = 0; attempt < 200 && f.files.size < 20; attempt++) await setImmediate();
  assert.equal(f.files.size, 20); assert.equal(f.requests.length, 20);
  assert.equal(f.read('personal-0')?.is_downloaded, 2); assert.equal(f.read('collection-owner-shared-0')?.is_downloaded, 2);
  assert.equal(images, 1, 'Only one automatic image per destination occupies capacity'); assert.equal(f.downloadedImages.length, 0);
  release(); await f.settle(); assert.equal(f.downloadedImages.length, 20);
});

test('foreground article joins an automatic transfer and detaches without aborting its durable consumer', {timeout: 5000}, async t => {
  let started!: () => void, release!: () => void, transport: AbortSignal | undefined;
  const ready = new Promise<void>(resolve => {started = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const f = fixture(1, async (_id, signal) => {transport = signal; started(); await gate; return '<p>shared</p>';});
  t.after(async () => {release(); await f.close();});
  f.personal('shared'); f.worker.start(); await ready;
  const stop = f.worker.beginForeground('shared'), reader = new AbortController();
  const content = f.worker.getArticleContent('shared', undefined, reader.signal), rejected = assert.rejects(content, {name: 'AbortError'});
  reader.abort(); await rejected; stop(); assert.equal(transport?.aborted, false);
  release(); await f.settle(); assert.equal(f.requests.length, 1); assert.equal(f.files.get('shared'), '<p>shared</p>');
});

test('pausing image work resumes only unfinished images without redownloading its readable article', {timeout: 5000}, async t => {
  let blocked!: () => void, attempts = 0;
  const ready = new Promise<void>(resolve => {blocked = resolve;});
  const f = fixture(1, async () => '<img src="https://images.test/first"><img src="https://images.test/second">', async (url, signal) => {
    attempts++;
    if (url.endsWith('/second') && attempts === 2) {blocked(); await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('paused')), {once: true}));}
    return new Uint8Array([1]);
  });
  t.after(() => f.close()); f.personal('doc'); f.worker.start(); await ready;
  assert.equal(f.read('doc')?.is_downloaded, 2); await f.worker.pause();
  assert.equal(f.downloadedImages.length, 1); f.worker.resume(); await f.settle();
  assert.equal(f.requests.length, 1); assert.equal(attempts, 3); assert.equal(f.downloadedImages.length, 2);
});

test('disabling automatic images aborts its consumer, retains the body and resumes only missing work when enabled', {timeout: 5000}, async t => {
  let blocked!: () => void, attempts = 0;
  const ready = new Promise<void>(resolve => {blocked = resolve;});
  const f = fixture(1, async () => '<img src="https://images.test/one">', async (_url, signal) => {
    if (++attempts === 1) {blocked(); await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('disabled')), {once: true}));}
    return new Uint8Array([1]);
  });
  t.after(() => f.close()); f.personal('doc'); f.worker.start(); await ready;
  await f.preferences.update(values => {values.download_images = 0;}); await f.settle();
  assert.equal(f.read('doc')?.is_downloaded, 2); assert.equal(attempts, 1); assert.equal(f.downloadedImages.length, 0);
  await f.preferences.update(values => {values.download_images = 1;}); await f.settle();
  assert.equal(f.requests.length, 1); assert.equal(attempts, 2); assert.equal(f.downloadedImages.length, 1);
});

test('eviction drains image writes before deletion and a late cancelled body cannot repopulate files', {timeout: 5000}, async t => {
  let started!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => {started = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const f = fixture(1, async () => '<img src="https://images.test/one">', async () => {started(); await gate; return new Uint8Array([1]);});
  t.after(async () => {release(); await f.close();}); f.personal('doc'); f.worker.start(); await ready;
  await f.preferences.update(values => {values.cache_count = 0;}); await setImmediate();
  release(); await f.settle();
  assert.equal(f.files.size, 0); assert.equal(f.downloadedImages.length, 0); assert.equal(f.read('doc')?.is_downloaded, 0);
});

test('process restart resumes only persisted missing images without refetching completed HTML or images', {timeout: 5000}, async () => {
  let entered!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;});
  const first = fixture(1, async () => '<img src="https://images.test/one"><img src="https://images.test/two">', async (url, signal) => {
    if (url.endsWith('/two')) {entered(); await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('shutdown')), {once: true}));}
    return new Uint8Array([1]);
  });
  first.personal('doc'); first.local('doc', {read_position: '18', future: {keep: true}}); first.worker.start(); await started;
  const snapshot = first.snapshot(); await first.close();
  const requested: string[] = [];
  const next = fixture(1, async () => assert.fail('A completed body must survive restart'), async url => {requested.push(url); return new Uint8Array([1]);}, {snapshot});
  try {
    next.personal('doc'); next.worker.start(); await next.settle();
    assert.deepEqual(requested, ['https://images.test/two']); assert.equal(next.requests.length, 0);
    assert.equal(next.read('doc')?.read_position, '18'); assert.deepEqual(next.read('doc')?.future, {keep: true});
    const manifest = next.read('doc')?._slax_offline as {images: {state: string}[]};
    assert(manifest.images.every(image => image.state === 'ready')); assert.equal(next.read('doc')?.is_downloaded, 2);
  } finally {await next.close();}
});

test('failed image retry deadline survives process restart and unrelated watcher writes cannot bypass it', {timeout: 5000}, async () => {
  let now = 1000;
  const first = fixture(1, async () => '<img src="https://images.test/one">', async () => {throw new Error('offline');}, {now: () => now});
  first.personal('doc'); first.worker.start(); await first.settle();
  const saved = first.read('doc')?._slax_offline as {images: {state: string; attempts: number; retryAt: number}[]};
  assert.deepEqual(saved.images.map(({state, attempts, retryAt}) => ({state, attempts, retryAt})), [{state: 'failed', attempts: 1, retryAt: 6000}]);
  const snapshot = first.snapshot(); await first.close();
  let attempts = 0;
  const next = fixture(1, async () => assert.fail('Retrying an image must not fetch HTML'), async () => {attempts++; return new Uint8Array([1]);}, {snapshot, now: () => now});
  try {
    next.personal('doc'); next.worker.start(); await next.settle(); assert.equal(attempts, 0);
    for (let index = 0; index < 10; index++) {next.local('doc', {...next.read('doc'), read_position: String(index), outline: `AI-${index}`}); next.notify(); await next.settle();}
    assert.equal(attempts, 0); now = 6000;
    await next.worker.pause(); next.worker.resume(); await next.settle();
    assert.equal(attempts, 1); assert.equal(next.read('doc')?.is_downloaded, 2);
  } finally {await next.close();}
});

test('completed HTML keeps missing-image inventory while images are disabled across restart', async () => {
  const first = fixture(1, async () => '<img src="https://images.test/one">', async () => assert.fail('Disabled images must not fetch'));
  first.personal('doc'); await first.preferences.update(values => {values.download_images = 0;}); first.worker.start(); await first.settle();
  const snapshot = first.snapshot(); await first.close();
  let images = 0;
  const next = fixture(1, async () => assert.fail('Existing HTML must not refetch'), async () => {images++; return new Uint8Array([1]);}, {snapshot});
  try {
    next.personal('doc'); await next.preferences.update(values => {values.download_images = 0;}); next.worker.start(); await next.settle(); assert.equal(images, 0);
    await next.preferences.update(values => {values.download_images = 1;}); await next.settle(); assert.equal(images, 1);
  } finally {await next.close();}
});

test('permanent image denial persists without discarding readable HTML or retrying after restart', async () => {
  const first = fixture(1, async () => '<img src="https://images.test/denied">', async () => {throw Object.assign(new Error('Denied'), {status: 403});});
  first.personal('doc'); first.worker.start(); await first.settle(); const snapshot = first.snapshot();
  assert.equal(first.read('doc')?.is_downloaded, 2); await first.close();
  const next = fixture(1, async () => assert.fail('No repeated HTML'), async () => assert.fail('Denied images cannot auto-retry'), {snapshot});
  try {next.personal('doc'); next.worker.start(); await next.settle(); assert(next.files.has('doc'));}
  finally {await next.close();}
});

test('image retry timer repairs only the failed resource at its persisted deadline', async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: 1000});
  let attempts = 0;
  const f = fixture(1, async () => '<img src="https://images.test/one">', async () => {if (++attempts === 1) throw new Error('unavailable'); return new Uint8Array([1]);});
  try {
    f.personal('doc'); f.worker.start(); await f.settle(); assert.equal(attempts, 1);
    t.mock.timers.tick(4999); await f.settle(); assert.equal(attempts, 1);
    t.mock.timers.tick(1); await f.settle(); assert.equal(attempts, 2); assert.equal(f.requests.length, 1);
    assert.equal(f.read('doc')?.is_downloaded, 2); assert.equal(f.downloadedImages.length, 1);
    t.mock.timers.tick(1_000_000); await f.settle(); assert.equal(attempts, 2);
  } finally {await f.close();}
});

test('real image transport status and Retry-After feed persistent retry policy without reading rejected bodies', async () => {
  for (const [status, header, state, retryAt] of [[403, null, 'denied', 0], [429, '60', 'failed', 61_000], [503, 'invalid', 'failed', 6000]] as const) {
    const f = fixture(1, async () => '<img src="https://images.test/one">', (url, signal) => fetchCacheImage(async () => ({ok: false, status, headers: new Headers(header ? {'retry-after': header} : {}), arrayBuffer: async () => assert.fail('Rejected body must not be read')}), url, signal), {now: () => 1000});
    try {
      f.personal('doc'); f.worker.start(); await f.settle();
      const manifest = f.read('doc')?._slax_offline as {images: {state: string; retryAt: number}[]};
      assert.equal(manifest.images[0].state, state); assert.equal(manifest.images[0].retryAt, retryAt); assert.equal(f.read('doc')?.is_downloaded, 2);
    } finally {await f.close();}
  }
});

test('invalid optional image URLs cannot prevent valid HTML and remaining images from caching', async () => {
  const requested: string[] = [];
  const f = fixture(1, async () => '<img src="https://"><img src="https://user:password@images.test/private"><img src="https://images.test/safe"><p>readable</p>', async url => {requested.push(url); return new Uint8Array([1]);});
  try {f.personal('doc'); f.worker.start(); await f.settle(); assert.equal(f.read('doc')?.is_downloaded, 2); assert.deepEqual(requested, ['https://images.test/safe']);}
  finally {await f.close();}
});

test('known offline planning starts no transport and reconnect fills pending personal and collection work', async () => {
  const f = fixture(1);
  try {
    f.personal('private'); f.collection('owner', 'shared'); await f.worker.setOnline(false); f.worker.start(); await f.settle();
    assert.equal(f.requests.length, 0); assert.equal(f.files.size, 0);
    await f.preferences.update(values => {values.user_language = 'zh';}); await f.settle(); assert.equal(f.requests.length, 0);
    await f.worker.setOnline(true); await f.settle();
    assert.deepEqual(f.requests.sort(), ['private', 'shared']); assert.equal(f.files.size, 2);
  } finally {await f.close();}
});

test('network loss aborts active body work without recording permanent failure and reconnect retries once', {timeout: 5000}, async () => {
  let entered!: () => void, attempts = 0;
  const started = new Promise<void>(resolve => {entered = resolve;});
  const f = fixture(1, async (_id, signal) => {
    if (++attempts === 1) {entered(); await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('offline')), {once: true}));}
    return '<p>resumed</p>';
  });
  try {
    f.collection('owner', 'doc'); f.worker.start(); await started; await f.worker.setOnline(false);
    assert.equal(f.read('collection-owner-doc')?.is_downloaded, 1); assert.equal(f.files.size, 0);
    await f.worker.setOnline(true); await f.settle(); assert.equal(attempts, 2); assert.equal(f.read('collection-owner-doc')?.is_downloaded, 2);
  } finally {await f.close();}
});

test('network loss suspends image fill without losing its missing-resource record', {timeout: 5000}, async () => {
  let entered!: () => void, attempts = 0;
  const started = new Promise<void>(resolve => {entered = resolve;});
  const f = fixture(1, async () => '<img src="https://images.test/one">', async (_url, signal) => {
    if (++attempts === 1) {entered(); await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('offline')), {once: true}));}
    return new Uint8Array([1]);
  });
  try {
    f.personal('doc'); f.worker.start(); await started; await f.worker.setOnline(false); await f.settle();
    assert.equal(f.read('doc')?.is_downloaded, 2); assert.equal(f.downloadedImages.length, 0);
    await f.worker.setOnline(true); await f.settle(); assert.equal(attempts, 2); assert.equal(f.requests.length, 1); assert.equal(f.downloadedImages.length, 1);
  } finally {await f.close();}
});

test('rapid connectivity replacement waits for old transport drain and cannot revive a superseded reconnect', {timeout: 5000}, async () => {
  let entered!: () => void, release!: () => void, attempts = 0;
  const started = new Promise<void>(resolve => {entered = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const f = fixture(1, async () => {if (++attempts === 1) {entered(); await gate;} return '<p>current</p>';});
  try {
    f.personal('doc'); f.worker.start(); await started;
    const offline = f.worker.setOnline(false), online = f.worker.setOnline(true), offlineAgain = f.worker.setOnline(false);
    release(); await Promise.all([offline, online, offlineAgain]); await f.settle();
    assert.equal(attempts, 1); assert.equal(f.files.size, 0);
    await f.worker.setOnline(true); await f.settle(); assert.equal(attempts, 2); assert.equal(f.files.get('doc'), '<p>current</p>');
  } finally {release(); await f.close();}
});

for (const collection of [false, true]) test(`${collection ? 'collection' : 'personal'} body retry state survives restart and resumes only after its deadline`, async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: 1000});
  const key = collection ? 'collection-owner-doc' : 'doc';
  const first = fixture(1, async () => {throw new Error('network');});
  if (collection) first.collection('owner', 'doc'); else first.personal('doc');
  first.local(key, {read_position: '42', future: {keep: true}}); first.worker.start(); await first.settle();
  const retry = first.read(key)?._slax_offline_retry as {state: string; retryAt: number; attempts: number};
  assert.equal(retry.state, 'failed'); assert.equal(retry.attempts, 1); assert.equal(retry.retryAt, 6000);
  const snapshot = first.snapshot(); await first.close();
  let calls = 0;
  const next = fixture(1, async () => {calls++; return '<p>recovered</p>';}, undefined, {snapshot});
  try {
    if (collection) next.collection('owner', 'doc'); else next.personal('doc');
    next.worker.start(); await next.settle(); assert.equal(calls, 0);
    next.local(key, {...next.read(key), outline: 'AI only'}); next.notify(); await next.settle(); assert.equal(calls, 0);
    t.mock.timers.tick(4999); await next.settle(); assert.equal(calls, 0);
    t.mock.timers.tick(1); await next.settle(); assert.equal(calls, 1); assert.equal(next.read(key)?.is_downloaded, 2);
    assert.equal(next.read(key)?._slax_offline_retry, undefined); assert.equal(next.read(key)?.read_position, '42'); assert.deepEqual(next.read(key)?.future, {keep: true});
  } finally {await next.close();}
});

test('automatic body access denial persists across restart and foreground reservation alone cannot override it', async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: 1000});
  const first = fixture(1, async () => {throw Object.assign(new Error('Forbidden'), {status: 403});});
  first.personal('doc'); first.worker.start(); await first.settle(); const snapshot = first.snapshot(); await first.close();
  const next = fixture(1, async () => assert.fail('Denied automatic work must not resume'), undefined, {snapshot});
  try {
    next.personal('doc'); next.worker.start(); await next.settle();
    const release = next.worker.beginForeground('doc'); release(); t.mock.timers.tick(1_000_000); await next.settle();
    assert.equal(next.requests.length, 0); assert.equal(next.files.size, 0);
  } finally {await next.close();}
});

test('offline pauses a body retry timer and reconnect does not bypass Retry-After', async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: 1000});
  let attempts = 0;
  const f = fixture(1, async () => {if (++attempts === 1) throw Object.assign(new Error('Rate limited'), {status: 429, retryAfterMs: 60_000}); return '<p>ready</p>';});
  try {
    f.personal('doc'); f.worker.start(); await f.settle(); assert.equal(attempts, 1);
    await f.worker.setOnline(false); t.mock.timers.tick(5000); await f.settle();
    await f.worker.setOnline(true); await f.settle(); assert.equal(attempts, 1);
    t.mock.timers.tick(55_000); await f.settle(); assert.equal(attempts, 2);
  } finally {await f.close();}
});

for (const owner of [undefined, 'owner-a']) test(`interrupted ${owner ? 'collection' : 'personal'} body publication recovers offline without refetching and then fills only missing images`, async () => {
  const key = owner ? `collection-${owner}-doc` : 'doc', html = '<p>正文</p><img src="https://images.test/one.png">';
  let interrupted!: ReturnType<typeof fixture>;
  interrupted = fixture(1, async () => html, undefined, {afterWrite: () => interrupted.worker.cancel()});
  if (owner) interrupted.collection(owner, 'doc'); else interrupted.personal('doc');
  interrupted.local(key, {read_position: '42', future: {keep: null}});
  interrupted.worker.start(); await interrupted.settle();
  const pending = interrupted.read(key)?._slax_offline as {body: string; fingerprint: {size: number; sha256: string}; generation: string};
  assert.equal(pending.body, 'pending'); assert.equal(interrupted.read(key)?.is_downloaded, 1);
  assert.equal(pending.fingerprint.size, Buffer.byteLength(interrupted.files.get(key)!));
  const snapshot = interrupted.snapshot(); await interrupted.close();
  const next = fixture(1, async () => assert.fail('Durable body must not refetch'), undefined, {snapshot});
  try {
    if (owner) next.collection(owner, 'doc'); else next.personal('doc');
    await next.worker.setOnline(false); next.worker.start(); await next.settle();
    const ready = next.read(key)?._slax_offline as {body: string; generation: string};
    assert.equal(ready.body, 'ready'); assert.equal(ready.generation, pending.generation); assert.equal(next.read(key)?.is_downloaded, 2);
    assert.equal(next.read(key)?._slax_offline_retry, undefined); assert.equal(next.requests.length, 0); assert.equal(next.downloadedImages.length, 0);
    assert.equal(next.read(key)?.read_position, '42'); assert.deepEqual(next.read(key)?.future, {keep: null});
    await next.worker.setOnline(true); await next.settle();
    assert.equal(next.requests.length, 0); assert.deepEqual(next.downloadedImages, [`${key}:https://images.test/one.png`]);
  } finally {await next.close();}
});

for (const damage of ['missing', 'truncated', 'same-size-corrupt'] as const) test(`interrupted body ${damage} is not promoted and is reacquired when online`, async () => {
  let first!: ReturnType<typeof fixture>;
  first = fixture(1, async () => '<p>valid body</p>', undefined, {afterWrite: () => first.worker.cancel()});
  first.personal('doc'); first.worker.start(); await first.settle(); const snapshot = first.snapshot(); await first.close();
  if (damage === 'missing') snapshot.files = [];
  else snapshot.files[0][1] = damage === 'truncated' ? '<p>valid' : '<p>other body</p>';
  const next = fixture(1, async () => '<p>repaired body</p>', undefined, {snapshot});
  try {
    next.personal('doc'); await next.worker.setOnline(false); next.worker.start(); await next.settle();
    assert.equal(next.read('doc')?.is_downloaded, 1); assert.equal((next.read('doc')?._slax_offline as {body: string}).body, 'pending');
    await next.worker.setOnline(true); await next.settle(); assert.equal(next.requests.length, 1);
    assert.equal(next.files.get('doc'), '<p>repaired body</p>'); assert.equal(next.read('doc')?.is_downloaded, 2);
  } finally {await next.close();}
});

test('a manifest-ready failure after atomic body persistence recovers on restart without honoring a network retry delay', async () => {
  let first!: ReturnType<typeof fixture>, injected = false;
  first = fixture(1, async () => '<p>durable</p>', undefined, {now: () => 1000, afterWrite: () => {if (!injected) {injected = true; throw new Error('post-commit disk acknowledgement failed');}}});
  first.personal('doc'); first.worker.start(); await first.settle(); assert.equal(first.read('doc')?.is_downloaded, 3);
  const snapshot = first.snapshot(); await first.close();
  const next = fixture(1, async () => assert.fail('Local recovery cannot redownload'), undefined, {snapshot, now: () => 1001});
  try {next.personal('doc'); await next.worker.setOnline(false); next.worker.start(); await next.settle(); assert.equal(next.read('doc')?.is_downloaded, 2); assert.equal(next.read('doc')?._slax_offline_retry, undefined);}
  finally {await next.close();}
});

test('a recovery fingerprint delayed across account revocation cannot mark the old record ready', async () => {
  let first!: ReturnType<typeof fixture>;
  first = fixture(1, undefined, undefined, {afterWrite: () => first.worker.cancel()}); first.personal('doc'); first.worker.start(); await first.settle();
  const snapshot = first.snapshot(); await first.close();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
  const next = fixture(1, undefined, undefined, {snapshot, beforeFingerprint: async () => {entered(); await held;}});
  next.personal('doc'); await next.worker.setOnline(false); next.worker.start(); await started;
  next.worker.cancel(); next.revoke(); release(); await next.settle();
  assert.equal(next.read('doc')?.is_downloaded, 1); await next.close();
});

test('interrupted-body recovery retains a manual pin but does not bypass denial, cleared state or foreign manifests', async () => {
  let first!: ReturnType<typeof fixture>;
  first = fixture(1, async () => '<p>persisted</p>', undefined, {afterWrite: () => first.worker.cancel()});
  first.personal('doc'); first.worker.start(); await first.settle(); const snapshot = first.snapshot(); await first.close();
  for (const variant of ['manual', 'denied', 'cleared', 'foreign'] as const) {
    const data = JSON.parse(snapshot.locals[0][1]);
    if (variant === 'manual') data.is_auto_cached = 0;
    if (variant === 'denied') data._slax_offline_retry.state = 'denied';
    if (variant === 'cleared') data.is_downloaded = 0;
    if (variant === 'foreign') data._slax_offline.scope = 'foreign-account';
    const next = fixture(0, async () => assert.fail('Offline recovery must not fetch'), undefined, {snapshot: {...snapshot, locals: [['doc', JSON.stringify(data)]]}});
    try {
      next.personal('doc'); await next.worker.setOnline(false); next.worker.start(); await next.settle();
      assert.equal(next.read('doc')?.is_downloaded, variant === 'manual' ? 2 : variant === 'cleared' ? 0 : 1);
      if (variant === 'manual') {assert.equal(next.read('doc')?.is_auto_cached, 0); assert.equal(next.files.get('doc'), '<p>persisted</p>');}
      else assert.equal((next.read('doc')?._slax_offline as {body: string}).body, 'pending');
      assert.equal(next.requests.length, 0);
    } finally {await next.close();}
  }
});
