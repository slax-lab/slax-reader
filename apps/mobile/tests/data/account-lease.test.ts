import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {AccountDatabaseLease, AccountInactiveError} from '../../src/data/account-lease.ts';
import {MobileRepositories} from '../../src/data/repositories.ts';
import type {SqlDatabase, SqlTransaction} from '../../src/data/repositories.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {MemoryPreferences} from './helpers.ts';

function fixture(beforeTransaction = async () => {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY, data TEXT);');
  const transaction: SqlTransaction = {
    execute: async (sql, parameters = []) => db.prepare(sql).run(...parameters as (string | number | null)[]),
    getOptional: async <T>(sql: string, parameters: unknown[] = []) => db.prepare(sql).get(...parameters as (string | number | null)[]) as T ?? null,
  };
  const database: SqlDatabase = {...transaction,
    getAll: async <T>(sql: string, parameters: unknown[] = []) => db.prepare(sql).all(...parameters as (string | number | null)[]) as T[],
    async writeTransaction(work) {
      await beforeTransaction(); db.exec('BEGIN');
      try {const result = await work(transaction); db.exec('COMMIT'); return result;} catch (error) {db.exec('ROLLBACK'); throw error;}
    },
    watch() {throw new Error('Unused fixture watch');},
  };
  return {db, database};
}
test('a queued old reader flush cannot recreate old local JSON after account cleanup', async () => {
  let resume!: () => void, queued!: () => void;
  const gate = new Promise<void>(resolve => {resume = resolve;}), started = new Promise<void>(resolve => {queued = resolve;});
  let block = true;
  const {db, database} = fixture(async () => {if (block) {queued(); await gate;}});
  const old = new AccountDatabaseLease(database), oldRepositories = new MobileRepositories(old, () => 'unused');
  const flushing = oldRepositories.local.update('a-bookmark', {read_position: '120'});
  await started; old.invalidate();
  db.exec('DELETE FROM ps_data_local__local_bookmark_info');
  block = false;
  const next = new AccountDatabaseLease(database), nextRepositories = new MobileRepositories(next, () => 'unused');
  await nextRepositories.local.update('b-bookmark', {read_position: '5'});
  resume(); await assert.rejects(flushing, AccountInactiveError);
  await assert.rejects(oldRepositories.local.update('a-bookmark', {read_position: '121'}), AccountInactiveError);
  await assert.rejects(oldRepositories.local.read('b-bookmark'), AccountInactiveError);
  assert.deepEqual(db.prepare('SELECT id FROM ps_data_local__local_bookmark_info').all().map(row => row.id), ['b-bookmark']);
  assert.equal((await nextRepositories.local.read('b-bookmark')).read_position, '5'); db.close();
});
test('revocation rolls back an in-flight transaction and suppresses late watcher callbacks', async () => {
  let resume!: () => void, written!: () => void;
  const gate = new Promise<void>(resolve => {resume = resolve;}), started = new Promise<void>(resolve => {written = resolve;});
  const {db, database} = fixture();
  let watcher!: Parameters<SqlDatabase['watch']>[2], watchSignal!: AbortSignal, results = 0;
  database.watch = (_sql, _parameters, handler, options) => {watcher = handler; watchSignal = options.signal;};
  const lease = new AccountDatabaseLease(database);
  lease.watch('SELECT * FROM ps_data_local__local_bookmark_info', [], {onResult() {results++;}}, {signal: new AbortController().signal});
  const writing = lease.writeTransaction(async tx => {
    await tx.execute('INSERT INTO ps_data_local__local_bookmark_info VALUES (?, ?)', ['a-bookmark', '{}']);
    written(); await gate;
    await tx.execute('INSERT INTO ps_data_local__local_bookmark_info VALUES (?, ?)', ['late-a-bookmark', '{}']);
  });
  await started; lease.invalidate(); assert.equal(watchSignal.aborted, true);
  watcher.onResult({rows: {_array: [{id: 'a-bookmark'}]}}); assert.equal(results, 0);
  resume(); await assert.rejects(writing, AccountInactiveError);
  assert.equal(db.prepare('SELECT count(*) AS count FROM ps_data_local__local_bookmark_info').get()!.count, 0); db.close();
});
test('old account preference CAS cannot delete the next account continue-reading value', async () => {
  const storage = new MemoryPreferences({auth_token: 'a-token', user_id: 'a', continue_reading_bookmark: 'a-bookmark'});
  let resume!: () => void, pending!: () => void, block = true;
  const gate = new Promise<void>(resolve => {resume = resolve;}), started = new Promise<void>(resolve => {pending = resolve;});
  const preferences = new PreferenceStore({read: () => storage.read(), async compareAndSwap(revision, values) {
    if (block) {block = false; pending(); await gate;}
    return storage.compareAndSwap(revision, values);
  }});
  const {db, database} = fixture(), old = new AccountDatabaseLease(database);
  const oldPreferences = preferences.scoped(() => old.assertActive());
  let globalUpdates = 0, oldUpdates = 0;
  preferences.subscribe(() => {globalUpdates++;}); oldPreferences.subscribe(() => {oldUpdates++;});
  const oldFocusCallback = oldPreferences.update(next => {delete next.continue_reading_bookmark;});
  await started; old.invalidate();
  await preferences.update(next => {delete next.continue_reading_bookmark;});
  await preferences.update(next => {next.auth_token = 'b-token'; next.user_id = 'b'; next.continue_reading_bookmark = 'b-bookmark';});
  resume(); await assert.rejects(oldFocusCallback, AccountInactiveError);
  await assert.rejects(oldPreferences.read(), AccountInactiveError);
  assert.equal((await preferences.read()).continue_reading_bookmark, 'b-bookmark');
  assert.equal(globalUpdates, 2); assert.equal(oldUpdates, 0);
  const next = new AccountDatabaseLease(database), nextPreferences = preferences.scoped(() => next.assertActive());
  await nextPreferences.update(values => {values.user_language = 'ja';});
  assert.equal(globalUpdates, 3); assert.equal((await preferences.read()).user_language, 'ja'); db.close();
});
