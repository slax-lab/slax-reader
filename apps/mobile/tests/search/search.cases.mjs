import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SearchController} from '../../src/search/controller.ts';
import {resolveTypedTags} from '../../src/search/query.ts';
import {SearchRepository} from '../../src/data/repositories/search.ts';
import {groupSearchResults} from '../../src/search/group.ts';

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
    CREATE TABLE sr_rss_subscription (id TEXT, feed_id TEXT, remark TEXT);
    CREATE TABLE sr_rss_feed (id TEXT, title TEXT);
  `);
  const metadata = (title, description, tags) => JSON.stringify({bookmark: {title, target_url: `https://example.test/${title}`, description, uuid: `${title}-uuid`}, tags});
  db.prepare('INSERT INTO sr_user_bookmark VALUES (?, ?, ?, NULL, ?)').run('deep-row', '', metadata('Deep match', 'long body stays unread', ['tag-a', 'tag-b']), '2026-01-01');
  db.prepare('INSERT INTO sr_user_bookmark VALUES (?, ?, ?, NULL, ?)').run('one-tag', '', metadata('Deep match', 'only one tag', ['tag-a']), '2026-01-02');
  db.prepare('INSERT INTO sr_user_collection VALUES (?, ?, ?, ?)').run('owner-1', 'col-1', 'Deep Collection', 1);
  db.prepare('INSERT INTO sr_user_collection_subscriber VALUES (?, ?)').run('col-1', '2099-01-01');
  db.prepare('INSERT INTO sr_sharer_setting VALUES (?, ?)').run('owner-1', 1);
  db.prepare('INSERT INTO sr_collection_bookmark VALUES (?, ?, ?, NULL, ?)').run('col-row', 'owner-1', metadata('Deep collection', 'collection body', []), '2026-01-03');
  db.prepare('INSERT INTO sr_rss_feed VALUES (?, ?)').run('feed-1', 'Feed title');
  db.prepare('INSERT INTO sr_rss_subscription VALUES (?, ?, ?)').run('sub-1', 'feed-1', 'My feed');
  db.prepare('INSERT INTO sr_rss_entry VALUES (?, ?, ?, ?, ?, ?)').run('rss-row', 'Deep RSS', 'rss body', 'https://example.test/rss', '2026-01-04', 'feed-1');
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
  repository.watch({text: 'deep', tagUuids: []}, 50, value => {page = value;}, error => {throw error;});
  const collection = page.items.find(row => row.id === 'col-row'), rss = page.items.find(row => row.id === 'rss-row');
  assert.equal(collection?.kind, 'collection');
  assert.equal(collection?.collectionId, 'col-1');
  assert.equal(rss?.kind, 'rss');
  assert.equal(rss?.subscriptionId, 'sub-1', 'RSS hits carry their subscription id for grouping');
  repository.watch({text: 'deep', tagUuids: [], source: {kind: 'collection', id: 'col-1', ownerId: 'owner-1'}}, 50, value => {page = value;}, error => {throw error;});
  assert.deepEqual(page.items.map(row => row.id), ['col-row'], 'A Collection scope searches only that collection');
  repository.watch({text: 'deep', tagUuids: [], source: {kind: 'rss', id: 'sub-1'}}, 50, value => {page = value;}, error => {throw error;});
  assert.deepEqual(page.items.map(row => row.id), ['rss-row'], 'An RSS scope searches only that subscription');
  repository.watch({text: '', tagUuids: [], source: {kind: 'rss', id: 'sub-1'}}, 50, value => {page = value;}, error => {throw error;});
  assert.deepEqual(page.items.map(row => row.id), ['rss-row'], 'A source scope can list its local content without a keyword');
  db.close();
});

test('search groups attach collection and RSS hits to their own sources', () => {
  const collections = [
    {id: 'col-a', name: 'Collection A', avatar: 'a.png'},
    {id: 'col-b', name: 'Collection B', avatar: 'b.png'},
  ];
  const feeds = [{id: 'sub-a', title: 'Feed A', remark: 'My feed'}];
  const items = [
    {key: 'collection:owner:1', kind: 'collection', id: '1', title: 'A hit', description: '', url: '', source: 'Collection A', time: '', collectionId: 'col-a', ownerId: 'owner'},
    {key: 'collection:owner:2', kind: 'collection', id: '2', title: 'B hit', description: '', url: '', source: 'Collection B', time: '', collectionId: 'col-b', ownerId: 'owner'},
    {key: 'rss:3', kind: 'rss', id: '3', title: 'Feed hit', description: '', url: '', source: 'My feed', time: '', subscriptionId: 'sub-a'},
    {key: 'own:4', kind: 'own', id: '4', title: 'Own hit', description: '', url: '', source: '', time: ''},
  ];
  const grouped = groupSearchResults(collections, feeds, [collections[0]], [], items);
  assert.deepEqual(grouped.collections.map(group => [group.title, group.items.map(item => item.key)]), [
    ['Collection A', ['collection:owner:1']],
    ['Collection B', ['collection:owner:2']],
  ]);
  assert.deepEqual(grouped.feeds.map(group => [group.title, group.items.map(item => item.key)]), [['My feed', ['rss:3']]]);
  assert.deepEqual(grouped.own.map(item => item.key), ['own:4']);
  const unknown = groupSearchResults([], [], [], [], [{...items[2], subscriptionId: 'missing'}]);
  assert.equal(unknown.feeds[0].title, 'My feed');
  assert.deepEqual(unknown.feeds[0].items.map(item => item.key), ['rss:3']);
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
  controller.setQuery({text: 'needle', tagUuids: ['tag-a']}, true);
  assert.equal(controller.getSnapshot().items[0]?.title, 'Local title', 'committing the same query retains its rows');
  const pending = controller.submit();
  assert.equal(controller.getSnapshot().items[0]?.title, 'Local title', 'rows stay visible while cloud search is pending');
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
  controller.setQuery({text: 'needle', tagUuids: [], source: {kind: 'rss', id: 'sub-1'}}, true);
  const beforeScoped = searchCalls;
  await controller.submit();
  assert.equal(searchCalls, beforeScoped, 'Collection and RSS scopes never trigger cloud search');
  controller.dispose();
});

test('cloud-only matches carry URL and save time directly from the search response', async () => {
  let lookups = 0;
  const controller = new SearchController({
    watch(_query, _limit, next) {next({items: [], hasMore: false}); return () => {};},
    async admitRemote() {return new Map();},
  }, {
    async searchBookmarks() {return [{bookmark_id: 1, bookmark_user_uuid: 'saved', highlight_title: 'Title', highlight_content: 'Body', target_url: 'https://example.com/article', created_at: '2026-10-21T08:00:00.000Z'}];},
    async getSearchBookmark() {lookups++; return {};},
  }, () => true, () => true);
  controller.setQuery({text: 'body', tagUuids: []}, true);
  await controller.submit();
  assert.equal(controller.getSnapshot().items[0].url, 'https://example.com/article');
  assert.equal(controller.getSnapshot().items[0].time, '2026-10-21T08:00:00.000Z');
  assert.equal(lookups, 0, 'modern results need no per-article detail lookup');
  controller.dispose();
});

test('local result metadata remains authoritative while missing fields can be filled by search', async () => {
  for (const localUrl of ['', 'https://local.example/article']) {
    const controller = new SearchController({
      watch(_query, _limit, next) {next({items: [{key: 'own:saved', kind: 'own', id: 'saved', title: 'Local title', description: '', url: localUrl, source: '', time: localUrl ? '2026-10-01T00:00:00Z' : ''}], hasMore: false}); return () => {};},
      async admitRemote() {return new Map();},
    }, {
      async searchBookmarks() {return [{bookmark_id: 1, bookmark_user_uuid: 'saved', highlight_title: 'Cloud title', highlight_content: 'Body', target_url: 'https://cloud.example/article', created_at: '2026-10-21T08:00:00Z'}];},
      async getSearchBookmark() {return {};},
    }, () => true, () => true);
    controller.setQuery({text: 'body', tagUuids: []}, true);
    await controller.submit();
    const [item] = controller.getSnapshot().items;
    assert.equal(item.title, 'Local title');
    assert.equal(item.url, localUrl || 'https://cloud.example/article');
    assert.equal(item.time, localUrl ? '2026-10-01T00:00:00Z' : '2026-10-21T08:00:00Z');
    controller.dispose();
  }
});
