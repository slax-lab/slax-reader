import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {OfflineManifestRepository, decodeOfflineManifest, type OfflineManifestHint} from '../../src/data/repositories/offline-manifests.ts';
import {imageFailure, offlineFailure} from '../../src/data/offline-retry.ts';
import {OfflineTaskRepository} from '../../src/data/repositories/offline-tasks.ts';
import {OfflineTaskRetries} from '../../src/data/offline-tasks.ts';
import {OfflineImages} from '../../src/data/offline-images.ts';
import {ResourceScheduler} from '../../src/data/resource-scheduler.ts';
import type {SqlDatabase, SqlTransaction} from '../../src/data/repositories/sql.ts';

function fixture(context: {after(cleanup: () => void): void}) {
  const db = new DatabaseSync(':memory:'); context.after(() => db.close());
  db.exec('CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY, data TEXT)');
  let serial: Promise<unknown> = Promise.resolve(), active = true, generation = 0;
  const watchers = new Set<() => void>(), writes: string[] = [];
  const tx: SqlTransaction = {
    async execute(sql, args = []) {writes.push(sql); return db.prepare(sql).run(...args as (string | number | null)[]);},
    async getOptional<T>(sql: string, args: unknown[] = []) {return db.prepare(sql).get(...args as (string | number | null)[]) as T ?? null;},
  };
  const database: SqlDatabase = {...tx,
    async getAll<T>(sql: string, args: unknown[] = []) {return db.prepare(sql).all(...args as (string | number | null)[]) as T[];},
    writeTransaction<T>(work: (tx: SqlTransaction) => Promise<T>): Promise<T> {
      const result = serial.then(async () => {db.exec('BEGIN'); try {const value = await work(tx); db.exec('COMMIT'); watchers.forEach(notify => notify()); return value;} catch (error) {db.exec('ROLLBACK'); throw error;}});
      serial = result.catch(() => undefined); return result;
    },
    watch(sql, args, handler, {signal}) {const notify = () => {if (!signal.aborted) handler.onResult({rows: {_array: db.prepare(sql).all(...args as (string | number | null)[])}});}; watchers.add(notify); signal.addEventListener('abort', () => watchers.delete(notify), {once: true}); notify();},
  };
  const guard = () => {if (!active) throw new Error('revoked');};
  const repository = (scope = 'owner') => new OfflineManifestRepository(database, scope, () => `generation-${++generation}`, guard);
  const seed = (key: string, value: unknown) => db.prepare('INSERT OR REPLACE INTO ps_data_local__local_bookmark_info VALUES (?, ?)').run(key, JSON.stringify(value));
  const raw = (key: string) => String(db.prepare('SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?').get(key)?.data);
  const tasks = (scope = 'owner') => new OfflineTaskRepository(database, scope, () => `task-${++generation}`, guard);
  return {db, database, writes, repository, manifests: repository(), tasks, seed, raw, revoke() {active = false;}, notify() {watchers.forEach(notify => notify());}};
}
const urls = ['https://images.test/one.png', 'https://images.test/two.png'];

test('offline manifest commits are local-only, generation-bound and preserve all unrelated metadata', async t => {
  const f = fixture(t); f.seed('doc', {read_position: '7', future: {nested: true}, is_auto_cached: false, outline: 'large '.repeat(1000)});
  const pending = await f.manifests.prepare('doc', undefined, urls);
  assert.equal(pending.body, 'pending'); assert.equal((await f.manifests.read('doc'))?.generation, pending.generation);
  await f.manifests.ready('doc', pending.generation);
  await f.manifests.image('doc', pending.generation, {...pending.images[0], state: 'ready'});
  const stored = JSON.parse(f.raw('doc'));
  assert.equal(stored.read_position, '7'); assert.deepEqual(stored.future, {nested: true}); assert.equal(stored.is_auto_cached, 0); assert.equal(stored.is_downloaded, 2);
  assert.equal(stored._slax_offline.images[0].state, 'ready'); assert.equal(stored._slax_offline.images[1].state, 'pending');
  assert(f.writes.every(sql => sql.includes('ps_data_local__local_bookmark_info') && !sql.includes('ps_crud')));
  const replaced = await f.manifests.prepare('doc', undefined, urls);
  assert.notEqual(replaced.generation, pending.generation); assert.equal(replaced.images[0].state, 'ready');
  const snapshot = f.raw('doc');
  await f.manifests.ready('doc', pending.generation); await f.manifests.remove('doc', pending.generation);
  await f.manifests.image('doc', pending.generation, {...pending.images[1], state: 'ready'});
  assert.equal(f.raw('doc'), snapshot);
});

test('manifest observations carry only pending resource hints and suppress unrelated position or AI writes', async t => {
  const f = fixture(t), updates: OfflineManifestHint[][] = [];
  const stop = f.manifests.watch(rows => updates.push(rows)); t.after(stop);
  const manifest = await f.manifests.prepare('doc', 'owner-a', urls);
  assert.equal(updates.length, 1); assert.deepEqual(updates[0], []);
  await f.manifests.ready('collection-owner-a-doc', manifest.generation);
  assert.equal(updates.length, 2); assert.equal(updates[1][0].owner, 'owner-a'); assert.equal(updates[1][0].retryAt, 0);
  assert.equal('images' in updates[1][0], false); assert.equal('data' in updates[1][0], false);
  f.db.exec("UPDATE ps_data_local__local_bookmark_info SET data = json_set(data, '$.outline', 'long AI', '$.read_position', '42')"); f.notify();
  assert.equal(updates.length, 2);
  await f.manifests.image('collection-owner-a-doc', manifest.generation, {...manifest.images[0], state: 'failed', attempts: 1, retryAt: 5000});
  assert.equal(updates.at(-1)![0].retryAt, 0);
  await f.manifests.image('collection-owner-a-doc', manifest.generation, {...manifest.images[1], state: 'ready'});
  assert.equal(updates.at(-1)![0].retryAt, 5000);
  await f.manifests.image('collection-owner-a-doc', manifest.generation, {...manifest.images[0], state: 'denied'});
  assert.deepEqual(updates.at(-1), []);
});

test('another scope, invalid future versions and wrong owner paths cannot overwrite existing manifests', async t => {
  const f = fixture(t), value = await f.manifests.prepare('doc', undefined, urls), snapshot = f.raw('doc');
  await assert.rejects(f.repository('next-account').read('doc'), /incompatible/);
  await assert.rejects(f.repository('next-account').prepare('doc', undefined, urls), /incompatible/);
  assert.equal(f.raw('doc'), snapshot);
  for (const patch of [{version: 2}, {owner: 'foreign'}, {generation: '../unsafe'}, {images: [{...value.images[0], url: 'file:///private'}]}, {images: [{...value.images[0], url: 'https://user:password@images.test/one'}]}, {images: [value.images[0], value.images[0]]}]) {
    f.seed('doc', {_slax_offline: {...value, ...patch}, unknown: 'preserved'}); const prior = f.raw('doc');
    await assert.rejects(f.manifests.prepare('doc', undefined, urls)); assert.equal(f.raw('doc'), prior);
  }
  assert.throws(() => decodeOfflineManifest(JSON.stringify(value), 'foreign-key', 'owner'), /incompatible/);
});

test('revocation inside a manifest transaction rolls back without erasing the old generation', async t => {
  const f = fixture(t); f.seed('doc', {read_position: 'keep'});
  const held = f.database.writeTransaction(async () => {f.revoke();});
  const pending = f.manifests.prepare('doc', undefined, urls); await held; await assert.rejects(pending, /revoked/);
  assert.deepEqual(JSON.parse(f.raw('doc')), {read_position: 'keep'});
});

test('image failure deadlines are bounded, classify denial and honor server retry guidance', () => {
  const image = {url: urls[0], state: 'pending' as const, attempts: 0, retryAt: 0};
  assert.equal(imageFailure(image, new Error('offline'), 1000, () => 0).retryAt, 5000);
  assert.equal(imageFailure(image, {status: 429, retryAfterMs: 60_000}, 1000, () => 1).retryAt, 61_000);
  assert.equal(imageFailure({...image, attempts: 30}, {status: 503}, 1000, () => 1).retryAt, 301_000);
  for (const status of [400, 401, 403, 404, 410, 412, 416]) assert.equal(imageFailure(image, {status}, 0).state, 'denied');
  for (const status of [408, 429, 500, 503]) assert.equal(imageFailure(image, {status}, 0).state, 'failed');
});

test('manifest generation replacement and targeted image updates preserve future nested fields including nulls', async t => {
  const f = fixture(t), manifest = await f.manifests.prepare('doc', undefined, urls);
  f.seed('doc', {position: '17', _slax_offline: {...manifest, future: {setting: null}, images: manifest.images.map(image => ({...image, future: null, source: {keep: true}}))}});
  await f.manifests.image('doc', manifest.generation, {...manifest.images[0], state: 'ready'});
  let state = JSON.parse(f.raw('doc'))._slax_offline;
  assert.equal(state.images[0].future, null); assert.deepEqual(state.images[0].source, {keep: true}); assert.deepEqual(state.future, {setting: null});
  await f.manifests.prepare('doc', undefined, urls);
  state = JSON.parse(f.raw('doc'))._slax_offline;
  assert.equal(state.images[0].future, null); assert.deepEqual(state.images[0].source, {keep: true}); assert.deepEqual(state.future, {setting: null});
});

test('a malformed optional manifest cannot break the pending-image watch for healthy rows', async t => {
  const f = fixture(t), value = await f.manifests.prepare('doc', undefined, urls);
  f.seed('malformed', {_slax_offline: {...value, id: 'malformed', body: 'ready', images: ['not json', 3, null]}});
  f.db.prepare('INSERT INTO ps_data_local__local_bookmark_info VALUES (?, ?)').run('broken-json', '{broken');
  await f.manifests.ready('doc', value.generation);
  const updates: OfflineManifestHint[][] = []; const stop = f.manifests.watch(rows => updates.push(rows)); t.after(stop);
  assert.deepEqual(updates[0].map(row => row.id), ['doc']);
});

test('offline retry tickets preserve unknown fields and fence stale failure/completion by generation', async t => {
  const f = fixture(t), repository = f.tasks(); f.seed('doc', {position: '4', future: {value: null}});
  const first = (await repository.begin('doc', 'article', 1000))!;
  await repository.fail('doc', first, {state: 'failed', attempts: 1, retryAt: 6000});
  assert.equal(await repository.begin('doc', 'article', 5999), null);
  const second = (await repository.begin('doc', 'article', 6000))!;
  const snapshot = f.raw('doc'); await repository.fail('doc', first, {state: 'denied', attempts: 9, retryAt: 0}); await repository.complete('doc', first);
  assert.equal(f.raw('doc'), snapshot); assert.equal(second.attempts, 1);
  await repository.complete('doc', second); assert.deepEqual(JSON.parse(f.raw('doc')), {position: '4', future: {value: null}});
});

test('foreign or future retry records remain blocked and unchanged rather than resetting their policy', async t => {
  const f = fixture(t), repository = f.tasks(); const ticket = (await repository.begin('doc', 'pdf', 1000))!;
  for (const patch of [{scope: 'other'}, {version: 2}, {generation: '../unsafe'}, {retryAt: -1}]) {
    f.seed('doc', {future: 'keep', _slax_offline_retry: {...ticket, ...patch}}); const snapshot = f.raw('doc');
    await assert.rejects(repository.begin('doc', 'pdf', 1_000_000)); assert.equal(f.raw('doc'), snapshot);
  }
});

test('retry manager owns a single bounded due notification, survives restart and cancels timers on stop', async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: 1000});
  const f = fixture(t), changes: string[][] = [];
  const manager = new OfflineTaskRetries({repository: f.tasks(), changed: keys => changes.push([...keys]), random: () => 1});
  manager.start(); const ticket = (await manager.begin('doc', 'pdf'))!; await manager.fail('doc', ticket, new Error('offline'));
  manager.update(['doc'], true); changes.length = 0;
  f.db.exec("UPDATE ps_data_local__local_bookmark_info SET data = json_set(data, '$.outline', 'AI')"); f.notify(); assert.equal(changes.length, 0);
  t.mock.timers.tick(4999); assert.equal(changes.length, 0); t.mock.timers.tick(1); assert.deepEqual(changes, [['doc']]);
  manager.update(['doc'], true); t.mock.timers.tick(1000); assert.equal(changes.length, 1);
  const next = (await manager.begin('doc', 'pdf'))!; await manager.fail('doc', next, new Error('offline')); manager.stop(); changes.length = 0;
  t.mock.timers.tick(100_000); assert.equal(changes.length, 0);
  const restarted = new OfflineTaskRetries({repository: f.tasks(), changed: keys => changes.push([...keys])}); restarted.start(); restarted.update(['doc'], true);
  assert.equal(restarted.allowed('doc'), true); restarted.stop();
});

test('retry manager cannot let a late old failure replace a new generation or override persisted denial implicitly', async t => {
  const f = fixture(t), manager = new OfflineTaskRetries({repository: f.tasks(), changed() {}, now: () => 1000, random: () => 1}); manager.start();
  const first = (await manager.begin('doc', 'pdf'))!, second = (await manager.begin('doc', 'pdf', true))!;
  await manager.fail('doc', first, new Error('late')); assert.equal(manager.allowed('doc'), true);
  await manager.fail('doc', second, {status: 403}); manager.requestRetry('doc'); assert.equal(manager.allowed('doc'), false);
  assert.equal(await manager.begin('doc', 'pdf'), null); assert(await manager.begin('doc', 'pdf', true)); manager.stop();
});

test('protocol, identity and integrity failures stop automatic retry while a recoverable reauthentication stays retryable', () => {
  for (const error of [{kind: 'protocol', status: 502}, {code: 'offline_integrity_invalid'}, {status: 412}]) assert.equal(offlineFailure(0, error, 0).state, 'denied');
  assert.equal(offlineFailure(0, new Error('transport'), 0).state, 'failed');
  const reauth = offlineFailure(0, {name: 'ReauthenticationRequiredError'}, 0);
  assert.equal(reauth.state, 'failed'); assert.ok(reauth.retryAt > 0);
});

test('body recovery requires the exact fingerprint and current manifest, preserves unknown fields and never bypasses denial', async t => {
  const f = fixture(t), fingerprint = {size: 3, sha256: 'a'.repeat(64)};
  const pending = await f.manifests.prepare('doc', undefined, urls, fingerprint);
  const ticket = (await f.tasks().begin('doc', 'article', 1000))!;
  const original = {...JSON.parse(f.raw('doc')), is_downloaded: 1, is_auto_cached: 0, unknown: {keep: null}};
  f.seed('doc', original);
  assert.deepEqual(await f.manifests.interrupted(), ['doc']);
  assert.equal(await f.manifests.recover('doc', 'old-generation', fingerprint), false);
  assert.equal(await f.manifests.recover('doc', pending.generation, {...fingerprint, size: 4}), false);
  assert.equal(await f.manifests.recover('doc', pending.generation, {...fingerprint, sha256: 'b'.repeat(64)}), false);
  for (const retry of [{...ticket, state: 'denied'}, {...ticket, scope: 'foreign'}, {...ticket, version: 2}, {...ticket, kind: 'pdf'}, {...ticket, generation: '../invalid'}, {...ticket, attempts: -1}, null]) {
    f.seed('doc', {...original, _slax_offline_retry: retry}); const before = f.raw('doc');
    assert.equal(await f.manifests.recover('doc', pending.generation, fingerprint), false); assert.equal(f.raw('doc'), before);
  }
  f.seed('doc', original);
  assert.equal(await f.manifests.recover('doc', pending.generation, fingerprint), true);
  const next = JSON.parse(f.raw('doc')); assert.equal(next.is_downloaded, 2); assert.equal(next.is_auto_cached, 0); assert.equal(next._slax_offline.body, 'ready');
  assert.equal(next._slax_offline_retry, undefined); assert.deepEqual(next.unknown, {keep: null}); assert.deepEqual(await f.manifests.interrupted(), []);
  f.seed('doc', {...original, is_downloaded: 0}); assert.deepEqual(await f.manifests.interrupted(), []);
  assert.equal(await f.manifests.recover('doc', pending.generation, fingerprint), false);
});

test('fingerprint compatibility is additive but malformed or oversized values fail closed', async t => {
  const f = fixture(t), manifest = await f.manifests.prepare('doc', undefined, []);
  assert.equal(decodeOfflineManifest(JSON.stringify(manifest), 'doc', 'owner').fingerprint, undefined);
  for (const fingerprint of [{size: -1, sha256: 'a'.repeat(64)}, {size: 20 * 1024 * 1024 + 1, sha256: 'a'.repeat(64)}, {size: 3, sha256: '../invalid'}, null]) {
    assert.throws(() => decodeOfflineManifest(JSON.stringify({...manifest, fingerprint}), 'doc', 'owner'), /incompatible/);
  }
  const first = await f.manifests.prepare('doc', undefined, [], {size: 0, sha256: 'a'.repeat(64)});
  assert.equal(first.fingerprint?.size, 0);
  const legacy = await f.manifests.prepare('doc', undefined, []); assert.equal(legacy.fingerprint, undefined);
  assert.equal((await f.manifests.read('doc'))?.fingerprint, undefined);
});

test('a native image miss stays retryable rather than being recorded as a completed image', {timeout: 5000}, async t => {
  const f = fixture(t), resources = new ResourceScheduler('owner', () => {});
  let now = 1000, available = false, acquisitions = 0;
  const images = new OfflineImages({manifests: f.manifests, resources, eligible: () => true, assertActive() {}, now: () => now, random: () => 1,
    cache: {ensureImage: async () => {acquisitions++; return available ? 'file:///cache/image.png' : null;}},
    image: async () => {throw new Error('The native resolver owns the resource');},
  });
  t.after(async () => {await images.stop(); await resources.close();});
  const manifest = await f.manifests.prepare('doc', undefined, [urls[0]]); await f.manifests.ready('doc', manifest.generation);
  const changed = () => new Promise<void>(resolve => {
    let stop: (() => void) | undefined;
    stop = f.manifests.watch(rows => {if (!rows.length || rows[0].retryAt > now) queueMicrotask(() => {stop?.(); resolve();});});
  });
  const failed = changed(); images.start(); await failed; await images.settled();
  assert.equal(acquisitions, 1); assert.equal((await f.manifests.read('doc'))?.images[0].state, 'failed');
  assert.equal(JSON.parse(f.raw('doc')).is_downloaded, 2, 'A missing optional image cannot demote readable HTML');
  available = true; now = 6000;
  const ready = changed(); images.update(); await ready; await images.settled();
  assert.equal(acquisitions, 2); assert.equal((await f.manifests.read('doc'))?.images[0].state, 'ready');
});
