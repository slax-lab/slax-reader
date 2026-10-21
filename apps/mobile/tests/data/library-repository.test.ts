import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {AccountSnapshot, LibraryRepository} from '../../src/data/repositories/library.ts';
import type {SqlDatabase, SqlTransaction} from '../../src/data/repositories/sql.ts';

test('AccountSnapshot replays the account value, shares one watcher and stops on account abort', () => {
  const account = new AbortController(); let starts = 0, stops = 0, publish!: (value: string) => void;
  const snapshot = new AccountSnapshot<string>((next) => {starts++; publish = next; return () => {stops++;};}, account.signal);
  const first: string[] = [], second: string[] = [];
  const unsubscribe = snapshot.subscribe(value => first.push(value));
  publish('local rows');
  snapshot.subscribe(value => second.push(value));
  assert.equal(starts, 1); assert.deepEqual(first, ['local rows']); assert.deepEqual(second, ['local rows']);
  unsubscribe(); account.abort();
  assert.equal(stops, 1);
  snapshot.subscribe(value => second.push(value)); publish('ignored');
  assert.deepEqual(second, ['local rows']);
});

for (const count of [1_000, 10_000]) test(`LibraryRepository returns the complete ${count.toLocaleString()}-row lightweight ordered projection and merges status by identity`, t => {
  const native = new DatabaseSync(':memory:'), account = new AbortController();
  t.after(() => native.close());
  native.exec(`CREATE TABLE sr_user_bookmark (
    id TEXT PRIMARY KEY, alias_title TEXT, metadata TEXT, archive_status INTEGER, is_starred INTEGER,
    created_at TEXT, starred_at TEXT, archived_at TEXT, updated_at TEXT, deleted_at TEXT
  ); CREATE TABLE ps_data_local__local_bookmark_info (id TEXT PRIMARY KEY, data TEXT);`);
  const metadata = JSON.stringify({bookmark: {title: 'Full title', target_url: 'https://example.test/item', status: 'success', description: 'large body that must not be projected'}, body: 'must not be selected'});
  const insert = native.prepare('INSERT INTO sr_user_bookmark (id, alias_title, metadata, archive_status, is_starred, created_at, starred_at, archived_at, updated_at) VALUES (?, ?, ?, 0, 1, ?, ?, ?, ?)');
  native.exec('BEGIN');
  for (let index = 0; index < count; index++) {
    const id = `bookmark-${String(index).padStart(5, '0')}`, date = `2026-10-${String(index).padStart(5, '0')}`;
    insert.run(id, '', metadata, date, date, date, date);
  }
  native.exec('COMMIT');
  const transaction: SqlTransaction = {
    async execute(sql: string, parameters: unknown[] = []) {return native.prepare(sql).run(...parameters as (string | number | null)[]);},
    async getOptional<T>(sql: string, parameters: unknown[] = []) {return native.prepare(sql).get(...parameters as (string | number | null)[]) as T ?? null;},
  };
  const database: SqlDatabase = {...transaction, accountSignal: account.signal,
    async getAll<T>(sql: string, parameters: unknown[] = []) {return native.prepare(sql).all(...parameters as (string | number | null)[]) as T[];},
    async writeTransaction(work) {return work(transaction);},
    watch(sql, parameters, handler, options) {
      const refresh = () => {if (!options.signal.aborted) handler.onResult({rows: {_array: native.prepare(sql).all(...parameters as (string | number | null)[])}});};
      watches.push(refresh); refresh();
    },
  };
  const watches: (() => void)[] = [];
  const updates: {id: string; aliasTitle: string; title: string; url: string; status: string; isStarred: number; archiveStatus: number; downloadStatus: number}[][] = [];
  const repository = new LibraryRepository(database), unsubscribe = repository.watch('inbox', undefined, rows => updates.push(rows));
  t.after(() => {unsubscribe(); account.abort();});
  const initial = updates[0]!;
  assert.equal(initial.length, count); assert.equal(initial[0]!.id, `bookmark-${String(count - 1).padStart(5, '0')}`); assert.equal(initial.at(-1)!.id, 'bookmark-00000');
  assert.equal(initial[0]!.title, 'Full title'); assert.equal(initial[0]!.url, 'https://example.test/item'); assert.equal(initial[0]!.downloadStatus, 0);
  assert.deepEqual(Object.keys(initial[0]!).sort(), ['archiveStatus', 'aliasTitle', 'downloadStatus', 'id', 'isStarred', 'status', 'title', 'url'].sort());
  for (const refresh of watches) refresh(); assert.equal(updates.length, 1, 'unchanged query rows do not republish');

  const target = 'bookmark-00000';
  native.prepare('INSERT INTO ps_data_local__local_bookmark_info (id, data) VALUES (?, ?)').run(target, JSON.stringify({is_downloaded: 1}));
  for (const refresh of watches) refresh();
  assert.equal(updates.length, 2); assert.equal(updates[1]!.length, count);
  assert.equal(updates[1]![0], initial[0], 'status-only update retains unrelated row references');
  assert.notEqual(updates[1]!.at(-1), initial.at(-1)); assert.equal(updates[1]!.at(-1)!.downloadStatus, 1);
  for (const refresh of watches) refresh(); assert.equal(updates.length, 2);
});
