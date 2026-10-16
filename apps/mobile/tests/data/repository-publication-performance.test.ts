import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MobileRepositories} from '../../src/data/repositories.ts';
import type {BookmarkRecord, CollectionRecord, SqlDatabase, SqlTransaction, TagRecord} from '../../src/data/repositories.ts';
import {MOBILE_TABLES} from '../../src/data/schema.ts';
import {AccountDatabaseLease} from '../../src/data/account-lease.ts';

type SqlValue = string | number | null;
function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const [name, table] of Object.entries(MOBILE_TABLES)) {
    if (table.options?.localOnly) continue;
    db.exec(`CREATE TABLE ${name} (id TEXT PRIMARY KEY, ${[...table.text.map(field => `${field} TEXT`), ...(table.integer ?? []).map(field => `${field} INTEGER`)].join(', ')})`);
  }
  db.exec('CREATE TABLE ps_data_local__local_bookmark_info (id TEXT PRIMARY KEY, data TEXT)');
  const watches: {sql: string; parameters: unknown[]; handler: Parameters<SqlDatabase['watch']>[2]; signal: AbortSignal}[] = [];
  const transaction: SqlTransaction = {
    async execute(sql, parameters = []) {return db.prepare(sql).run(...parameters as SqlValue[]);},
    async getOptional<T>(sql: string, parameters: unknown[] = []) {return db.prepare(sql).get(...parameters as SqlValue[]) as T ?? null;},
  };
  const database: SqlDatabase = {...transaction,
    async getAll<T>(sql: string, parameters: unknown[] = []) {return db.prepare(sql).all(...parameters as SqlValue[]) as T[];},
    async writeTransaction(work) {
      db.exec('BEGIN');
      try {const result = await work(transaction); db.exec('COMMIT'); return result;}
      catch (error) {db.exec('ROLLBACK'); throw error;}
    },
    watch(sql, parameters, handler, options) {
      const watch = {sql, parameters, handler, signal: options.signal}; watches.push(watch);
      handler.onResult({rows: {_array: db.prepare(sql).all(...parameters as SqlValue[])}});
    },
  };
  function refresh() {for (const watch of watches) if (!watch.signal.aborted) watch.handler.onResult({rows: {_array: db.prepare(watch.sql).all(...watch.parameters as SqlValue[])}});}
  function insert(table: string, fields: Record<string, SqlValue>) {
    const keys = Object.keys(fields);
    db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(fields));
  }
  const metadata = JSON.stringify({tags: ['one'], share: {show_line: true}, bookmark: {title: 'Title', target_url: 'https://example.test/article', status: 'success', description: 'Reader metadata'}});
  function addBookmark(id: string, createdAt: string, extra: Record<string, SqlValue> = {}) {
    insert('sr_user_bookmark', {id, user_id: 'account-a', alias_title: '', created_at: createdAt, updated_at: createdAt, archive_status: 0, is_starred: 1, is_read: 0, metadata, ...extra});
  }
  return {db, database, watches, refresh, insert, addBookmark, metadata, repositories: new MobileRepositories(database, () => 'generated')};
}

test('unchanged local query payloads publish once and a changed row preserves every other identity', async t => {
  const f = fixture(); t.after(() => f.db.close());
  f.addBookmark('older', '2026-10-01'); f.addBookmark('newer', '2026-10-02');
  const updates: BookmarkRecord[][] = [];
  const stop = f.repositories.watchBookmarks('inbox', rows => updates.push(rows)); t.after(stop);
  const initial = updates[0];
  for (let index = 0; index < 20; index++) f.refresh();
  assert.equal(updates.length, 1);
  assert.deepEqual(initial.map(row => row.id), ['newer', 'older']);
  assert.equal(initial[0].metadata, f.metadata);
  await f.repositories.updateBookmark('newer', {aliasTitle: 'Edited locally'}); f.refresh();
  assert.equal(updates.length, 2);
  assert.notEqual(updates[1][0], initial[0]); assert.equal(updates[1][1], initial[1]);
  assert.equal(updates[1][0].aliasTitle, 'Edited locally');
  f.refresh(); assert.equal(updates.length, 2);
  assert.deepEqual(await f.repositories.getBookmark('newer'), updates[1][0]);
  assert.doesNotMatch(f.watches[0].sql, /b\.\*/);
});

test('local cache status publishes but position/AI/profile-only writes do not', async t => {
  const f = fixture(); t.after(() => f.db.close()); f.addBookmark('one', '2026-10-01');
  const updates: BookmarkRecord[][] = [];
  t.after(f.repositories.watchBookmarks('inbox', rows => updates.push(rows)));
  await f.repositories.local.update('one', {read_position: '120', outline: 'cached', mark_comment_profiles: []}); f.refresh();
  assert.equal(updates.length, 1);
  await f.repositories.local.update('one', {is_downloaded: 1}); f.refresh();
  assert.equal(updates.length, 2); assert.equal(updates[1][0].downloadStatus, 1);
  await f.repositories.local.update('one', {is_downloaded: 2, is_auto_cached: 0}); f.refresh();
  assert.equal(updates.length, 3); assert.equal(updates[2][0].isAutoCached, false);
  await f.repositories.local.update('one', {read_position: '240', outline: 'new cached'}); f.refresh();
  assert.equal(updates.length, 3);
  assert.equal((await f.repositories.local.read('one')).read_position, '240');
});

test('source sort order, removal and filter membership changes are never suppressed', async t => {
  const f = fixture(); t.after(() => f.db.close());
  f.addBookmark('one', '2026-10-01', {starred_at: '2026-10-01', archived_at: '2026-10-01'});
  f.addBookmark('two', '2026-10-02', {starred_at: '2026-10-02', archived_at: '2026-10-02'});
  const updates: BookmarkRecord[][] = [];
  t.after(f.repositories.watchBookmarks('starred', rows => updates.push(rows)));
  const initial = updates[0];
  await f.database.execute('UPDATE sr_user_bookmark SET starred_at = ? WHERE id = ?', ['2026-10-03', 'one']); f.refresh();
  assert.equal(updates.length, 2); assert.deepEqual(updates[1].map(row => row.id), ['one', 'two']);
  assert.equal(updates[1][0], initial[1]); assert.equal(updates[1][1], initial[0]);
  await f.repositories.updateBookmark('one', {isStarred: 0}); f.refresh();
  assert.equal(updates.length, 3); assert.deepEqual(updates[2].map(row => row.id), ['two']); assert.equal(updates[2][0], initial[0]);
  await f.repositories.deleteBookmark('two'); f.refresh();
  assert.equal(updates.length, 4); assert.deepEqual(updates[3], []);
  f.refresh(); assert.equal(updates.length, 4);
  const archived: BookmarkRecord[][] = [];
  t.after(f.repositories.watchBookmarks('archived', rows => archived.push(rows)));
  assert.deepEqual(archived[0], []);
  await f.repositories.updateBookmark('one', {archiveStatus: 1}); f.refresh();
  assert.deepEqual(archived[1].map(row => row.id), ['one']);
});

test('all mapped bookmark fields, including metadata-only edits, reach subscribers', async t => {
  const f = fixture(); t.after(() => f.db.close()); f.addBookmark('one', '2026-10-01');
  const updates: BookmarkRecord[][] = [];
  t.after(f.repositories.watchBookmarks('starred', rows => updates.push(rows)));
  for (const [field, value] of [['user_id', 'account-b'], ['alias_title', 'Alias'], ['created_at', '2026-10-02'], ['updated_at', '2026-10-03'], ['archive_status', 1], ['is_read', 1], ['metadata', JSON.stringify({...JSON.parse(f.metadata), tags: ['two']})]] as const) {
    const count = updates.length;
    await f.database.execute(`UPDATE sr_user_bookmark SET ${field} = ? WHERE id = ?`, [value, 'one']); f.refresh();
    assert.equal(updates.length, count + 1, field);
    assert.notEqual(updates.at(-1)![0], updates.at(-2)![0]);
  }
  await f.database.execute("UPDATE sr_user_bookmark SET metadata = json_set(metadata, '$.bookmark.status', 'failed', '$.bookmark.title', 'Changed', '$.bookmark.target_url', 'https://example.test/new') WHERE id = 'one'"); f.refresh();
  const last = updates.at(-1)![0];
  assert.equal(last.status, 'failed'); assert.equal(last.title, 'Changed'); assert.equal(last.url, 'https://example.test/new');
  assert.equal(JSON.parse(last.metadata!).tags[0], 'two');
});

test('collection projections preserve owner-aware cache data and sorted identity reuse', async t => {
  const f = fixture(); t.after(() => f.db.close());
  f.insert('sr_collection_bookmark', {id: 'shared-one', owner_id: 'owner', alias_title: 'Shared', metadata: f.metadata, created_at: '2026-10-01', updated_at: '2026-10-01', starred_at: '2026-10-01'});
  f.insert('sr_collection_bookmark', {id: 'shared-two', owner_id: 'owner', alias_title: '', metadata: f.metadata, created_at: '2026-10-02', updated_at: '2026-10-02', starred_at: '2026-10-02'});
  await f.repositories.local.update('shared-one', {is_downloaded: 3});
  await f.repositories.local.update('collection-owner-shared-one', {is_downloaded: 2, is_auto_cached: 0});
  const updates: BookmarkRecord[][] = [];
  t.after(f.repositories.watchCollectionBookmarks('owner', rows => updates.push(rows)));
  f.refresh(); assert.equal(updates.length, 1);
  const initial = updates[0], shared = initial[1];
  assert.equal(shared.ownerId, 'owner'); assert.equal(shared.userId, ''); assert.equal(shared.archiveStatus, 0); assert.equal(shared.isRead, 0); assert.equal(shared.isStarred, 1);
  assert.equal(shared.downloadStatus, 2); assert.equal(shared.isAutoCached, false); assert.equal(shared.metadata, f.metadata);
  assert.deepEqual(await f.repositories.getBookmark('shared-one', 'owner'), shared);
  await f.database.execute("UPDATE sr_collection_bookmark SET starred_at = '2026-10-03' WHERE id = 'shared-one'"); f.refresh();
  assert.equal(updates.length, 2); assert.equal(updates[1][0], shared); assert.equal(updates[1][1], initial[0]);
});

test('mapped collection/tag and raw account rows suppress equivalent results without losing fields', async t => {
  const f = fixture(); t.after(() => f.db.close());
  f.insert('sr_user_collection', {id: 'collection', owner_id: 'owner', display_name: 'Collection', status: 1});
  f.insert('sr_user_collection_subscriber', {id: 'subscriber', collection_id: 'collection', created_at: '2026-10-01', last_read_at: '2026-10-01', subscription_end_time: '2027-01-01'});
  f.insert('sr_user_tag', {id: 'tag', tag_name: 'Tag', source: null});
  f.insert('sr_user', {id: 'user', name: 'A'});
  const collections: CollectionRecord[][] = [], tags: TagRecord[][] = [], users: Record<string, unknown>[][] = [];
  t.after(f.repositories.watchCollections(rows => collections.push(rows)));
  t.after(f.repositories.watchTags(rows => tags.push(rows)));
  t.after(f.repositories.watchUser(rows => users.push(rows)));
  f.refresh(); assert.equal(collections.length, 1); assert.equal(tags.length, 1); assert.equal(users.length, 1);
  await f.database.execute("UPDATE sr_user_tag SET source = 'auto' WHERE id = 'tag'"); f.refresh();
  assert.equal(tags.length, 1);
  await f.database.execute("UPDATE sr_user SET name = 'B' WHERE id = 'user'"); f.refresh();
  assert.equal(users.length, 2); assert.equal(users[1][0].name, 'B');
  await f.database.execute("UPDATE sr_user_collection_subscriber SET subscription_end_time = '2028-01-01' WHERE id = 'subscriber'"); f.refresh();
  assert.equal(collections.length, 2); assert.equal(collections[1][0].subscriptionEndTime, '2028-01-01');
  f.insert('sr_collection_bookmark', {id: 'shared', owner_id: 'owner', metadata: f.metadata, created_at: '2026-10-02 00:00:00'}); f.refresh();
  assert.equal(collections.length, 3); assert.equal(collections[2][0].hasNew, true);
});

test('watch cleanup and account invalidation suppress late results/errors and do not share caches', async t => {
  const f = fixture(); t.after(() => f.db.close()); f.addBookmark('one', '2026-10-01');
  const lease = new AccountDatabaseLease(f.database), repositories = new MobileRepositories(lease, () => 'unused');
  const updates: BookmarkRecord[][] = []; let errors = 0;
  const stop = repositories.watchBookmarks('inbox', rows => updates.push(rows), () => {errors++;});
  const first = updates[0][0], oldWatch = f.watches[0];
  lease.invalidate();
  assert.equal(oldWatch.signal.aborted, true);
  oldWatch.handler.onResult({rows: {_array: [{id: 'late'}]}}); oldWatch.handler.onError?.(new Error('late'));
  assert.equal(updates.length, 1); assert.equal(errors, 0); stop();
  const next = new MobileRepositories(new AccountDatabaseLease(f.database), () => 'unused');
  const nextUpdates: BookmarkRecord[][] = [];
  const nextStop = next.watchBookmarks('inbox', rows => nextUpdates.push(rows));
  assert.notEqual(nextUpdates[0][0], first);
  nextStop();
  const latestWatch = f.watches.at(-1)!;
  latestWatch.handler.onResult({rows: {_array: [{id: 'after-stop'}]}});
  assert.equal(nextUpdates.length, 1);
  const direct = f.repositories.watchBookmarks('inbox', rows => updates.push(rows), () => {errors++;});
  direct(); const directWatch = f.watches.at(-1)!;
  directWatch.handler.onResult({rows: {_array: [{id: 'unscoped-late'}]}}); directWatch.handler.onError?.(new Error('late'));
  assert.equal(updates.length, 2); assert.equal(errors, 0);
});

test('generic raw watches preserve null/key/type changes, duplicates and primitive mapped rows', t => {
  const f = fixture(); t.after(() => f.db.close());
  let handler!: Parameters<SqlDatabase['watch']>[2];
  const database: SqlDatabase = {...f.database, watch(_sql, _parameters, next) {handler = next;}};
  const repositories = new MobileRepositories(database, () => 'unused');
  const updates: Record<string, unknown>[][] = [];
  const stop = repositories.watchRows<Record<string, unknown>>('fixture', [], rows => updates.push(rows));
  const emit = (rows: Record<string, unknown>[]) => handler.onResult({rows: {_array: rows}});
  emit([{id: 'same', value: null}, {id: 'same', value: 1}]);
  emit([{value: null, id: 'same'}, {value: 1, id: 'same'}]); assert.equal(updates.length, 1);
  emit([{id: 'same'}, {id: 'same', value: '1'}]); assert.equal(updates.length, 2);
  emit([{id: 'same', value: '1'}, {id: 'same'}]); assert.equal(updates.length, 3);
  assert.deepEqual(updates[2], [{id: 'same', value: '1'}, {id: 'same'}]);
  stop();
  const primitives: number[][] = [];
  const stopPrimitive = repositories.watchRows<number>('fixture', [], rows => primitives.push(rows), undefined, row => Number(row.value));
  emit([{value: 0}]); emit([{value: 0}]); emit([{value: 1}]);
  assert.deepEqual(primitives, [[0], [1]]); stopPrimitive();
  let mappings = 0;
  const mapped: {id: string; label: string}[][] = [];
  const stopMapped = repositories.watchRows<{id: string; label: string}>('fixture', [], rows => mapped.push(rows), undefined, row => {mappings++; return {id: String(row.id), label: String(row.label)};});
  emit([{id: 'one', label: 'A'}, {id: 'two', label: 'B'}]);
  for (let index = 0; index < 20; index++) emit([{label: 'A', id: 'one'}, {label: 'B', id: 'two'}]);
  assert.equal(mappings, 2); assert.equal(mapped.length, 1);
  emit([{id: 'two', label: 'B'}, {id: 'one', label: 'A'}]);
  assert.equal(mappings, 2); assert.equal(mapped.length, 2);
  assert.equal(mapped[1][0], mapped[0][1]); assert.equal(mapped[1][1], mapped[0][0]);
  emit([{id: 'two', label: 'Changed'}, {id: 'one', label: 'A'}]);
  assert.equal(mappings, 3); assert.equal(mapped.length, 3); assert.equal(mapped[2][1], mapped[0][0]);
  stopMapped();
});
