import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath, URL} from 'node:url';
import {dirname, resolve} from 'node:path';
import ts from 'typescript';
import * as facade from '../../src/data/repositories.ts';
import {BookmarkRepository} from '../../src/data/repositories/bookmarks.ts';
import {CollectionRepository} from '../../src/data/repositories/collections.ts';
import {AccountRepository} from '../../src/data/repositories/account.ts';
import {MarkRepository} from '../../src/data/repositories/marks.ts';
import {LocalBookmarkRepository} from '../../src/data/repositories/local-metadata.ts';
import {RowWatcher} from '../../src/data/repositories/watch-rows.ts';
import {bookmark, collection, bookmarkCacheKey, bookmarkDisplayTitle} from '../../src/data/repositories/records.ts';
import {collectionMarkPolicy, PERSONAL_MARK_POLICY, PENDING_COLLECTION_MARK_POLICY} from '../../src/data/repositories/mark-policy.ts';
import type {SqlDatabase, SqlTransaction} from '../../src/data/repositories/sql.ts';
import {MOBILE_TABLES} from '../../src/data/schema.ts';

function fixture(context: {after: (cleanup: () => void) => void}) {
  const sqlite = new DatabaseSync(':memory:');
  context.after(() => sqlite.close());
  for (const [name, table] of Object.entries(MOBILE_TABLES)) {
    if (table.options?.localOnly) continue;
    sqlite.exec(`CREATE TABLE ${name} (id TEXT PRIMARY KEY, ${[
      ...table.text.map(field => `${field} TEXT`),
      ...(table.integer ?? []).map(field => `${field} INTEGER`),
    ].join(', ')})`);
  }
  sqlite.exec('CREATE TABLE ps_data_local__local_bookmark_info (id TEXT PRIMARY KEY, data TEXT)');
  type Value = string | number | null;
  let transactions = 0;
  const tx: SqlTransaction = {
    async execute(sql, values = []) {return sqlite.prepare(sql).run(...values as Value[]);},
    async getOptional<T>(sql: string, values: unknown[] = []) {
      return (sqlite.prepare(sql).get(...values as Value[]) ?? null) as T | null;
    },
  };
  const database: SqlDatabase = {
    ...tx,
    async getAll<T>(sql: string, values: unknown[] = []) {
      return sqlite.prepare(sql).all(...values as Value[]) as T[];
    },
    async writeTransaction(work) {
      transactions++;
      sqlite.exec('BEGIN');
      try {
        const result = await work(tx);
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    watch(sql, values, handler) {
      handler.onResult({rows: {_array: sqlite.prepare(sql).all(...values as Value[])}});
    },
  };
  let nextId = 0;
  const uuid = () => `generated-${++nextId}`;
  const now = () => '2026-10-13T00:00:00Z';
  const rows = new RowWatcher(database);
  return {
    sqlite, database, uuid, now, rows,
    transactions: () => transactions,
    bookmarks: new BookmarkRepository(database, rows, uuid, now),
    marks: new MarkRepository(database, uuid, now),
  };
}

test('the compatibility facade re-exports the actual helpers, policies and local repository', t => {
  assert.equal(facade.LocalBookmarkRepository, LocalBookmarkRepository);
  assert.equal(facade.bookmarkCacheKey, bookmarkCacheKey);
  assert.equal(facade.bookmarkDisplayTitle, bookmarkDisplayTitle);
  assert.equal(facade.collectionMarkPolicy, collectionMarkPolicy);
  assert.equal(facade.PERSONAL_MARK_POLICY, PERSONAL_MARK_POLICY);
  assert.equal(facade.PENDING_COLLECTION_MARK_POLICY, PENDING_COLLECTION_MARK_POLICY);
  const f = fixture(t);
  const repositories = new facade.MobileRepositories(f.database, f.uuid, f.now);
  assert.equal(repositories.database, f.database);
  assert.ok(repositories.local instanceof LocalBookmarkRepository);
  assert.equal(Object.getPrototypeOf(facade.MobileRepositories.prototype), Object.prototype);
});

test('extracted bookmark/tag writes retain pending metadata, injected values and transaction boundaries', async t => {
  const f = fixture(t);
  const url = 'https://example.test/article';
  const id = await f.bookmarks.createBookmark(url);
  assert.equal(id, 'generated-1');
  const saved = await f.bookmarks.getBookmark(id);
  assert.equal(saved?.status, 'pending');
  assert.equal(saved?.createdAt, f.now());
  assert.equal(saved?.contentType, 'article');
  assert.deepEqual(JSON.parse(saved!.metadata!), {
    tags: [],
    bookmark: {
      uuid: id, title: url, byline: '', status: 'pending', host_url: url,
      site_name: '', target_url: url, description: '', content_icon: '',
      published_at: f.now(), content_cover: '', content_word_count: 0,
    },
  });
  const count = f.transactions();
  await f.bookmarks.updateBookmark(id, {aliasTitle: undefined});
  assert.equal(f.transactions(), count);
  await f.bookmarks.updateBookmark(id, {aliasTitle: 'Edited', isStarred: 1, archiveStatus: 1, isRead: 1});
  const tag = await f.bookmarks.createTag('Tag');
  assert.deepEqual(tag, {id: 'generated-2', tag_name: 'Tag', display: '1', source: 'mine', created_at: f.now()});
  await f.bookmarks.updateTags(id, [tag.id]);
  const updated = (await f.bookmarks.getBookmark(id))!;
  assert.equal(updated.aliasTitle, 'Edited');
  assert.equal(updated.isRead, 1);
  assert.deepEqual(JSON.parse(updated.metadata!).tags, [tag.id]);
  assert.equal(JSON.parse(updated.metadata!).bookmark.status, 'pending');
  await f.bookmarks.deleteBookmark(id);
  assert.equal(f.sqlite.prepare('SELECT deleted_at FROM sr_user_bookmark WHERE id = ?').get(id)?.deleted_at, f.now());
  assert.equal(f.transactions(), count + 4);
});

test('collection and account read markers remain scoped to their original identifiers', async t => {
  const f = fixture(t);
  f.sqlite.exec("INSERT INTO sr_user_collection_subscriber (id, collection_id) VALUES ('a', 'selected'), ('b', 'other'); INSERT INTO sr_user_notification (id, is_read) VALUES ('one', 0), ('two', 0)");
  const collections = new CollectionRepository(f.database, f.rows, f.now);
  const account = new AccountRepository(f.database, f.rows);
  await collections.markCollectionRead('selected');
  await account.markNotificationRead('one');
  assert.deepEqual(f.sqlite.prepare('SELECT last_read_at FROM sr_user_collection_subscriber ORDER BY id').all().map(row => row.last_read_at), [f.now(), null]);
  assert.deepEqual(f.sqlite.prepare('SELECT is_read FROM sr_user_notification ORDER BY id').all().map(row => row.is_read), [1, 0]);
  assert.equal(f.transactions(), 2);
});

test('extracted mark CRUD keeps collection type permissions and malformed ownership fail-closed', async t => {
  const f = fixture(t);
  for (const type of [1, 2, 3, 4]) {
    await assert.rejects(f.marks.addMark({bookmarkId: 'bookmark', userId: 'viewer', type, markPolicy: PENDING_COLLECTION_MARK_POLICY}), /not allowed/);
  }
  assert.equal(f.transactions(), 0);
  const policy = {...PENDING_COLLECTION_MARK_POLICY, allowLine: true};
  const id = await f.marks.addMark({bookmarkId: 'bookmark', userId: 'viewer', type: 1, markPolicy: policy});
  assert.equal(id, 'generated-1');
  assert.equal(f.sqlite.prepare('SELECT created_at FROM sr_bookmark_comment WHERE id = ?').get(id)?.created_at, f.now());
  await assert.rejects(f.marks.addMark({bookmarkId: 'bookmark', userId: 'viewer', type: 2, markPolicy: policy}), /not allowed/);
  await f.database.execute('UPDATE sr_bookmark_comment SET metadata = ? WHERE id = ?', ['{invalid', id]);
  await assert.rejects(f.marks.deleteMark(id, policy, 'viewer'), /not allowed/);
  await assert.rejects(f.marks.deleteMark(id, PERSONAL_MARK_POLICY, ''), /not allowed/);
  assert.equal(f.sqlite.prepare('SELECT is_deleted FROM sr_bookmark_comment WHERE id = ?').get(id)?.is_deleted, 0);
  await f.marks.deleteMark('missing', policy, 'viewer');
  await f.marks.deleteMark(id, PERSONAL_MARK_POLICY, 'viewer');
  assert.equal(f.sqlite.prepare('SELECT is_deleted FROM sr_bookmark_comment WHERE id = ?').get(id)?.is_deleted, 1);
});

test('local metadata preserves boolean manual pins, unknown keys and malformed JSON on rollback', async t => {
  const f = fixture(t);
  const local = new LocalBookmarkRepository(f.database);
  const key = bookmarkCacheKey('bookmark', 'owner');
  await local.update(key, {is_auto_cached: false, is_downloaded: 2, future: {retained: true}});
  await local.setAutoDownloadStatus(key, 0);
  assert.deepEqual(await local.read(key), {is_auto_cached: false, is_downloaded: 2, future: {retained: true}});
  await local.setAutoDownloadStatus(key, 2);
  assert.deepEqual(await local.read(key), {is_auto_cached: 0, is_downloaded: 2, future: {retained: true}});
  await f.database.execute('UPDATE ps_data_local__local_bookmark_info SET data = ? WHERE id = ?', ['{invalid', key]);
  await assert.rejects(local.update(key, {read_position: '2'}), SyntaxError);
  assert.equal(f.sqlite.prepare('SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?').get(key)?.data, '{invalid');
});

test('readonly record and permission mapping retains source conversion without mutating inputs', () => {
  const row = Object.freeze({id: 'bookmark', content_type: '2', is_auto_cached: 0});
  const record = bookmark(row);
  assert.equal(record.contentType, 'pdf');
  assert.equal(record.isAutoCached, false);
  assert.equal(bookmarkDisplayTitle({...record, title: '  A\n  title  '}), 'A title');
  const settings = Object.freeze({allow_highlight: true, show_highlight: true, allow_access: true});
  const share = Object.freeze({is_enable: false, allow_line: true});
  assert.deepEqual(collectionMarkPolicy(share, settings), PENDING_COLLECTION_MARK_POLICY);
  assert.equal(collection(Object.freeze({latest_article_at: '2026-10-13 00:00:01', last_read_at: '2026-10-13T00:00:00Z'})).hasNew, true);
});

test('repository dependencies stay acyclic and children never import the compatibility facade', () => {
  const root = fileURLToPath(new URL('../../src/data/repositories/', import.meta.url));
  const facadePath = resolve(root, '../repositories.ts');
  const files = readdirSync(root).filter(file => file.endsWith('.ts')).map(file => resolve(root, file));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const dependencies: string[] = [];
    for (const node of source.statements) {
      if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const path = node.moduleSpecifier.text;
      if (!path.startsWith('.')) continue;
      const dependency = resolve(dirname(file), path);
      assert.notEqual(dependency, facadePath, file);
      if (files.includes(dependency)) dependencies.push(dependency);
    }
    graph.set(file, dependencies);
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (file: string) => {
    assert.equal(visiting.has(file), false, `Repository import cycle: ${file}`);
    if (visited.has(file)) return;
    visiting.add(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
    visiting.delete(file);
    visited.add(file);
  };
  for (const file of files) visit(file);
});
