import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SearchController} from '../../src/search/controller.ts';
import {resolveTypedTags} from '../../src/search/query.ts';
import {SearchRepository} from '../../src/data/repositories/search.ts';

test('typed tags resolve only a unique local tag and preserve ambiguous tokens', () => {
  const tags = [{id: 't1', tag_name: 'Work'}, {id: 't2', tag_name: 'work'}];
  const result = resolveTypedTags('read #missing #WORK', ['t3'], tags);
  assert.deepEqual(result, {query: {text: 'read #missing #WORK', tagUuids: ['t3']}, unresolved: true});
  const unique = resolveTypedTags('read #books', [], [{id: 'books-id', tag_name: 'Books'}]);
  assert.deepEqual(unique, {query: {text: 'read', tagUuids: ['books-id']}, unresolved: false});
});

test('SQLite local search returns metadata matches outside the Library list and requires every owned tag', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sr_user_bookmark (id TEXT, alias_title TEXT, metadata TEXT, deleted_at TEXT, created_at TEXT);
    CREATE TABLE sr_collection_bookmark (id TEXT, owner_id TEXT, metadata TEXT, starred_at TEXT, created_at TEXT);
    CREATE TABLE sr_user_collection (owner_id TEXT, id TEXT, display_name TEXT, status INTEGER);
    CREATE TABLE sr_user_collection_subscriber (collection_id TEXT, subscription_end_time TEXT);
    CREATE TABLE sr_sharer_setting (id TEXT, allow_access INTEGER);
    CREATE TABLE sr_rss_entry (id TEXT, title TEXT, summary TEXT, article_url TEXT, sort_at TEXT, feed_id TEXT);
    CREATE TABLE sr_rss_subscription (feed_id TEXT, remark TEXT);
    CREATE TABLE sr_rss_feed (id TEXT, title TEXT);
  `);
  const metadata = (title, description, tags) => JSON.stringify({bookmark: {title, target_url: `https://example.test/${title}`, description, uuid: `${title}-uuid`}, tags});
  db.prepare('INSERT INTO sr_user_bookmark VALUES (?, ?, ?, NULL, ?)').run('deep-row', '', metadata('Deep match', 'long body stays unread', ['tag-a', 'tag-b']), '2026-01-01');
  db.prepare('INSERT INTO sr_user_bookmark VALUES (?, ?, ?, NULL, ?)').run('one-tag', '', metadata('Deep match', 'only one tag', ['tag-a']), '2026-01-02');
  const database = {
    accountSignal: undefined,
    watch(sql, parameters, handler, {signal}) {
      if (!signal.aborted) handler.onResult({rows: {_array: db.prepare(sql).all(...parameters)}});
    },
    async getAll(sql, parameters = []) {return db.prepare(sql).all(...parameters);},
  };
  const repository = new SearchRepository(database);
  let page;
  repository.watch({text: 'deep match', tagUuids: ['tag-a', 'tag-b']}, 50, value => {page = value;}, error => {throw error;});
  assert.equal(page.hasMore, false);
  assert.deepEqual(page.items.map(row => row.id), ['deep-row']);
  assert.equal(page.items[0].title, 'Deep match');
  assert.equal(page.items[0].description, 'long body stays unread');
  db.close();
});

test('remote search is explicitly submitted, merges by bookmark UUID, and honors current local tag admission', async () => {
  let publish;
  let admission = new Map();
  let searchCalls = 0;
  let resolveSearch;
  const local = {
    watch(_query, _limit, next) {publish = next; return () => {};},
    async admitRemote(ids) {return new Map(ids.map(id => [id, admission.get(id) ?? true]));},
  };
  const api = {searchBookmarks: () => {searchCalls++; return new Promise(resolve => {resolveSearch = resolve;});}, getSearchBookmark: async () => ({})};
  const controller = new SearchController(local, api, () => true, () => true);
  controller.setQuery({text: 'needle', tagUuids: ['tag-a']}, true);
  publish({items: [{key: 'own:bookmark-1', kind: 'own', id: 'bookmark-1', title: 'Local title', description: '', url: '', source: '', time: ''}], hasMore: false});
  assert.equal(searchCalls, 0, 'typing must not send cloud search');
  const pending = controller.submit();
  assert.equal(searchCalls, 1);
  resolveSearch([{bookmark_user_uuid: 'bookmark-1', bookmark_id: 1, highlight_title: 'Cloud title', highlight_content: '<b>found</b>'}]);
  await pending;
  assert.equal(controller.getSnapshot().items.length, 1);
  assert.equal(controller.getSnapshot().items[0].title, 'Local title');
  assert.equal(controller.getSnapshot().items[0].snippet, 'found');

  admission = new Map([['bookmark-2', false]]);
  controller.setQuery({text: 'needle', tagUuids: ['tag-a']}, true);
  publish({items: [], hasMore: false});
  const second = controller.submit();
  resolveSearch([{bookmark_user_uuid: 'bookmark-2', bookmark_id: 2, highlight_title: 'Stale tag', highlight_content: 'hidden'}]);
  await second;
  assert.equal(controller.getSnapshot().items.some(row => row.id === 'bookmark-2'), false, 'cloud hits removed from a local tag must be discarded');
  controller.dispose();
});
