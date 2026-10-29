import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {setImmediate as tickOnce} from 'node:timers/promises';
import {OfflineCoordinator} from '../../src/data/offline-coordinator.ts';
import {AccountDatabaseLease} from '../../src/data/account-lease.ts';
import {MOBILE_TABLES} from '../../src/data/schema.ts';

const tick = async (count = 6) => {for (let index = 0; index < count; index++) await tickOnce();};
function database() {
  const db = new DatabaseSync(':memory:'), watches = [];
  for (const [name, table] of Object.entries(MOBILE_TABLES)) {
    if (table.options?.localOnly) continue;
    db.exec(`CREATE TABLE ${name} (id TEXT PRIMARY KEY, ${[...table.text.map(field => `${field} TEXT`), ...(table.integer ?? []).map(field => `${field} INTEGER`)].join(', ')})`);
  }
  db.exec('CREATE TABLE ps_data_local__local_bookmark_info (id TEXT PRIMARY KEY, data TEXT)');
  const stats = {transactions: 0, statements: []};
  const transaction = {
    async execute(sql, parameters = []) {stats.statements.push(sql); return db.prepare(sql).run(...parameters);},
    async getOptional(sql, parameters = []) {return db.prepare(sql).get(...parameters) ?? null;},
  };
  const raw = {...transaction,
    async getAll(sql, parameters = []) {return db.prepare(sql).all(...parameters);},
    async writeTransaction(work) {stats.transactions++; db.exec('BEGIN'); try {const value = await work(transaction); db.exec('COMMIT'); return value;} catch (error) {db.exec('ROLLBACK'); throw error;}},
    watch(sql, parameters, handler, {signal}) {const watch = {sql, parameters, handler, signal}; watches.push(watch); handler.onResult({rows: {_array: db.prepare(sql).all(...parameters)}});},
  };
  const refresh = () => {for (const watch of watches) if (!watch.signal.aborted) watch.handler.onResult({rows: {_array: db.prepare(watch.sql).all(...watch.parameters)}});};
  const bookmark = (id, extra = {}) => db.prepare('INSERT INTO sr_user_bookmark (id, user_id, created_at, updated_at, archive_status, type, metadata) VALUES (?, ?, ?, ?, 0, ?, ?)')
    .run(id, 'account', extra.createdAt ?? `2026-10-${String(10 + Number(id.replace(/\D/g, '') || 0)).padStart(2, '0')}`, extra.updatedAt ?? 'v1', extra.type ?? 0, JSON.stringify({bookmark: {status: 'success'}}));
  const local = (id, data) => db.prepare('INSERT OR REPLACE INTO ps_data_local__local_bookmark_info (id, data) VALUES (?, ?)').run(id, JSON.stringify(data));
  const row = id => {const value = db.prepare('SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?').get(id); return value ? JSON.parse(value.data) : null;};
  return {db, raw, refresh, bookmark, local, row, stats};
}
function fakeEngine(owner = 'owner-a') {
  const calls = [], listeners = {onStatus: new Set(), onCredentialRejected: new Set()};
  let evictResult = keys => keys, openResult = {adopted: [], dropped: [], migrationPending: false};
  const engine = {
    async open(scope) {calls.push(['open', scope.owner]); return openResult;},
    async commitMigration(value) {calls.push(['commitMigration', value]);},
    async suspend(value) {calls.push(['suspend', value]);}, resume(value) {calls.push(['resume', value]);},
    async close(value) {calls.push(['close', value]);},
    setCredential(value, credential) {calls.push(['setCredential', credential]);},
    setConditions(value, conditions) {calls.push(['setConditions', conditions]);},
    applyPlan(value, plan) {calls.push(['applyPlan', structuredClone(plan)]);},
    async evict(value, keys) {calls.push(['evict', [...keys]]); return evictResult(keys);},
    protect(value, key) {calls.push(['protect', key]); return `token-${key}`;}, release(value, token) {calls.push(['release', token]);},
    async readArticle(value, key) {calls.push(['readArticle', key]); return key === 'cached' ? '<p>cached</p>' : null;},
    async fetchArticle(value, request) {calls.push(['fetchArticle', request]); return '<p>fetched</p>';},
    async pdfMetadata(value, request) {calls.push(['pdfMetadata', request]); return {filename: 'a.pdf', size: 10, document_id: 'opaque-doc', source: 'upload', text_status: 'ready', pages: 1};},
    async pdfStatus() {return {downloadedBytes: 0, totalBytes: 10, complete: false};},
    cancel(value, requestId) {calls.push(['cancel', requestId]);},
    async usage() {return {article: 0, images: 0};}, async clear() {return [];},
    addListener(event, listener) {listeners[event].add(listener); return {remove() {listeners[event].delete(listener);}};},
  };
  return {engine, calls, listeners, owner,
    status(items, from = owner) {for (const listener of listeners.onStatus) listener({owner: from, items});},
    reject(generation, from = owner) {for (const listener of listeners.onCredentialRejected) listener({owner: from, generation});},
    plans: () => calls.filter(call => call[0] === 'applyPlan').map(call => call[1]),
    setEvict(value) {evictResult = value;}, setOpen(value) {openResult = value;}};
}
function setup({limit = 50, credential = 'token-1', online = true} = {}) {
  const f = database(), e = fakeEngine(), timers = [];
  const lease = new AccountDatabaseLease(f.raw);
  let values = {cache_count: limit, download_images: 1}, current = credential ? {token: credential, reject: async () => {rejections.push(current.token); return true;}} : null;
  const prefListeners = new Set(), credentialListeners = new Set(), rejections = [];
  let now = 1000;
  const coordinator = new OfflineCoordinator({engine: e.engine, database: lease, online,
    preferences: {read: async () => values, subscribe: listener => {prefListeners.add(listener); return () => prefListeners.delete(listener);}},
    scope: {owner: e.owner, scope: '["https://api.test","account"]', origin: 'https://api.test', directory: '/data', userAgent: 'SlaxReader/ios test', clientType: 'ios', clientVersion: 'test'},
    credentials: {current: () => current, subscribe: listener => {credentialListeners.add(listener); return () => credentialListeners.delete(listener);}},
    assertActive: () => lease.assertActive(), identifier: (() => {let id = 0; return () => `request-${++id}`;})(), now: () => now,
    setTimer: (callback, delay) => {const timer = {callback, at: now + delay}; timers.push(timer); return timer;}, clearTimer: timer => {const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1);},
  });
  return {...f, e, coordinator, lease, timers, rejections,
    advance(ms) {now += ms; for (const timer of [...timers].sort((a, b) => a.at - b.at)) if (timer.at <= now) {timers.splice(timers.indexOf(timer), 1); timer.callback();}},
    setPreferences(next) {values = {...values, ...next}; prefListeners.forEach(listener => listener(values));},
    setCredential(token) {current = token ? {token, reject: async () => {rejections.push(token); current = null; return true;}} : null; credentialListeners.forEach(listener => listener());},
    async start() {coordinator.start(); await coordinator.open(); await tick();},
  };
}

test('plan diffs carry only changed tasks with bookmark versions and follow the cache limit', async t => {
  const f = setup({limit: 2}); t.after(() => f.db.close());
  f.bookmark('a', {createdAt: '2026-10-03'}); f.bookmark('b', {createdAt: '2026-10-02'}); f.bookmark('c', {createdAt: '2026-10-01'});
  await f.start();
  assert.deepEqual(f.e.plans(), [{revision: 1, upsert: [
    {key: 'a', id: 'a', kind: 'article', manual: false, version: 'v1'}, {key: 'b', id: 'b', kind: 'article', manual: false, version: 'v1'},
  ], remove: []}]);
  f.refresh(); await tick(); assert.equal(f.e.plans().length, 1, 'An unchanged watch publication sends nothing');
  f.db.prepare("UPDATE sr_user_bookmark SET updated_at = 'v2' WHERE id = 'b'").run(); f.refresh(); await tick();
  assert.deepEqual(f.e.plans().at(-1), {revision: 2, upsert: [{key: 'b', id: 'b', kind: 'article', manual: false, version: 'v2'}], remove: []});
  f.setPreferences({cache_count: 1}); await tick();
  assert.deepEqual(f.e.plans().at(-1), {revision: 3, upsert: [], remove: ['b']});
  f.setPreferences({cache_count: -1}); await tick();
  assert.deepEqual(f.e.plans().at(-1).upsert.map(task => task.key).sort(), ['b', 'c']);
  f.setPreferences({download_images: 0}); await tick();
  assert.deepEqual(f.e.calls.filter(call => call[0] === 'setConditions').map(call => call[1]), [{online: true, downloadImages: true}, {online: true, downloadImages: false}]);
});

test('status batches are written in one lease-checked transaction, at most start and resolution per article', async t => {
  const f = setup(); t.after(() => f.db.close());
  f.bookmark('a', {createdAt: '2026-10-02'}); f.bookmark('b', {createdAt: '2026-10-01'});
  await f.start(); const before = f.stats.transactions;
  f.e.status([{key: 'a', state: 'downloading', manual: false}, {key: 'b', state: 'downloading', manual: false}]);
  f.e.status([{key: 'a', state: 'complete', manual: false}]);
  f.advance(10); await tick(); assert.equal(f.stats.transactions, before, 'Events coalesce before persistence');
  f.advance(60); await tick();
  assert.equal(f.stats.transactions, before + 1);
  assert.deepEqual(f.row('a'), {is_downloaded: 2, is_auto_cached: 1}); assert.deepEqual(f.row('b'), {is_downloaded: 1, is_auto_cached: 1});
  f.refresh(); await tick();
  f.e.status([{key: 'a', state: 'complete', manual: false}]); f.advance(100); await tick();
  assert.equal(f.stats.transactions, before + 1, 'A repeated resolution is not rewritten');
  f.e.status([{key: 'b', state: 'failed', manual: false, retryAt: 5000, code: 'HTTP_503'}]); f.advance(100); await tick();
  assert.deepEqual(f.row('b'), {is_downloaded: 3, is_auto_cached: 1}); assert.equal(f.stats.transactions, before + 2);
});

test('a failed status transaction re-queues its batch behind newer states and retries with backoff', async t => {
  const f = setup(); t.after(() => f.db.close());
  f.bookmark('a', {createdAt: '2026-10-02'}); f.bookmark('b', {createdAt: '2026-10-01'});
  await f.start(); const before = f.stats.transactions, write = f.raw.writeTransaction;
  let failures = 1;
  f.raw.writeTransaction = async work => {if (failures > 0) {failures--; f.stats.transactions++; throw new Error('SQLITE_BUSY');} return write(work);};
  f.e.status([{key: 'a', state: 'downloading', manual: false}, {key: 'b', state: 'downloading', manual: false}]);
  f.advance(60); await tick();
  assert.equal(f.stats.transactions, before + 1); assert.equal(f.row('a'), null, 'The failed batch wrote nothing');
  f.e.status([{key: 'a', state: 'complete', manual: false}]);
  f.advance(60); await tick(); assert.equal(f.stats.transactions, before + 1, 'The retry waits for its backoff');
  f.advance(200); await tick();
  assert.equal(f.stats.transactions, before + 2);
  assert.deepEqual(f.row('a'), {is_downloaded: 2, is_auto_cached: 1}, 'A newer state supersedes the re-queued one');
  assert.deepEqual(f.row('b'), {is_downloaded: 1, is_auto_cached: 1}, 'The failed batch is not lost');
});

test('a failed status transaction after revocation is dropped, not retried', async t => {
  const f = setup(); t.after(() => f.db.close());
  f.bookmark('a'); await f.start(); const before = f.stats.transactions;
  f.raw.writeTransaction = async () => {f.stats.transactions++; f.coordinator.cancel(); throw new Error('revoked');};
  f.e.status([{key: 'a', state: 'downloading', manual: false}]);
  f.advance(60); await tick(); f.advance(10000); await tick();
  assert.equal(f.stats.transactions, before + 1); assert.equal(f.timers.length, 0);
});

test('an interaction defers status persistence until it ends or the maximum delay elapses', async t => {
  const f = setup(); t.after(() => f.db.close());
  f.bookmark('a'); await f.start(); const before = f.stats.transactions;
  f.coordinator.setInteractionBusy(true, 'scroll'); f.coordinator.setInteractionBusy(true, 'transition');
  f.e.status([{key: 'a', state: 'downloading', manual: false}]);
  f.advance(500); await tick(); assert.equal(f.stats.transactions, before);
  f.coordinator.setInteractionBusy(false, 'scroll'); f.advance(500); await tick(); assert.equal(f.stats.transactions, before, 'Another source is still busy');
  f.coordinator.setInteractionBusy(false, 'transition'); f.advance(60); await tick(); assert.equal(f.stats.transactions, before + 1);
  f.coordinator.setInteractionBusy(true); f.e.status([{key: 'a', state: 'complete', manual: false}]);
  f.advance(1400); await tick(); assert.equal(f.stats.transactions, before + 1);
  f.advance(150); await tick(); assert.equal(f.stats.transactions, before + 2, 'A missed interaction end cannot defer persistence forever');
  assert.equal(f.row('a').is_downloaded, 2);
});

test('evictions follow native removal and keep manual retention, collection discard and foreground protection', async t => {
  const f = setup({limit: 1}); t.after(() => f.db.close());
  f.bookmark('a', {createdAt: '2026-10-03'}); f.bookmark('b', {createdAt: '2026-10-02'}); f.bookmark('c', {createdAt: '2026-10-01'});
  f.local('a', {is_downloaded: 2, is_auto_cached: 1});
  f.local('b', {is_downloaded: 2, is_auto_cached: 1, read_position: '40', _slax_offline: {stale: true}});
  f.local('c', {is_downloaded: 2, is_auto_cached: 0});
  f.local('collection-owner-x', {is_downloaded: 2, is_auto_cached: 1});
  f.local('gone', {is_downloaded: 2, is_auto_cached: 1});
  f.local('opened', {is_downloaded: 2, is_auto_cached: 1});
  f.local('kept', {is_downloaded: 2, is_auto_cached: 1});
  f.e.setEvict(keys => keys.filter(key => key !== 'kept'));
  const release = f.coordinator.beginForeground('opened');
  await f.start(); f.advance(100); await tick();
  const evicted = f.e.calls.find(call => call[0] === 'evict')[1].sort();
  assert.deepEqual(evicted, ['b', 'collection-owner-x', 'gone', 'kept']);
  assert.deepEqual(f.row('a'), {is_downloaded: 2, is_auto_cached: 1});
  assert.deepEqual(f.row('b'), {is_downloaded: 0, is_auto_cached: 1, read_position: '40'});
  assert.deepEqual(f.row('c'), {is_downloaded: 2, is_auto_cached: 0}, 'Manual retention is never evicted');
  assert.equal(f.row('collection-owner-x'), null); assert.equal(f.row('gone'), null);
  assert.deepEqual(f.row('opened'), {is_downloaded: 2, is_auto_cached: 1}, 'A mounted Reader protects its copy');
  assert.deepEqual(f.row('kept'), {is_downloaded: 2, is_auto_cached: 1}, 'A key native retained keeps its row');
  release(); assert.deepEqual(f.e.calls.filter(call => call[0] === 'release').map(call => call[1]), ['token-opened']);
});

test('the one-time layout transition clears obsolete fields and resets dropped, PDF and unadopted rows in one transaction before acknowledging', async t => {
  const f = setup(); t.after(() => f.db.close());
  f.bookmark('a'); f.bookmark('pdf', {type: 2});
  f.local('a', {is_downloaded: 2, is_auto_cached: 1, _slax_offline: {version: 1}, _slax_offline_retry: {state: 'failed'}, outline: 'keep'});
  f.local('dropped', {is_downloaded: 2, is_auto_cached: 1});
  f.local('pdf', {is_downloaded: 2, is_auto_cached: 0, pdf_cache: {id: 'pdf', owner: null}});
  f.local('stale-start', {is_downloaded: 1, is_auto_cached: 1});
  f.local('unadopted', {is_downloaded: 2, is_auto_cached: 0});
  f.local('failed', {is_downloaded: 3, is_auto_cached: 1, _slax_eviction: {state: 'prepared'}});
  f.e.setOpen({adopted: ['a', 'dropped'], dropped: ['dropped'], migrationPending: true});
  const before = f.stats.transactions; await f.coordinator.open();
  assert.equal(f.stats.transactions, before + 1);
  assert.deepEqual(f.row('a'), {is_downloaded: 2, is_auto_cached: 1, outline: 'keep'});
  assert.equal(f.row('dropped').is_downloaded, 0); assert.equal(f.row('pdf').is_downloaded, 0); assert.deepEqual(f.row('pdf').pdf_cache, {id: 'pdf', owner: null});
  assert.equal(f.row('stale-start').is_downloaded, 0); assert.equal(f.row('unadopted').is_downloaded, 0);
  assert.deepEqual(f.row('failed'), {is_downloaded: 3, is_auto_cached: 1});
  const order = f.e.calls.map(call => call[0]);
  assert.ok(order.indexOf('commitMigration') > order.indexOf('open'));
});

test('a cached read is served once the native owner started, without waiting for the layout acknowledgement', async t => {
  const f = setup(); t.after(() => f.db.close());
  f.e.setOpen({adopted: [], dropped: [], migrationPending: true});
  let release; const gate = new Promise(resolve => {release = resolve;});
  const write = f.raw.writeTransaction.bind(f.raw);
  f.raw.writeTransaction = async work => {await gate; return write(work);};
  const opening = f.coordinator.open();
  assert.equal(await f.coordinator.readArticle('cached'), '<p>cached</p>');
  assert.equal(f.e.calls.some(call => call[0] === 'commitMigration'), false, 'The read did not wait for the migration transaction');
  release(); await opening;
  assert.ok(f.e.calls.some(call => call[0] === 'commitMigration'));
  const g = setup(); t.after(() => g.db.close());
  g.e.setOpen({adopted: [], dropped: [], migrationPending: true});
  g.raw.writeTransaction = () => new Promise(() => {});
  void g.coordinator.open().catch(() => undefined); g.lease.invalidate();
  await assert.rejects(g.coordinator.readArticle('cached'), {name: 'AccountInactiveError'}, 'A revoked account never receives the speculative read');
});

test('an interrupted transition is not acknowledged and a settled one is not repeated', async t => {
  const f = setup(); t.after(() => f.db.close());
  f.e.setOpen({adopted: [], dropped: [], migrationPending: false});
  const before = f.stats.transactions; await f.coordinator.open();
  assert.equal(f.stats.transactions, before); assert.equal(f.e.calls.some(call => call[0] === 'commitMigration'), false);
  const g = setup(); t.after(() => g.db.close());
  g.e.setOpen({adopted: [], dropped: [], migrationPending: true});
  const opening = g.coordinator.open(); g.lease.invalidate();
  await assert.rejects(opening, {name: 'AccountInactiveError'});
  await assert.rejects(g.coordinator.open(), {name: 'AccountInactiveError'});
  assert.equal(g.e.calls.some(call => call[0] === 'commitMigration'), false);
});

test('credentials push a new generation per token, null when not ready, and a 401 rejects only the matching generation', async t => {
  const f = setup(); t.after(() => f.db.close());
  await f.coordinator.open();
  const pushed = () => f.e.calls.filter(call => call[0] === 'setCredential').map(call => call[1]);
  assert.deepEqual(pushed(), [{generation: 1, token: 'token-1'}]);
  f.setCredential('token-1'); assert.equal(pushed().length, 1, 'An unchanged token keeps its generation');
  f.setCredential('token-2'); assert.deepEqual(pushed().at(-1), {generation: 2, token: 'token-2'});
  f.e.reject(1); await tick(); assert.deepEqual(f.rejections, [], 'A late 401 from an older generation is ignored');
  f.e.reject(2, 'another-owner'); await tick(); assert.deepEqual(f.rejections, []);
  f.e.reject(2); await tick();
  assert.deepEqual(f.rejections, ['token-2']); assert.equal(pushed().at(-1), null, 'Native holds no credential until a refreshed one is pushed');
  f.setCredential(null); f.setCredential('token-3'); assert.deepEqual(pushed().at(-1), {generation: 3, token: 'token-3'});
});

test('suspend holds status and plan changes; resume replays the diff and flushes without rebuilding', async t => {
  const f = setup(); t.after(() => f.db.close());
  f.bookmark('a', {createdAt: '2026-10-02'}); await f.start(); const before = f.stats.transactions, plans = f.e.plans().length;
  f.e.status([{key: 'a', state: 'downloading', manual: false}]);
  await f.coordinator.suspend();
  assert.ok(f.e.calls.some(call => call[0] === 'suspend'));
  f.advance(5000); await tick(); assert.equal(f.stats.transactions, before, 'No database write while backgrounded');
  f.bookmark('b', {createdAt: '2026-10-01'}); f.refresh(); await tick();
  f.e.status([{key: 'a', state: 'complete', manual: false}]); f.advance(5000); await tick();
  assert.equal(f.e.plans().length, plans, 'No plan is applied while suspended'); assert.equal(f.stats.transactions, before);
  await assert.rejects(f.coordinator.getArticleContent('a'), {name: 'AbortError'});
  f.coordinator.resume(); await tick(); f.advance(100); await tick();
  assert.ok(f.e.calls.some(call => call[0] === 'resume'));
  assert.deepEqual(f.e.plans().at(-1).upsert.map(task => task.key), ['b']);
  assert.equal(f.stats.transactions, before + 1); assert.equal(f.row('a').is_downloaded, 2);
  const watch = f.raw.watch, calls = f.e.calls.length;
  f.raw.watch = () => assert.fail('Idempotent warmup must not register database watches again');
  try {f.coordinator.start(); f.coordinator.start(); await tick();} finally {f.raw.watch = watch;}
  assert.equal(f.e.calls.length, calls, 'Repeated warmup does not reopen native state or rebuild the plan');
});

test('stale-owner, late, and post-revocation events never reach the database', async t => {
  const f = setup(); t.after(() => f.db.close());
  f.bookmark('a'); await f.start(); const before = f.stats.transactions;
  f.e.status([{key: 'a', state: 'complete', manual: false}], 'previous-owner');
  f.e.status([{key: 'not-planned', state: 'downloading', manual: false}]);
  f.e.status([{key: '../escape', state: 'complete', manual: false}, {key: 'a', state: 'unknown', manual: false}]);
  f.advance(100); await tick(); assert.equal(f.stats.transactions, before);
  f.e.status([{key: 'a', state: 'complete', manual: false}]);
  f.lease.invalidate(); f.coordinator.cancel(); f.advance(5000); await tick();
  assert.equal(f.stats.transactions, before); assert.equal(f.row('a'), null);
  await f.coordinator.close(); assert.ok(f.e.calls.some(call => call[0] === 'close'));
  assert.equal(f.e.listeners.onStatus.size, 0); assert.equal(f.e.listeners.onCredentialRejected.size, 0);
});

test('a removed task that had started is reset rather than left in progress', async t => {
  const f = setup({limit: 1}); t.after(() => f.db.close());
  f.bookmark('a', {createdAt: '2026-10-02'}); await f.start();
  f.e.status([{key: 'a', state: 'downloading', manual: false}]); f.advance(100); await tick(); f.refresh(); await tick();
  assert.equal(f.row('a').is_downloaded, 1);
  f.setPreferences({cache_count: 0}); await tick(); f.advance(100); await tick();
  assert.deepEqual(f.e.plans().at(-1).remove, ['a']); assert.equal(f.row('a').is_downloaded, 0);
});

test('a mounted Reader owns only its fetch start: final engine states still persist and it is protected once open', async t => {
  const f = setup(); t.after(() => f.db.close());
  f.bookmark('a', {createdAt: '2026-10-02'}); f.bookmark('race', {createdAt: '2026-10-01'});
  const release = f.coordinator.beginForeground('a'); const second = f.coordinator.beginForeground('a');
  await f.start();
  assert.deepEqual(f.e.calls.filter(call => call[0] === 'protect').map(call => call[1]), ['a']);
  const before = f.stats.transactions;
  f.e.status([{key: 'a', state: 'downloading', manual: false}]); f.advance(100); await tick();
  assert.equal(f.stats.transactions, before, 'The Reader records the start of its own foreground fetch');
  assert.equal(f.row('a'), null);
  f.e.status([{key: 'a', state: 'complete', manual: false}]); f.advance(100); await tick();
  assert.deepEqual(f.row('a'), {is_downloaded: 2, is_auto_cached: 1}, 'A completion while the Reader is open is not lost');
  // The Reader's foreground fetch started (1, manual) and the engine finished the automatic task first.
  const raceRelease = f.coordinator.beginForeground('race');
  f.local('race', {is_downloaded: 1, is_auto_cached: 0}); f.refresh(); await tick();
  f.e.status([{key: 'race', state: 'downloading', manual: false}, {key: 'race', state: 'complete', manual: false}]); f.advance(100); await tick();
  assert.deepEqual(f.row('race'), {is_downloaded: 2, is_auto_cached: 0}, 'A race-completed article ends downloaded and keeps the Reader manual retention');
  raceRelease();
  release(); assert.equal(f.e.calls.some(call => call[0] === 'release' && call[1] === 'token-a'), false, 'Another Reader still holds it'); release();
  second(); assert.deepEqual(f.e.calls.filter(call => call[0] === 'release').map(call => call[1]), ['token-race', 'token-a']);
});

test('a PDF completing while its Reader is open ends downloaded instead of stuck in progress', async t => {
  const f = setup(); t.after(() => f.db.close());
  f.bookmark('doc', {type: 2}); f.local('doc', {is_downloaded: 1, is_auto_cached: 1});
  const release = f.coordinator.beginForeground('doc');
  await f.start();
  assert.ok(f.e.plans().some(plan => plan.upsert.some(task => task.key === 'doc' && task.kind === 'pdf')));
  f.e.status([{key: 'doc', state: 'downloading', manual: false}]); f.advance(100); await tick();
  f.e.status([{key: 'doc', state: 'complete', manual: false}]); f.advance(100); await tick();
  assert.deepEqual(f.row('doc'), {is_downloaded: 2, is_auto_cached: 1});
  f.refresh(); await tick();
  f.e.status([{key: 'doc', state: 'invalidated', manual: false}]); f.advance(100); await tick();
  assert.equal(f.row('doc').is_downloaded, 0, 'A PDF identity change under an open Reader still resets the row');
  release();
});

test('a failed open is retried with bounded backoff without disabling reads or duplicating listeners', async t => {
  const f = setup(); t.after(() => f.db.close());
  f.bookmark('a');
  const open = f.e.engine.open; let failures = 2;
  f.e.engine.open = async scope => {
    if (failures-- > 0) {f.e.calls.push(['open-failed', scope.owner]); throw Object.assign(new Error('engine unavailable'), {code: 'unavailable'});}
    return open(scope);
  };
  const attempts = () => f.e.calls.filter(call => call[0] === 'open-failed' || call[0] === 'open').length;
  f.coordinator.start(); await tick();
  assert.equal(attempts(), 1); assert.equal(f.e.listeners.onStatus.size, 0, 'A failed open removes the listeners it registered');
  assert.equal(f.e.listeners.onCredentialRejected.size, 0);
  assert.equal(await f.coordinator.readArticle('cached'), null, 'A foreground read retries once immediately and degrades to no cached copy');
  assert.equal(attempts(), 2);
  assert.equal(await f.coordinator.readArticle('cached'), null);
  await assert.rejects(f.coordinator.getArticleContent('a'), /engine unavailable/);
  assert.equal(attempts(), 2, 'Reads inside the backoff window do not reopen the engine');
  assert.equal(f.e.plans().length, 0);
  f.advance(3999); await tick(); assert.equal(attempts(), 2, 'The window doubles after a failed retry');
  f.advance(1); await tick();
  assert.equal(attempts(), 3); assert.deepEqual(f.e.calls.filter(call => call[0] === 'open').map(call => call[1]), ['owner-a']);
  assert.equal(f.e.listeners.onStatus.size, 1); assert.equal(f.e.listeners.onCredentialRejected.size, 1);
  assert.deepEqual(f.e.plans().at(-1).upsert.map(task => task.key), ['a']);
  assert.deepEqual(f.e.calls.filter(call => call[0] === 'setCredential').map(call => call[1]), [{generation: 1, token: 'token-1'}]);
  assert.equal(await f.coordinator.readArticle('cached'), '<p>cached</p>');
  f.e.status([{key: 'a', state: 'complete', manual: false}]); f.advance(100); await tick();
  assert.equal(f.row('a').is_downloaded, 2);
  await f.coordinator.close(); assert.equal(f.e.listeners.onStatus.size, 0);
});

test('a failed open still closes the native owner and stops retrying once revoked', async t => {
  const f = setup(); t.after(() => f.db.close());
  f.e.engine.open = async () => {throw new Error('engine unavailable');};
  f.coordinator.start(); await tick();
  assert.equal(f.timers.length, 1, 'A background retry is scheduled');
  await f.coordinator.close();
  assert.equal(f.timers.length, 0); assert.ok(f.e.calls.some(call => call[0] === 'close'));
});

test('manually retained articles stay planned as manual tasks so native fills their pending images', async t => {
  const f = setup({limit: 1}); t.after(() => f.db.close());
  f.bookmark('a', {createdAt: '2026-10-03'}); f.bookmark('doc', {createdAt: '2026-10-02', type: 2}); f.bookmark('kept', {createdAt: '2026-10-01', updatedAt: 'v7'});
  f.local('kept', {is_downloaded: 2, is_auto_cached: 0}); f.local('doc', {is_downloaded: 2, is_auto_cached: 0, pdf_cache: {id: 'doc', owner: null}});
  f.local('orphan', {is_downloaded: 2, is_auto_cached: 0});
  await f.start();
  const tasks = f.e.plans().flatMap(plan => plan.upsert);
  assert.deepEqual(tasks.find(task => task.key === 'kept'), {key: 'kept', id: 'kept', kind: 'article', manual: true, version: 'v7'}, 'The retained article outside the window is sent with its version');
  assert.equal(tasks.some(task => task.key === 'doc' || task.key === 'orphan'), false, 'Retained PDFs and rows without a bookmark are not replanned');
  const before = f.stats.transactions;
  f.e.status([{key: 'kept', state: 'downloading', manual: true}]); f.advance(100); await tick();
  f.e.status([{key: 'kept', state: 'failed', manual: true, code: 'HTTP_503', retryAt: 9000}]); f.advance(100); await tick();
  f.e.status([{key: 'kept', state: 'invalidated', manual: true}]); f.advance(100); await tick();
  assert.equal(f.stats.transactions, before, 'Image completion never downgrades the retained row');
  assert.deepEqual(f.row('kept'), {is_downloaded: 2, is_auto_cached: 0});
  f.setPreferences({download_images: 0}); await tick(); f.advance(100); await tick();
  assert.deepEqual(f.e.plans().at(-1).remove, ['kept'], 'Disabled image downloads stop the image-only task');
  assert.deepEqual(f.row('kept'), {is_downloaded: 2, is_auto_cached: 0});
  f.setPreferences({download_images: 1}); await tick();
  assert.deepEqual(f.e.plans().at(-1).upsert.map(task => task.key), ['kept']);
});

test('cachePdf pins a manual PDF, plans it immediately and settles on its terminal state', async t => {
  const f = setup(); t.after(() => f.db.close());
  f.bookmark('doc', {type: 2}); await f.start();
  const done = f.coordinator.cachePdf('doc'); await tick();
  assert.deepEqual(f.row('doc'), {is_auto_cached: 0, is_downloaded: 1, pdf_cache: {id: 'doc', owner: null}});
  assert.ok(f.e.plans().some(plan => plan.upsert.some(task => task.key === 'doc' && task.kind === 'pdf' && task.manual)));
  f.e.status([{key: 'doc', state: 'complete', manual: true}]); await done; f.advance(100); await tick();
  assert.deepEqual(f.row('doc'), {is_auto_cached: 0, is_downloaded: 2, pdf_cache: {id: 'doc', owner: null}});
  const failed = f.coordinator.cachePdf('doc', 'owner-1'); await tick();
  f.e.status([{key: 'collection-owner-1-doc', state: 'denied', manual: true, code: 'HTTP_404'}]);
  await assert.rejects(failed, error => error.code === 'HTTP_404');
  await assert.rejects(f.coordinator.cachePdf('../x'), /Invalid PDF access context/);
});

test('foreground reads go through the engine with cancellation, descriptor normalization and transport errors', async t => {
  const f = setup(); t.after(() => f.db.close());
  assert.equal(await f.coordinator.readArticle('cached'), '<p>cached</p>'); assert.equal(await f.coordinator.readArticle('missing'), null);
  assert.equal(await f.coordinator.getArticleContent('a', 'owner-1', undefined, true), '<p>fetched</p>');
  assert.deepEqual(f.e.calls.find(call => call[0] === 'fetchArticle')[1], {key: 'collection-owner-1-a', id: 'a', collectionOwner: 'owner-1', requestId: 'request-1', force: true});
  const descriptor = await f.coordinator.getPdfMetadata('doc');
  assert.deepEqual(descriptor, {filename: 'a.pdf', size: 10, document_id: 'opaque-doc', source: 'upload', text_status: 'ready', pages: 1, url: '/v1/bookmark/pdf?bookmark_uid=doc'});
  assert.equal(f.e.calls.find(call => call[0] === 'pdfMetadata')[1].allowNetwork, true);
  assert.equal('readPdfRange' in f.coordinator, false, 'PDF bytes are served natively to the Reader page, not through JavaScript');
  const controller = new AbortController();
  f.e.engine.fetchArticle = () => new Promise(() => {});
  const pending = f.coordinator.getArticleContent('slow', undefined, controller.signal); await tick(); controller.abort();
  await assert.rejects(pending, {name: 'AbortError'}); assert.ok(f.e.calls.some(call => call[0] === 'cancel'));
  f.e.engine.pdfMetadata = async () => {throw Object.assign(new Error('denied'), {code: 'ERR_HTTP_404'});};
  await assert.rejects(f.coordinator.getPdfMetadata('doc'), error => error.name === 'ApiError' && error.status === 404 && error.stage === 'pdf-metadata');
  f.e.engine.pdfMetadata = async () => {throw Object.assign(new Error('offline'), {code: 'NETWORK'});};
  await assert.rejects(f.coordinator.getPdfMetadata('doc'), error => error.name === 'DataTransportError' && error.kind === 'network' && error.stage === 'pdf-metadata');
  f.coordinator.setOnline(false); await f.coordinator.getPdfMetadata('doc').catch(() => undefined);
  assert.deepEqual(f.e.calls.filter(call => call[0] === 'setConditions').at(-1)[1], {online: false, downloadImages: true});
});
