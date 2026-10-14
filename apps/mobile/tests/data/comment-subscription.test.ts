import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import type {SyncStreamSubscribeOptions} from '@powersync/common';
import {AccountDatabaseLease, AccountInactiveError} from '../../src/data/account-lease.ts';
import {MobileRepositories} from '../../src/data/repositories.ts';
import type {MarkRecord, SqlDatabase, SqlSyncStreamSubscription} from '../../src/data/repositories.ts';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {resolve = accept; reject = fail;});
  return {promise, resolve, reject};
}
function fixture(context: {after: (cleanup: () => void) => void}, scoped = true) {
  const sqlite = new DatabaseSync(':memory:');
  context.after(() => sqlite.close());
  sqlite.exec('CREATE TABLE sr_bookmark_comment (id TEXT PRIMARY KEY, user_bookmark_uuid TEXT, comment TEXT)');
  const watches: {handler: Parameters<SqlDatabase['watch']>[2]; signal: AbortSignal; sql: string; parameters: unknown[]}[] = [];
  const subscriptions: {name: string; parameters?: Record<string, string>; options?: SyncStreamSubscribeOptions; pending: ReturnType<typeof deferred<SqlSyncStreamSubscription>>; unsubscribes: number; finish: () => void}[] = [];
  const database: SqlDatabase = {
    async execute(sql, parameters = []) {return sqlite.prepare(sql).run(...parameters as string[]);},
    async getOptional<T>(sql: string, parameters: unknown[] = []) {return (sqlite.prepare(sql).get(...parameters as string[]) ?? null) as T | null;},
    async getAll<T>(sql: string, parameters: unknown[] = []) {return sqlite.prepare(sql).all(...parameters as string[]) as T[];},
    async writeTransaction(work) {return work(database);},
    watch(sql, parameters, handler, options) {
      watches.push({sql, parameters, handler, signal: options.signal});
      handler.onResult({rows: {_array: sqlite.prepare(sql).all(...parameters as string[])}});
    },
    syncStream(name, parameters) {
      assert.equal(this, database);
      return {subscribe(options) {
        const pending = deferred<SqlSyncStreamSubscription>();
        const subscription = {name, parameters, options, pending, unsubscribes: 0, finish() {pending.resolve({unsubscribe() {subscription.unsubscribes++;}});}};
        subscriptions.push(subscription);
        return pending.promise;
      }};
    },
  };
  const lease = new AccountDatabaseLease(database);
  context.after(() => lease.invalidate());
  const repositories = new MobileRepositories(scoped ? lease : database, () => 'unused');
  const addComment = (id: string, bookmarkId = 'bookmark') => {
    sqlite.prepare('INSERT INTO sr_bookmark_comment VALUES (?, ?, ?)').run(id, bookmarkId, `Comment ${id}`);
    for (const watch of watches) watch.handler.onResult({rows: {_array: sqlite.prepare(watch.sql).all(...watch.parameters as string[])}});
  };
  return {database, lease, repositories, subscriptions, watches, addComment};
}

test('a fresh personal open subscribes with five days in SDK seconds and receives synchronized comments', async t => {
  const {repositories, subscriptions, watches, addComment} = fixture(t);
  const received: string[][] = [], errors: Error[] = [];
  const stop = repositories.watchComments('bookmark', rows => received.push(rows.map(row => row.id)), error => errors.push(error));
  assert.deepEqual(received, [[]]);
  assert.equal(subscriptions.length, 1);
  assert.deepEqual({name: subscriptions[0].name, parameters: subscriptions[0].parameters, options: subscriptions[0].options}, {name: 'bookmark_comment', parameters: {bookmark_uuid: 'bookmark'}, options: {ttl: 432000}});
  subscriptions[0].finish(); await setImmediate();
  addComment('remote'); assert.deepEqual(received, [[], ['remote']]);
  stop(); stop();
  assert.equal(watches[0].signal.aborted, true); assert.equal(subscriptions[0].unsubscribes, 1);
  addComment('late'); watches[0].handler.onError?.(new Error('late SQL error'));
  assert.deepEqual(received, [[], ['remote']]); assert.deepEqual(errors, []);
});

test('collection owner parameters remain separate during a delayed owner switch', async t => {
  const {repositories, subscriptions, watches} = fixture(t);
  const first: string[][] = [], second: string[][] = [], errors: Error[] = [];
  const oldStop = repositories.watchComments('bookmark', rows => first.push(rows.map(row => row.id)), error => errors.push(error), {collectionOwnerId: 'owner-a'});
  oldStop();
  const nextStop = repositories.watchComments('bookmark', rows => second.push(rows.map(row => row.id)), error => errors.push(error), {collectionOwnerId: 'owner-b'});
  assert.deepEqual(subscriptions.map(({name, parameters, options}) => ({name, parameters, options})), [
    {name: 'collection_bookmark_comment', parameters: {bookmark_uuid: 'bookmark', owner_id: 'owner-a'}, options: {ttl: 432000}},
    {name: 'collection_bookmark_comment', parameters: {bookmark_uuid: 'bookmark', owner_id: 'owner-b'}, options: {ttl: 432000}},
  ]);
  subscriptions[1].finish(); subscriptions[0].finish(); await setImmediate();
  assert.deepEqual(subscriptions.map(item => item.unsubscribes), [1, 0]);
  watches[0].handler.onResult({rows: {_array: [{id: 'stale'}]}});
  watches[0].handler.onError?.(new Error('stale owner error'));
  watches[1].handler.onResult({rows: {_array: [{id: 'current'}]}});
  assert.deepEqual(first, [[]]); assert.deepEqual(second, [[], ['current']]); assert.deepEqual(errors, []);
  nextStop(); assert.deepEqual(subscriptions.map(item => item.unsubscribes), [1, 1]);
});

test('permission disable clears rows, does not read cached marks or subscribe, and cancels the old pending handle', async t => {
  const {repositories, subscriptions, watches, addComment} = fixture(t);
  addComment('cached');
  let rows: MarkRecord[] = [];
  const stop = repositories.watchComments('bookmark', value => {rows = value;}, undefined, {collectionOwnerId: 'owner'});
  assert.equal(rows[0].id, 'cached'); stop();
  const disabledStop = repositories.watchComments('bookmark', value => {rows = value;}, undefined, {collectionOwnerId: 'owner', enabled: false});
  assert.deepEqual(rows, []); assert.equal(watches.length, 1); assert.equal(subscriptions.length, 1);
  subscriptions[0].finish(); await setImmediate();
  addComment('late'); assert.deepEqual(rows, []); assert.equal(subscriptions[0].unsubscribes, 1);
  disabledStop();
});

test('an omitted optional owner preserves the Reader personal comment call shape', async t => {
  const {repositories, subscriptions} = fixture(t);
  const errors: Error[] = [];
  const stop = repositories.watchComments('bookmark', () => {}, error => errors.push(error), {collectionOwnerId: undefined, enabled: true});
  assert.equal(subscriptions[0].name, 'bookmark_comment');
  assert.deepEqual(subscriptions[0].parameters, {bookmark_uuid: 'bookmark'});
  subscriptions[0].finish(); await setImmediate(); stop(); assert.deepEqual(errors, []);
});

test('invalid collection owners never fall back to personal subscriptions or cached SQL', t => {
  const {repositories, subscriptions, watches} = fixture(t);
  for (const collectionOwnerId of ['', '  ', null, 1]) {
    const rows: MarkRecord[][] = [], errors: Error[] = [];
    const stop = repositories.watchComments('bookmark', value => rows.push(value), error => errors.push(error), {collectionOwnerId: collectionOwnerId as string});
    assert.deepEqual(rows, [[]]); assert.match(errors[0].message, /collection owner/); stop();
  }
  assert.equal(subscriptions.length, 0); assert.equal(watches.length, 0);
});

for (const scoped of [true, false]) test(`cleanup before subscribe completion releases once and blocks late callbacks (scoped=${scoped})`, async t => {
  const {repositories, subscriptions, watches} = fixture(t, scoped);
  let results = 0, failures = 0;
  const stop = repositories.watchComments('bookmark', () => results++, () => failures++);
  stop(); stop(); subscriptions[0].finish(); await setImmediate();
  watches[0].handler.onResult({rows: {_array: [{id: 'late'}]}}); watches[0].handler.onError?.(new Error('late'));
  assert.equal(results, 1); assert.equal(failures, 0); assert.equal(subscriptions[0].unsubscribes, 1);
});

for (const pending of [true, false]) test(`account revocation releases pending/active subscriptions without prior-account delivery (pending=${pending})`, async t => {
  const {repositories, lease, database, subscriptions, watches} = fixture(t);
  let results = 0, failures = 0;
  const stop = repositories.watchComments('bookmark', () => results++, () => failures++);
  if (!pending) {subscriptions[0].finish(); await setImmediate();}
  lease.invalidate(); lease.invalidate();
  const next = new AccountDatabaseLease(database), nextRepositories = new MobileRepositories(next, () => 'unused');
  let nextResults = 0;
  const nextStop = nextRepositories.watchComments('bookmark', () => nextResults++);
  if (pending) subscriptions[0].finish();
  subscriptions[1].finish(); await setImmediate();
  watches[0].handler.onResult({rows: {_array: [{id: 'prior-account'}]}}); watches[0].handler.onError?.(new Error('prior-account'));
  assert.equal(results, 1); assert.equal(failures, 0); assert.equal(nextResults, 1);
  assert.equal(watches[0].signal.aborted, true); assert.equal(watches[1].signal.aborted, false);
  assert.deepEqual(subscriptions.map(item => item.unsubscribes), [1, 0]);
  stop(); nextStop(); next.invalidate(); assert.deepEqual(subscriptions.map(item => item.unsubscribes), [1, 1]);
});

test('revoked leases block retained streams and all late comment watches including disabled ones', async t => {
  const {lease, repositories, subscriptions, watches} = fixture(t);
  const stream = lease.syncStream('bookmark_comment', {bookmark_uuid: 'bookmark'});
  lease.invalidate();
  await assert.rejects(stream.subscribe({ttl: 432000}), AccountInactiveError);
  assert.throws(() => lease.syncStream('bookmark_comment'), AccountInactiveError);
  assert.throws(() => lease.watch('SELECT 1', [], {onResult() {}}, {signal: new AbortController().signal}), AccountInactiveError);
  let callbacks = 0;
  repositories.watchComments('bookmark', () => callbacks++, () => callbacks++)();
  repositories.watchComments('bookmark', () => callbacks++, () => callbacks++, {enabled: false})();
  assert.equal(callbacks, 0); assert.equal(subscriptions.length, 0); assert.equal(watches.length, 0);
});

for (const pending of [true, false]) test(`lease directly releases SDK handles after account revocation (pending=${pending})`, async t => {
  const {lease, subscriptions} = fixture(t);
  const subscribing = lease.syncStream('bookmark_comment', {bookmark_uuid: 'bookmark'}).subscribe({ttl: 432000});
  if (pending) {
    const rejected = assert.rejects(subscribing, AccountInactiveError);
    lease.invalidate(); subscriptions[0].finish(); await rejected;
  } else {
    subscriptions[0].finish(); const handle = await subscribing;
    lease.invalidate(); handle.unsubscribe(); handle.unsubscribe();
  }
  lease.invalidate(); assert.equal(subscriptions[0].unsubscribes, 1);
});

for (const scoped of [true, false]) test(`missing subscription handles report errors instead of pretending to subscribe (scoped=${scoped})`, async t => {
  const {repositories, subscriptions} = fixture(t, scoped);
  const errors: Error[] = [];
  const stop = repositories.watchComments('bookmark', () => {}, error => errors.push(error));
  subscriptions[0].pending.resolve({} as SqlSyncStreamSubscription); await setImmediate();
  assert.equal(errors.length, 1); assert.match(errors[0].message, /subscription handle/); stop();
});

for (const scoped of [true, false]) test(`SQL-only databases retain offline comments and explicitly report unsupported subscriptions (scoped=${scoped})`, async t => {
  const {database, repositories, addComment} = fixture(t, scoped);
  delete database.syncStream;
  addComment('cached');
  const errors: Error[] = [], rows: string[][] = [];
  const stop = repositories.watchComments('bookmark', value => rows.push(value.map(row => row.id)), error => errors.push(error));
  await setImmediate();
  assert.deepEqual(rows, [['cached']]); assert.equal(errors.length, 1); assert.match(errors[0].message, /not supported/);
  addComment('local'); assert.deepEqual(rows.at(-1), ['cached', 'local']); stop();
});

test('synchronous stream failures and asynchronous subscribe failures report while preserving offline watches', async t => {
  const {database, repositories, subscriptions, addComment} = fixture(t);
  const errors: Error[] = [];
  const syncStream = database.syncStream;
  database.syncStream = () => {throw new Error('stream setup failed');};
  const stop = repositories.watchComments('bookmark', () => {}, error => errors.push(error));
  await setImmediate(); assert.match(errors[0].message, /stream setup failed/); stop();
  database.syncStream = syncStream;
  let rows: MarkRecord[] = [];
  const nextStop = repositories.watchComments('bookmark', value => {rows = value;}, error => errors.push(error));
  subscriptions[0].pending.reject('subscribe failed'); await setImmediate();
  assert.match(errors[1].message, /subscribe failed/);
  addComment('offline'); assert.equal(rows[0].id, 'offline'); nextStop();
});

for (const revoke of [false, true]) test(`late rejected subscriptions cannot deliver errors after disposal (revoke=${revoke})`, async t => {
  const {repositories, lease, subscriptions} = fixture(t);
  let errors = 0;
  const stop = repositories.watchComments('bookmark', () => {}, () => errors++);
  if (revoke) lease.invalidate(); else stop();
  subscriptions[0].pending.reject(new Error('late subscribe rejection')); await setImmediate();
  assert.equal(errors, 0); stop();
});

test('watch setup failure reports once and never starts a remote subscription', t => {
  const {database, repositories, subscriptions} = fixture(t);
  let signal: AbortSignal | undefined;
  database.watch = (_sql, _parameters, _handler, options) => {signal = options.signal; throw new Error('watch failed');};
  const errors: Error[] = [];
  const stop = repositories.watchComments('bookmark', () => {}, error => errors.push(error));
  assert.equal(errors.length, 1); assert.match(errors[0].message, /watch failed/);
  assert.equal(subscriptions.length, 0); assert.equal(signal?.aborted, true); stop();
});

test('throwing error handlers and unsubscribe failures do not leave unhandled rejections or block cleanup', async t => {
  const {repositories, subscriptions, lease} = fixture(t);
  repositories.watchComments('bookmark', () => {}, () => {throw new Error('consumer error');});
  subscriptions[0].pending.reject(new Error('subscribe failed')); await setImmediate();
  const stop = repositories.watchComments('bookmark', () => {});
  let released = 0;
  subscriptions[1].pending.resolve({unsubscribe() {released++; throw new Error('unsubscribe failed');}});
  const secondStop = repositories.watchComments('bookmark', () => {});
  subscriptions[2].pending.resolve({unsubscribe() {released++; return Promise.reject(new Error('async unsubscribe failed'));}});
  const thirdStop = repositories.watchComments('bookmark', () => {});
  subscriptions[3].finish(); await setImmediate();
  lease.invalidate(); stop(); secondStop(); thirdStop(); await setImmediate();
  assert.equal(released, 2); assert.equal(subscriptions[3].unsubscribes, 1);
});

test('collection unread comparison uses UTC for zone-less source timestamps', t => {
  const {database, repositories} = fixture(t);
  database.watch = (_sql, _parameters, handler) => handler.onResult({rows: {_array: [
    {id: 'equal', latest_article_at: '2026-10-11T01:00:00', last_read_at: '2026-10-11T01:00:00Z'},
    {id: 'new', latest_article_at: '2026-10-11T01:00:01', last_read_at: '2026-10-11T01:00:00Z'},
    {id: 'invalid', latest_article_at: 'invalid', last_read_at: ''},
  ]}});
  const stop = repositories.watchCollections(rows => assert.deepEqual(rows.map(row => [row.id, row.hasNew]), [['equal', false], ['new', true], ['invalid', false]]));
  stop();
});
