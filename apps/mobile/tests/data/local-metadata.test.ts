import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {LocalBookmarkRepository} from '../../src/data/repositories/local-metadata.ts';
import type {SqlDatabase, SqlTransaction} from '../../src/data/repositories/sql.ts';

function fixture(context: {after(cleanup: () => void): void}) {
  const db = new DatabaseSync(':memory:');
  context.after(() => db.close());
  db.exec('CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY, data TEXT)');
  const calls: {sql: string; parameters: unknown[]}[] = [];
  const transaction: SqlTransaction = {
    async execute(sql, parameters = []) {
      calls.push({sql, parameters});
      return db.prepare(sql).run(...parameters as (string | number | null)[]);
    },
    async getOptional() {assert.fail('A partial metadata write must not read the existing JSON into JS');},
  };
  let serial: Promise<unknown> = Promise.resolve();
  const database: SqlDatabase = {
    ...transaction,
    async getAll() {assert.fail('A partial metadata write must not read all local rows');},
    watch() {assert.fail('A partial metadata write must not add a watcher');},
    writeTransaction<T>(work: (tx: SqlTransaction) => Promise<T>): Promise<T> {
      const result = serial.then(async () => {
        db.exec('BEGIN');
        try {const value = await work(transaction); db.exec('COMMIT'); return value;}
        catch (error) {db.exec('ROLLBACK'); throw error;}
      });
      serial = result.catch(() => undefined);
      return result;
    },
  };
  const raw = (key: string) => db.prepare('SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?').get(key)?.data as string | undefined;
  const read = (key: string) => {const value = raw(key); return value === undefined ? undefined : JSON.parse(value);};
  const seed = (key: string, value: string) => db.prepare('INSERT OR REPLACE INTO ps_data_local__local_bookmark_info VALUES (?, ?)').run(key, value);
  return {db, calls, local: new LocalBookmarkRepository(database), raw, read, seed};
}

test('small position writes send only changed fields while SQLite preserves large unknown local content', async context => {
  const f = fixture(context), outline = 'large cached outline '.repeat(50_000);
  f.seed('book', JSON.stringify({outline, overview: 'keep', future: {nested: [1, true, null]}, read_position: '1', is_auto_cached: false}));
  await f.local.update('book', {read_position: '120.5'});
  assert.equal(f.calls.length, 1);
  assert.ok(JSON.stringify(f.calls[0].parameters).length < 200);
  assert.deepEqual(f.read('book'), {outline, overview: 'keep', future: {nested: [1, true, null]}, read_position: '120.5', is_auto_cached: false});
});

test('partial writes retain JSON types and replace nested values instead of recursively merging them', async context => {
  const f = fixture(context);
  await f.local.update('book', {future: {before: 1, retained: true}, array: [1, 2], absent: 'remove', keep: 'unchanged'});
  await f.local.update('book', {future: {after: null}, array: [false, {nested: 'text'}], absent: undefined, nil: null, boolean: false, zero: 0, numericText: '0'});
  assert.deepEqual(f.read('book'), {future: {after: null}, array: [false, {nested: 'text'}], keep: 'unchanged', nil: null, boolean: false, zero: 0, numericText: '0'});
});

test('patch serialization preserves keyed toJSON behavior and omitted fields without reading stored content', async context => {
  const f = fixture(context);
  f.seed('book', '{"omitted":"old","untouched":"keep"}');
  await f.local.update('book', {keyed: {toJSON(key: string) {return key;}}, omitted: {toJSON() {return undefined;}}, nonfinite: Infinity, empty: () => {}});
  assert.deepEqual(f.read('book'), {untouched: 'keep', keyed: 'keyed', nonfinite: null});
});

test('field names are parameterized literal JSON keys rather than nested paths or SQL', async context => {
  const f = fixture(context);
  const keys = ['a.b', 'a"b', 'a\\b', '', 'x[0]', "field'); DROP TABLE ps_data_local__local_bookmark_info; --"];
  const fields = Object.fromEntries(keys.map(key => [key, {value: key}]));
  await f.local.update('book', fields);
  await f.local.update('book', Object.fromEntries(keys.map(key => [key, false])));
  assert.deepEqual(f.read('book'), Object.fromEntries(keys.map(key => [key, false])));
  await f.local.update('book', Object.fromEntries(keys.map(key => [key, undefined])));
  assert.deepEqual(f.read('book'), {});
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM ps_data_local__local_bookmark_info').get()?.count, 1);
});

test('concurrent independent metadata fields do not overwrite another queued update', async context => {
  const f = fixture(context);
  f.seed('book', '{"unknown":{"keep":true}}');
  await Promise.all([f.local.update('book', {read_position: '9'}), f.local.update('book', {outline: 'new'}), f.local.setAutoDownloadStatus('book', 2)]);
  assert.deepEqual(f.read('book'), {unknown: {keep: true}, read_position: '9', outline: 'new', is_downloaded: 2, is_auto_cached: 1});
});

test('automatic status cannot downgrade numeric or boolean manual pins and preserves exact unchanged rows', async context => {
  const f = fixture(context);
  for (const flag of ['0', '0.0', 'false']) {
    const before = `{"is_auto_cached":${flag},"is_downloaded":2,"read_position":"42","future":[true]}`;
    f.seed('book', before);
    for (const status of [0, 1, 3]) {await f.local.setAutoDownloadStatus('book', status); assert.equal(f.raw('book'), before);}
    await f.local.setAutoDownloadStatus('book', 2);
    assert.deepEqual(f.read('book'), {is_auto_cached: 0, is_downloaded: 2, read_position: '42', future: [true]});
  }
});

test('legacy string zero and absent/null flags remain automatic rather than becoming manual pins', async context => {
  const f = fixture(context);
  for (const fields of [{is_auto_cached: '0'}, {is_auto_cached: null}, {is_auto_cached: true}, {}]) {
    f.seed('book', JSON.stringify({...fields, future: 'keep'}));
    await f.local.setAutoDownloadStatus('book', 1);
    assert.deepEqual(f.read('book'), {is_auto_cached: 1, is_downloaded: 1, future: 'keep'});
  }
  await f.local.setAutoDownloadStatus('new', 2);
  assert.deepEqual(f.read('new'), {is_downloaded: 2, is_auto_cached: 1});
});

test('malformed stored JSON rolls back every partial update without erasing its original bytes', async context => {
  const f = fixture(context);
  f.seed('book', '{invalid');
  for (const operation of [() => f.local.update('book', {read_position: '1'}), () => f.local.update('book', {}), () => f.local.setAutoDownloadStatus('book', 2)]) {
    await assert.rejects(operation(), SyntaxError);
    assert.equal(f.raw('book'), '{invalid');
  }
});
