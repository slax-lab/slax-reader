import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {decodeLegacyPreferences, migrateLegacyPreferences} from '../../src/data/legacy-preferences.ts';
import {verifiedDatabaseLocation, UpgradeVerificationRequired} from '../../src/data/upgrade.ts';
import {imageCachePath} from '../../src/data/cache-paths.ts';
import {bookmarkCacheKey, MobileRepositories} from '../../src/data/repositories.ts';
import type {SqlDatabase, SqlTransaction} from '../../src/data/repositories.ts';
import {createSyncConnector} from '../../src/data/connector.ts';
import type {SlaxApi} from '../../src/data/api.ts';
import {MemoryPreferences} from './helpers.ts';

const varint = (value: bigint): number[] => {const bytes: number[] = []; do {const next = Number(value & 127n); value >>= 7n; bytes.push(next | (value ? 128 : 0));} while (value); return bytes;};
const message = (tag: number, data: number[]) => [tag, ...varint(BigInt(data.length)), ...data];
const string = (value: string) => Array.from(new TextEncoder().encode(value));
const entry = (name: string, value: number[]) => message(10, [...message(10, string(name)), ...message(18, value)]);
test('legacy AndroidX proto imports all installation preferences atomically and idempotently', async () => {
  const bytes = [
    ...entry('auth_token', message(42, string('fixture-token'))), ...entry('user_id', message(42, string('fixture-user'))),
    ...entry('cache_count', [24, ...varint(BigInt.asUintN(64, -1n))]), ...entry('download_images', [24, 0]),
    ...entry('powersync_refresh_time', [32, ...varint(1720000000123n)]), ...entry('analytics_device_id', message(42, string('stable-fixture'))),
    ...entry('user_language', message(42, string('ja'))), ...entry('selected_env', message(42, string('dev'))),
    ...entry('last_refresh_time', message(42, string('1720000000'))), ...entry('continue_reading_bookmark', message(42, string('{"bookmarkId":"b","title":"t","collectionOwnerId":"owner"}'))),
    ...entry('user_setting_detail_do_not_alert', message(42, string('true'))),
  ];
  const store = new PreferenceStore(new MemoryPreferences()); let reads = 0;
  const source = {readLegacyPreferences: async () => {reads++; return {bytes, fingerprint: 'fixture-fingerprint'};}};
  assert.equal(await migrateLegacyPreferences(store, source), 'migrated');
  assert.equal(await migrateLegacyPreferences(store, source), 'already-migrated'); assert.equal(reads, 1);
  const settings = await store.settings(); assert.equal(settings.cacheCount, -1); assert.equal(settings.downloadImages, false); assert.equal(settings.detailDoNotAlert, true);
  assert.equal((await store.read()).powersync_refresh_time, 1720000000123);
  assert.equal(await store.deviceId(() => 'replacement'), 'stable-fixture');
  assert.throws(() => decodeLegacyPreferences(new Uint8Array(entry('future-bytes', message(66, [1, 2])))), /stopped/);
  assert.throws(() => decodeLegacyPreferences(new Uint8Array([10, 100, 1])), /Truncated/);
});
test('CAS contention preserves an extension update while importing original preferences', async () => {
  const storage = new MemoryPreferences(), store = new PreferenceStore(storage);
  storage.beforeSwap = () => {storage.beforeSwap = undefined; storage.values = {auth_token: 'extension-new'}; storage.revision++;};
  await migrateLegacyPreferences(store, {readLegacyPreferences: async () => ({bytes: entry('auth_token', message(42, string('legacy-old'))), fingerprint: 'source'})});
  assert.equal((await store.read()).auth_token, 'extension-new');
  assert.equal((await store.read())._slax_preferences_migration_v1, 'source');
});
test('existing database requires complete adoption evidence and no filename fallback', () => {
  const inventory = {scanComplete: true, databaseCandidates: ['/legacy/powersync.db'], legacyDataDirectory: '/legacy', newDatabaseDirectory: '/new'};
  assert.throws(() => verifiedDatabaseLocation(inventory), UpgradeVerificationRequired);
  assert.throws(() => verifiedDatabaseLocation({...inventory, scanComplete: false, databaseCandidates: []}), UpgradeVerificationRequired);
  assert.deepEqual(verifiedDatabaseLocation({...inventory, databaseCandidates: []}), {dbFilename: 'powersync.db', dbLocation: '/new', adopted: false});
  const evidence = {databasePath: '/legacy/powersync.db', legacySdk: 'powersync-kotlin-1.14.1', targetSdk: 'powersync-react-native-2.3.1', schemaVersion: '2', supportedOnDiskAdoption: true, verifiedFixtures: {pendingQueue: true, transactionBoundaries: true, offlineRows: true, localJson: true, reconnectOrder: true}, report: 'test fixture, not a device acceptance report'} as const;
  assert.deepEqual(verifiedDatabaseLocation(inventory, evidence), {dbFilename: 'powersync.db', dbLocation: '/legacy', adopted: true});
  assert.throws(() => verifiedDatabaseLocation({...inventory, databaseCandidates: ['/different/powersync.db']}, evidence), UpgradeVerificationRequired);
});
test('cached PowerSync credentials retain milliseconds and cannot race a newer login', async () => {
  const storage = new MemoryPreferences({auth_token: 'a', user_id: 'u', powersync_refresh_time: 1000, powersync_connect_url: 'https://sync.example', powersync_token: 'cached', powersync_api_origin: 'https://api.example'});
  const prefs = new PreferenceStore(storage), sessions = {getSession: async () => ({token: String(storage.values.auth_token), userId: String(storage.values.user_id), refreshedAt: 0}), clearIfMatches: async () => false};
  let calls = 0;
  const api = {options: {baseUrl: 'https://api.example'}, getSyncToken: async () => {calls++; storage.values = {auth_token: 'b', user_id: 'new'}; storage.revision++; return {endpoint: 'https://new.example', token: 'fetched'};}} as SlaxApi;
  const connector = createSyncConnector(api, prefs, sessions, undefined, () => 2000);
  assert.deepEqual(await connector.fetchCredentials(), {endpoint: 'https://sync.example', token: 'cached'}); assert.equal(calls, 0);
  const force = createSyncConnector(api, prefs, sessions, 'https://local.example', () => 2000);
  assert.equal(await force.fetchCredentials(), null); assert.equal(storage.values.powersync_token, undefined);
});
test('unscoped legacy credentials and a different API environment require fresh sync credentials', async () => {
  const storage = new MemoryPreferences({auth_token: 'fixture', user_id: 'u', powersync_refresh_time: 1000, powersync_connect_url: 'https://old-sync.example', powersync_token: 'cached'});
  const preferences = new PreferenceStore(storage), sessions = {getSession: async () => ({token: 'fixture', userId: 'u', refreshedAt: 0}), clearIfMatches: async () => false};
  let calls = 0;
  const api = {options: {baseUrl: 'https://api.example'}, getSyncToken: async () => {calls++; return {endpoint: 'https://new-sync.example', token: 'fresh'};}} as SlaxApi;
  const connector = createSyncConnector(api, preferences, sessions, undefined, () => 2000);
  assert.equal((await connector.fetchCredentials())?.token, 'fresh'); assert.equal(calls, 1);
  await connector.fetchCredentials(); assert.equal(calls, 1);
  api.options.baseUrl = 'https://beta.example'; await connector.fetchCredentials(); assert.equal(calls, 2);
  assert.equal((await preferences.read()).powersync_api_origin, 'https://beta.example');
});
function sqliteDatabase(): {db: DatabaseSync; adapter: SqlDatabase} {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY, data TEXT); CREATE TABLE sr_bookmark_comment(id TEXT PRIMARY KEY, type INTEGER, source TEXT, user_bookmark_uuid TEXT, comment TEXT, approx_source TEXT, content TEXT, is_deleted INTEGER, created_at TEXT, metadata TEXT);');
  const base: SqlTransaction = {execute: async (sql, params = []) => db.prepare(sql).run(...params as (string | number | null)[]), getOptional: async <T>(sql: string, params: unknown[] = []) => db.prepare(sql).get(...params as (string | number | null)[]) as T ?? null};
  const adapter: SqlDatabase = {...base, getAll: async <T>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params as (string | number | null)[]) as T[], writeTransaction: async work => {db.exec('BEGIN'); try {const value = await work(base); db.exec('COMMIT'); return value;} catch (error) {db.exec('ROLLBACK'); throw error;}}, watch: () => {throw new Error('Unused in this fixture');}};
  return {db, adapter};
}
test('real SQLite local updates retain hidden fields and preserve pinned cache status', async () => {
  const {db, adapter} = sqliteDatabase(); const repos = new MobileRepositories(adapter, () => 'mark-fixture');
  const key = bookmarkCacheKey('bookmark', 'owner');
  db.prepare('INSERT INTO ps_data_local__local_bookmark_info VALUES (?, ?)').run(key, JSON.stringify({overview: 'summary', key_takeaways: '["one"]', outline: 'outline', outline_read_position: '7', read_position: '1.5', mark_users: 'profiles', is_downloaded: 2, is_auto_cached: 0, future_field: {retained: true}}));
  await repos.local.update(key, {read_position: '2.25'}); await repos.local.setAutoDownloadStatus(key, 1);
  const preserved = await repos.local.read(key); assert.equal(preserved.is_downloaded, 2); assert.equal(preserved.is_auto_cached, 0); assert.equal(preserved.read_position, '2.25'); assert.deepEqual(preserved.future_field, {retained: true});
  await repos.local.setAutoDownloadStatus(key, 2); assert.equal((await repos.local.read(key)).is_auto_cached, 0); db.close();
});
test('mark fixture retains legacy path offsets/thread metadata and collection permission checks', async () => {
  const {db, adapter} = sqliteDatabase(); const repos = new MobileRepositories(adapter, () => 'mark-fixture', () => 'fixture-time');
  const policy = {isCollection: true, showMarks: true, allowLine: true, allowComment: true, showProfile: true};
  await repos.addMark({bookmarkId: 'article', userId: 'owner', type: 2, source: [{type: 'text', path: '#article>p:nth-child(2)', start: 4, end: 12}], selectContent: [{type: 'text', text: 'selected', src: ''}], rootId: 'root', parentId: 'parent', markPolicy: policy});
  const row = db.prepare('SELECT * FROM sr_bookmark_comment').get()!;
  assert.deepEqual(JSON.parse(String(row.source)), [{type: 'text', path: '#article>p:nth-child(2)', start: 4, end: 12}]);
  assert.equal(JSON.parse(String(row.metadata)).source_type, 'collection'); assert.equal(JSON.parse(String(row.metadata)).parent_id, 'parent');
  await assert.rejects(repos.deleteMark('mark-fixture', policy, 'another'), /not allowed/);
  await repos.deleteMark('mark-fixture', policy, 'owner'); assert.equal(db.prepare('SELECT is_deleted FROM sr_bookmark_comment').get()!.is_deleted, 1);
  await assert.rejects(repos.addMark({bookmarkId: 'a', userId: 'u', type: 1, markPolicy: {...policy, allowLine: false}}), /not allowed/); db.close();
});
test('image cache normalizes source schemes and retains original MD5/extension algorithm', () => {
  const md5 = (url: string) => createHash('md5').update(url).digest('hex');
  assert.equal(imageCachePath('collection-o-b', 'slaxstatics://example.com/a.PNG?q=1', md5), `bookmark/collection-o-b/images/${md5('https://example.com/a.PNG?q=1')}.png`);
  assert.notEqual(bookmarkCacheKey('b', 'owner'), bookmarkCacheKey('b'));
  assert.equal(imageCachePath('b', 'https://example.com/a', md5).endsWith('.jpg'), true);
  for (const url of ['https://example.com/x.foo/bar', 'https://example.com/x.foo\\bar', 'https://example.com/x.foo\u0001bar', 'https://example.com/x.foo\u007fbar']) {
    const path = imageCachePath('b', url, md5);
    assert.match(path, /^bookmark\/b\/images\/[a-f0-9]{32}\.jpg$/);
  }
  assert.equal(imageCachePath('b', 'https://example.com/a.longextension', md5).endsWith('.longextens'), true);
});
