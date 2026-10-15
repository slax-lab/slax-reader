import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {CacheEvictionRepository} from '../../src/data/repositories/cache-evictions.ts';
import {CacheEvictions} from '../../src/data/cache-eviction.ts';
import type {SqlDatabase, SqlTransaction} from '../../src/data/repositories/sql.ts';

function fixture(t: {after(cleanup: () => void): void}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec('CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY, data TEXT)');
  let serial: Promise<unknown> = Promise.resolve(), active = true, sequence = 0;
  const queries: string[] = [];
  const tx: SqlTransaction = {
    async execute(sql, args = []) {queries.push(sql); return db.prepare(sql).run(...args as (string | number | null)[]);},
    async getOptional<T>(sql: string, args: unknown[] = []) {queries.push(sql); return db.prepare(sql).get(...args as (string | number | null)[]) as T ?? null;},
  };
  const database: SqlDatabase = {...tx, async getAll<T>(sql: string, args: unknown[] = []) {queries.push(sql); return db.prepare(sql).all(...args as (string | number | null)[]) as T[];}, watch() {},
    writeTransaction<T>(work: (tx: SqlTransaction) => Promise<T>): Promise<T> {
      const next = serial.then(async () => {db.exec('BEGIN'); try {const value = await work(tx); db.exec('COMMIT'); return value;} catch (error) {db.exec('ROLLBACK'); throw error;}});
      serial = next.catch(() => undefined); return next;
    }};
  const guard = () => {if (!active) throw new Error('Account revoked');};
  const repository = (scope = 'account') => new CacheEvictionRepository(database, scope, () => `eviction-${++sequence}`, guard);
  const seed = (key: string, data: unknown) => db.prepare('INSERT OR REPLACE INTO ps_data_local__local_bookmark_info VALUES (?, ?)').run(key, JSON.stringify(data));
  const read = (key: string) => {const value = db.prepare('SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?').get(key)?.data; return value ? JSON.parse(String(value)) : null;};
  return {db, database, queries, repository, evictions: repository(), seed, read, revoke() {active = false;}};
}
const noop = () => {};

test('eviction intent uses two short preserving local commits and survives process reconstruction', async t => {
  const f = fixture(t), content = {is_downloaded: 2, is_auto_cached: 1, read_position: '42', future: {keep: null}, _slax_offline: {generation: 'body-one'}, _slax_offline_retry: {state: 'running'}};
  f.seed('doc', content); const intent = (await f.evictions.begin('doc', false, noop))!;
  assert.equal(intent.state, 'prepared'); assert.equal(intent.manifestGeneration, 'body-one');
  assert.deepEqual(f.read('doc'), {...content, _slax_eviction: intent});
  const restarted = f.repository(); assert.deepEqual(await restarted.pending(), [{key: 'doc', intent}]);
  await f.database.writeTransaction(tx => tx.execute("UPDATE ps_data_local__local_bookmark_info SET data = json_set(data, '$.read_position', '55', '$.future.new', true) WHERE id = 'doc'"));
  assert.equal(await restarted.commit('doc', intent, noop), true);
  const committed = f.read('doc'); assert.equal(committed.is_downloaded, 0); assert.equal(committed.read_position, '55');
  assert.deepEqual(committed.future, {keep: null, new: 1}); assert.equal(committed._slax_offline, undefined); assert.equal(committed._slax_offline_retry, undefined);
  await restarted.finish('doc', intent); assert.equal(f.read('doc')._slax_eviction, undefined);
  assert(f.queries.every(sql => !sql.includes('ps_crud'))); assert(f.queries.every(sql => !/SELECT data\b/i.test(sql)));
});

test('pins, changed body generations and replacement intents reject a stale eviction commit', async t => {
  const f = fixture(t);
  for (const kind of ['pin', 'body', 'intent']) {
    f.seed('doc', {is_downloaded: 2, is_auto_cached: 1, _slax_offline: {generation: 'original'}});
    const intent = (await f.evictions.begin('doc', false, noop))!;
    if (kind === 'pin') f.db.exec("UPDATE ps_data_local__local_bookmark_info SET data = json_set(data, '$.is_auto_cached', 0)");
    else if (kind === 'body') f.db.exec("UPDATE ps_data_local__local_bookmark_info SET data = json_set(data, '$._slax_offline.generation', 'replacement')");
    else f.db.exec("UPDATE ps_data_local__local_bookmark_info SET data = json_set(data, '$._slax_eviction.generation', 'replacement')");
    const before = f.read('doc'); assert.equal(await f.evictions.commit('doc', intent, noop), false); assert.deepEqual(f.read('doc'), before);
    if (kind === 'intent') {await f.evictions.finish('doc', intent); assert.deepEqual(f.read('doc'), before);}
    else {await f.evictions.finish('doc', intent); assert.equal(f.read('doc').is_downloaded, 2);}
  }
});

test('cleanup removes only an empty obsolete row and keeps reading state and unknown legacy keys', async t => {
  const f = fixture(t);
  for (const extra of [{}, {read_position: '7'}, {unknown: {keep: true}}]) {
    f.seed('doc', {is_downloaded: 2, is_auto_cached: 1, ...extra});
    const intent = (await f.evictions.begin('doc', true, noop))!; assert.equal(await f.evictions.commit('doc', intent, noop), true); await f.evictions.finish('doc', intent);
    if (!Object.keys(extra).length) assert.equal(f.read('doc'), null);
    else assert.deepEqual(f.read('doc'), {is_downloaded: 0, is_auto_cached: 1, ...extra});
  }
});

test('future or foreign eviction records cannot be overwritten, committed or consumed by recovery', async t => {
  const f = fixture(t); f.seed('doc', {is_downloaded: 2, is_auto_cached: 1});
  const intent = (await f.evictions.begin('doc', false, noop))!;
  assert.deepEqual(await f.repository('other').pending(), []);
  await assert.rejects(f.repository('other').begin('doc', false, noop), /incompatible/);
  for (const patch of [{version: 2}, {generation: null}, {generation: '../bad'}, {state: 'future'}, {manifestGeneration: '../bad'}]) {
    f.seed('doc', {is_downloaded: 2, _slax_eviction: {...intent, ...patch}}); const before = f.read('doc');
    assert.deepEqual(await f.evictions.pending(), []); await assert.rejects(f.evictions.begin('doc', false, noop)); assert.deepEqual(f.read('doc'), before);
  }
});

test('retention changes and revocation inside the commit transaction roll back metadata publication', async t => {
  const f = fixture(t); f.seed('doc', {is_downloaded: 2, is_auto_cached: 1}); const intent = (await f.evictions.begin('doc', false, noop))!;
  let checks = 0;
  await assert.rejects(f.evictions.commit('doc', intent, () => {if (++checks === 3) throw new Error('Reader acquired');}), /Reader acquired/);
  assert.equal(f.read('doc').is_downloaded, 2); assert.equal(f.read('doc')._slax_eviction.state, 'prepared');
  f.revoke(); await assert.rejects(f.evictions.finish('doc', intent), /revoked/); assert.equal(f.read('doc')._slax_eviction.state, 'prepared');
});

test('eviction recovers an intent committed before its acknowledgement rejects', async t => {
  const f = fixture(t); f.seed('doc', {is_downloaded: 2, is_auto_cached: 1, unknown: 'keep'});
  const begin = f.evictions.begin.bind(f.evictions), calls: string[] = [];
  f.evictions.begin = async (...args) => {await begin(...args); throw new Error('Lost commit acknowledgement');};
  const eviction = new CacheEvictions({repository: f.evictions, active: noop, accountActive: noop, protected: () => false, hold: async () => noop,
    files: {stage: async () => {calls.push('stage');}, restore: async () => {calls.push('restore');}, purge: async () => {calls.push('purge');}},
  });
  await assert.rejects(eviction.evict('doc', false, () => true), /Lost commit acknowledgement/);
  assert.deepEqual(calls, ['restore']); assert.equal(f.read('doc')._slax_eviction, undefined);
  assert.equal(f.read('doc').is_downloaded, 2); assert.equal(f.read('doc').unknown, 'keep');
  await eviction.wait('doc'); assert.equal(eviction.has('doc'), false);
});

test('failed cancellation rollback blocks resource access until a real restore succeeds', async t => {
  const f = fixture(t); f.seed('doc', {is_downloaded: 2, is_auto_cached: 1});
  let broken = true;
  const eviction = new CacheEvictions({repository: f.evictions, active: noop, accountActive: noop, protected: () => false, hold: async () => noop,
    files: {stage: async () => {throw Object.assign(new Error('Cancelled'), {name: 'AbortError'});}, restore: async () => {if (broken) throw new Error('Restore unavailable');}, purge: async () => assert.fail('Uncommitted files must not be purged')},
  });
  await assert.rejects(eviction.evict('doc', false, () => true), /Restore unavailable/);
  assert.equal(f.read('doc')._slax_eviction.state, 'prepared'); assert.equal(eviction.has('doc'), true);
  await assert.rejects(eviction.wait('doc'), /Restore unavailable/);
  broken = false; await eviction.wait('doc');
  assert.equal(f.read('doc')._slax_eviction, undefined); assert.equal(f.read('doc').is_downloaded, 2); assert.equal(eviction.has('doc'), false);
});
