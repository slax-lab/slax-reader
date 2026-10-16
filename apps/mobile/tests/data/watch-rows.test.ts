import test from 'node:test';
import assert from 'node:assert/strict';
import {RowWatcher} from '../../src/data/repositories/watch-rows.ts';
import type {SqlDatabase} from '../../src/data/repositories/sql.ts';

function fixture(accountSignal?: AbortSignal) {
  const watches: {
    handler: Parameters<SqlDatabase['watch']>[2];
    signal: AbortSignal;
  }[] = [];
  const database: SqlDatabase = {
    accountSignal,
    async execute() {throw new Error('Unexpected write');},
    async getOptional() {throw new Error('Unexpected read');},
    async getAll() {throw new Error('Unexpected read');},
    async writeTransaction() {throw new Error('Unexpected transaction');},
    watch(_sql, _parameters, handler, options) {
      watches.push({handler, signal: options.signal});
    },
  };
  return {database, watches, rows: new RowWatcher(database)};
}

test('the extracted watcher never registers SQL or callbacks for a revoked account', () => {
  const account = new AbortController();
  account.abort();
  const {rows, watches} = fixture(account.signal);
  let calls = 0;
  const stop = rows.watchRows('SELECT 1', [], () => calls++, () => calls++);
  stop();
  stop();
  assert.equal(watches.length, 0);
  assert.equal(calls, 0);
});

test('watch setup failure aborts its SQL lifetime and removes the account listener', () => {
  const account = new AbortController();
  const {rows, database} = fixture(account.signal);
  let signal: AbortSignal | undefined;
  let removals = 0;
  const remove = account.signal.removeEventListener.bind(account.signal);
  account.signal.removeEventListener = (...args: Parameters<AbortSignal['removeEventListener']>) => {
    removals++;
    remove(...args);
  };
  database.watch = (_sql, _parameters, _handler, options) => {
    signal = options.signal;
    throw new Error('Registration failed');
  };
  assert.throws(() => rows.watchRows('SELECT 1', [], () => {}), /Registration failed/);
  assert.equal(signal?.aborted, true);
  assert.equal(removals, 1);
  account.abort();
  assert.equal(removals, 1);
});

test('a watch can be revoked inside publication without delivering later rows or errors', () => {
  const account = new AbortController();
  const {rows, watches} = fixture(account.signal);
  const results: unknown[][] = [];
  const errors: Error[] = [];
  const stop = rows.watchRows('SELECT 1', [], value => {
    results.push(value);
    account.abort();
  }, error => errors.push(error));
  const watch = watches[0];
  watch.handler.onResult({rows: {_array: [{id: 'first'}]}});
  watch.handler.onResult({rows: {_array: [{id: 'late'}]}});
  watch.handler.onError?.(new Error('late'));
  assert.deepEqual(results, [[{id: 'first'}]]);
  assert.deepEqual(errors, []);
  assert.equal(watch.signal.aborted, true);
  stop();
});

test('row caches are watch-local and discarded on replacement, including empty results', () => {
  const {rows, watches} = fixture();
  const first: {id: string; title: string}[][] = [];
  const second: {id: string; title: string}[][] = [];
  let mappings = 0;
  const map = (row: Record<string, unknown>) => {
    mappings++;
    return {id: String(row.id), title: String(row.title)};
  };
  const stopFirst = rows.watchRows('SELECT 1', [], value => first.push(value), undefined, map);
  const stopSecond = rows.watchRows('SELECT 1', [], value => second.push(value), undefined, map);
  const record = {id: 'one', title: 'Title', ignored: 1};
  watches[0].handler.onResult({rows: {_array: [record]}});
  watches[1].handler.onResult({rows: {_array: [record]}});
  assert.notEqual(first[0][0], second[0][0]);
  watches[0].handler.onResult({rows: {_array: [{...record, ignored: 2}]}});
  assert.equal(mappings, 3);
  assert.equal(first.length, 1);
  watches[0].handler.onResult({});
  watches[0].handler.onResult({rows: {_array: []}});
  assert.deepEqual(first[1], []);
  assert.equal(first.length, 2);
  watches[0].handler.onResult({rows: {_array: [record]}});
  assert.notEqual(first[2][0], first[0][0]);
  assert.equal(second.length, 1);
  stopFirst();
  stopSecond();
});
