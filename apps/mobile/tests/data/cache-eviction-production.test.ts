import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {setImmediate} from 'node:timers/promises';
import {BackgroundArticleCache, PERSONAL_CACHE_SQL, LOCAL_CACHE_SQL} from '../../src/data/background-cache.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {MemoryPreferences} from './helpers.ts';
import type {SqlDatabase, SqlTransaction} from '../../src/data/repositories.ts';

const deferred = () => {let resolve!: () => void; const promise = new Promise<void>(done => {resolve = done;}); return {promise, resolve};};
async function until(check: () => boolean) {for (let attempt = 0; attempt < 100; attempt++) {if (check()) return; await setImmediate();} assert(check(), 'condition did not settle');}

function fixture(options: {stage?: (calls: string[], key: string, generation: string, signal: AbortSignal) => Promise<void>; count?: number; locals?: Map<string, Record<string, unknown>>} = {}) {
  const locals = options.locals ?? new Map<string, Record<string, unknown>>();
  const rows: Record<string, unknown>[] = [{id: 'archived', status: 'success', content_type: 0}];
  const calls: string[] = [];
  const listeners = new Set<() => void>();
  let active = true, transactionTail: Promise<unknown> = Promise.resolve();
  const sync = () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec('CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY, data TEXT)');
      const insert = sqlite.prepare('INSERT INTO ps_data_local__local_bookmark_info VALUES (?, ?)');
      for (const [id, data] of locals) insert.run(id, JSON.stringify(data));
      return sqlite;
    } catch (error) {sqlite.close(); throw error;}
  };
  const tx: SqlTransaction = {
    async execute(sql, args = []) {const sqlite = sync(); try {const result = sqlite.prepare(sql).run(...args as (string | number | null)[]); const next = sqlite.prepare('SELECT id, data FROM ps_data_local__local_bookmark_info').all(); locals.clear(); for (const row of next) locals.set(String(row.id), JSON.parse(String(row.data))); return result;} finally {sqlite.close();}},
    async getOptional<T>(sql: string, args: unknown[] = []) {const sqlite = sync(); try {return sqlite.prepare(sql).get(...args as (string | number | null)[]) as T ?? null;} finally {sqlite.close();}},
  };
  const database: SqlDatabase = {...tx, async getAll<T>(sql: string, args: unknown[] = []) {const sqlite = sync(); try {return sqlite.prepare(sql).all(...args as (string | number | null)[]) as T[];} finally {sqlite.close();}},
    writeTransaction(work) {const result = transactionTail.then(async () => work(tx)); transactionTail = result.catch(() => undefined); return result;},
    watch(sql, args, handler, {signal}) {const notify = () => {if (signal.aborted) return; if (sql === PERSONAL_CACHE_SQL) handler.onResult({rows: {_array: rows}}); else if (sql === LOCAL_CACHE_SQL) {const sqlite = sync(); try {handler.onResult({rows: {_array: sqlite.prepare(sql).all(...args as (string | number | null)[])}});} finally {sqlite.close();}} else handler.onResult({rows: {_array: []}});}; listeners.add(notify); signal.addEventListener('abort', () => listeners.delete(notify), {once: true}); notify();},
  };
  const worker = new BackgroundArticleCache({database, preferences: new PreferenceStore(new MemoryPreferences({cache_count: options.count ?? 0})), assertActive() {assert(active, 'Account revoked');}, identifier: () => `generation-${calls.length + 1}`,
    cache: {async writeArticle() {throw new Error('No download expected');}, async removeArticle() {throw new Error('Legacy transaction deletion must not run');}, async ensureImage() {return null;}},
    content: async () => '<p>remote</p>', image: async () => new Uint8Array([1]),
    removal: {
      async stage(key, generation, signal) {calls.push(`stage:${key}:${generation}`); await options.stage?.(calls, key, generation, signal);},
      async restore(key, generation) {calls.push(`restore:${key}:${generation}`);},
      async purge(key, generation) {calls.push(`purge:${key}:${generation}`);},
    }});
  return {worker, calls, locals, notify() {listeners.forEach(notify => notify());}, revoke() {active = false;}, async settled() {await worker.settled(); await setImmediate(); await worker.settled();}};
}

test('production eviction stages files before the short metadata commit and finishes with a purge', async () => {
  const f = fixture({locals: new Map([['archived', {is_downloaded: 2, is_auto_cached: 1, read_position: '17', unknown: {keep: true}}]])});
  f.worker.start(); await f.settled();
  assert.equal(f.calls.length, 2); assert(f.calls[0].startsWith('stage:archived:generation-')); assert(f.calls[1].startsWith('purge:archived:generation-'));
  assert.equal(f.calls[0].split(':')[2], f.calls[1].split(':')[2]);
  assert.deepEqual(f.locals.get('archived'), {is_downloaded: 0, is_auto_cached: 1, read_position: '17', unknown: {keep: true}});
  await f.worker.stop();
});

test('interrupted prepared and committed removal receipts recover before normal eviction resumes', async () => {
  const prepared = {is_downloaded: 2, is_auto_cached: 1, read_position: '8', _slax_eviction: {version: 1, scope: 'account-instance', generation: 'prepared-one', state: 'prepared', discardRow: false, manifestGeneration: null}};
  const committed = {is_downloaded: 0, is_auto_cached: 1, _slax_eviction: {version: 1, scope: 'account-instance', generation: 'committed-one', state: 'committed', discardRow: false, manifestGeneration: null}};
  const f = fixture({locals: new Map([['prepared-doc', prepared], ['committed-doc', committed]])});
  f.worker.start(); await f.settled();
  assert.deepEqual(f.calls, ['restore:prepared-doc:prepared-one', 'purge:committed-doc:committed-one', 'stage:prepared-doc:generation-3', 'purge:prepared-doc:generation-3']);
  assert.equal(f.locals.get('prepared-doc')?.is_downloaded, 0); assert.equal(f.locals.get('prepared-doc')?._slax_eviction, undefined);
  assert.deepEqual(f.locals.get('committed-doc'), {is_downloaded: 0, is_auto_cached: 1});
  await f.worker.stop();
});

test('reader access cancels a staged removal and restores its live file paths', async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({locals: new Map([['archived', {is_downloaded: 2, is_auto_cached: 1}]]), async stage(calls, key, generation, signal) {
    entered.resolve(); await release.promise; if (signal.aborted) throw Object.assign(new Error('retained'), {name: 'AbortError'});
  }});
  f.worker.start(); await entered.promise;
  const stop = f.worker.beginForeground('archived'); const access = f.worker.waitForAccess('archived'); release.resolve();
  await access; assert(f.locals.get('archived')); stop(); await f.worker.stop();
  assert.equal(f.calls.filter(call => call.startsWith('restore:archived:')).length, 1);
});

test('pause cancels queued file detachment while keeping a durable receipt for the next foreground resume', async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({locals: new Map([['archived', {is_downloaded: 2, is_auto_cached: 1}]]), async stage(_calls, _key, _generation, signal) {
    entered.resolve(); await release.promise; if (signal.aborted) throw Object.assign(new Error('paused'), {name: 'AbortError'});
  }});
  f.worker.start(); await entered.promise; await until(() => !!f.locals.get('archived')?._slax_eviction); const paused = f.worker.pause(); release.resolve(); await paused;
  const receipt = f.locals.get('archived')?._slax_eviction as {generation: string; state: string} | undefined;
  assert.equal(receipt, undefined, 'A pre-detach cancellation is allowed to roll back its durable receipt');
  assert.equal(f.locals.get('archived')?.is_downloaded, 2); assert.equal(f.calls.length, 2); assert(f.calls[1].startsWith('restore:archived:'));
  f.worker.resume(); await until(() => f.calls.length === 4);
  await f.settled(); assert.equal(f.locals.get('archived')?._slax_eviction, undefined); assert.equal(f.locals.get('archived')?.is_downloaded, 0);
  await f.worker.stop();
});
