import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {CacheMaintenance, cacheOtherFields, formatCacheSize} from '../../src/data/cache-maintenance.ts';
import type {SqlDatabase, SqlTransaction} from '../../src/data/repositories.ts';
import {createShakeDetector} from '../../src/debug/shake.ts';

function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY, data TEXT)');
  const transaction: SqlTransaction = {execute: async (sql, params = []) => db.prepare(sql).run(...params as (string|number|null)[]), getOptional: async <T>(sql: string, params: unknown[] = []) => db.prepare(sql).get(...params as (string|number|null)[]) as T ?? null};
  const adapter: SqlDatabase = {...transaction, getAll: async <T>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params as (string|number|null)[]) as T[], writeTransaction: async work => {db.exec('BEGIN'); try {const value = await work(transaction); db.exec('COMMIT'); return value;} catch (error) {db.exec('ROLLBACK'); throw error;}}, watch() {throw new Error('Unused');}};
  const files = new Map<string, {article: number; images: number}>();
  const service = new CacheMaintenance(adapter, {articleBytes: key => files.get(key)?.article ?? 0, imageBytes: key => files.get(key)?.images ?? 0, removeArticleContent: key => {const file = files.get(key); if (!file?.article) return false; file.article = 0; return true;}, removeImages: key => {const file = files.get(key); if (file) file.images = 0;}});
  function put(id: string, data: Record<string,unknown>, article = 100, images = 200) {db.prepare('INSERT INTO ps_data_local__local_bookmark_info VALUES (?, ?)').run(id, JSON.stringify(data)); files.set(id, {article, images});}
  const read = (id: string) => {const row = db.prepare('SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?').get(id); return row ? JSON.parse(String(row.data)) : null;};
  return {db, files, service, put, read, adapter};
}
test('manual cache categories preserve automatic/missing flags and collection owner identity', async () => {
  const {db, files, service, put, read} = fixture();
  put('manual', {is_auto_cached: 0, is_downloaded: 2, read_position: '7', future_field: {kept: true}});
  put('automatic', {is_auto_cached: 1, is_downloaded: 2}); put('legacy-missing', {is_downloaded: 2});
  put('collection-owner-bookmark', {is_auto_cached: 0, is_downloaded: 2, overview: '中文'});
  assert.deepEqual(await service.usage(), {article: 200, images: 400, other: 7});
  assert.equal(await service.clear(['article']), 200);
  assert.deepEqual(files.get('automatic'), {article: 100, images: 200}); assert.deepEqual(files.get('legacy-missing'), {article: 100, images: 200});
  assert.equal(read('manual').is_downloaded, 0); assert.equal(read('manual').is_auto_cached, 0); assert.equal(read('collection-owner-bookmark').is_downloaded, 0);
  assert.equal(read('manual').read_position, '7'); assert.deepEqual(read('manual').future_field, {kept: true});
  assert.equal(await service.clear(['images']), 400); assert(read('manual')); assert(read('collection-owner-bookmark'));
  assert.equal(await service.clear(['other']), 7); assert.deepEqual(read('manual').future_field, {kept: true}); assert.equal(read('collection-owner-bookmark'), null); db.close();
});
test('other cache removes exactly six source fields across all rows with UTF-8 byte accounting', async () => {
  const {db, service, put, read} = fixture();
  const fields = Object.fromEntries(cacheOtherFields.map(field => [field, '文']));
  put('auto', {...fields, is_auto_cached: 1, is_downloaded: 2, pinned: true, future: 'kept'});
  assert.equal((await service.usage()).other, 18); assert.equal(await service.clear(['other']), 18);
  assert.deepEqual(read('auto'), {is_auto_cached: 1, is_downloaded: 2, pinned: true, future: 'kept'}); db.close();
});
test('a file deletion failure does not reset download flags or lose pending local fields', async () => {
  const {db, adapter, put, read} = fixture(); put('manual', {is_auto_cached: 0, is_downloaded: 2, outline: 'kept'});
  const service = new CacheMaintenance(adapter, {articleBytes: () => 100, imageBytes: () => 0, removeArticleContent: () => {throw new Error('Storage denied');}, removeImages() {}});
  await assert.rejects(service.clear(['article']), /Storage denied/); assert.equal(read('manual').is_downloaded, 2); assert.equal(read('manual').outline, 'kept'); db.close();
});
test('queued or suspended cleanup cannot delete a new account after lease revocation', async () => {
  const {db, adapter, put, read, files} = fixture(); put('same-id', {is_auto_cached: 0, is_downloaded: 2, overview: 'account A'});
  let active = true, release: (() => void) | undefined;
  const wait = new Promise<void>(resolve => {release = resolve;});
  const service = new CacheMaintenance(adapter, {articleBytes: async () => {await wait; return 100;}, imageBytes: () => 200,
    removeArticleContent: () => {throw new Error('Stale cleanup must not reach files');}, removeImages: () => {throw new Error('Stale cleanup must not reach files');}}, () => {if (!active) throw new Error('Account lease revoked');});
  const first = service.clear(['article', 'other']), queued = service.clear(['images']);
  await Promise.resolve(); await Promise.resolve(); active = false;
  db.prepare('UPDATE ps_data_local__local_bookmark_info SET data = ? WHERE id = ?').run(JSON.stringify({is_auto_cached: 0, is_downloaded: 2, overview: 'account B'}), 'same-id');
  release!(); await assert.rejects(first, /revoked/); await assert.rejects(queued, /revoked/);
  assert.equal(read('same-id').overview, 'account B'); assert.equal(read('same-id').is_downloaded, 2); assert.deepEqual(files.get('same-id'), {article: 100, images: 200}); db.close();
});
test('cache formatting truncates like the source and shake detection enforces strict thresholds/cooldown', () => {
  assert.equal(formatCacheSize(0), '0 MB'); assert.equal(formatCacheSize(10), '< 0.1 MB'); assert.equal(formatCacheSize(1.29 * 1024 ** 2), '1.2 MB'); assert.equal(formatCacheSize(1024 ** 3), '1.0 GB');
  let stamp = 2000, shakes = 0; const detect = createShakeDetector(() => shakes++, () => stamp);
  detect({x: 0, y: 0, z: 2.7}); assert.equal(shakes, 0); detect({x: 0, y: 0, z: 2.71}); assert.equal(shakes, 1);
  stamp = 3000; detect({x: 3, y: 0, z: 0}); assert.equal(shakes, 1); stamp = 3001; detect({x: 3, y: 0, z: 0}); assert.equal(shakes, 2);
});
