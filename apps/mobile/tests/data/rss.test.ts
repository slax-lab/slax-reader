import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MOBILE_TABLES} from '../../src/data/schema.ts';
import {MobileRepositories} from '../../src/data/repositories.ts';
import {AccountDatabaseLease} from '../../src/data/account-lease.ts';
import type {SqlDatabase, SqlTransaction} from '../../src/data/repositories/sql.ts';
import type {RssEntry, RssSubscription} from '@slax-reader/contracts';

function fixture(t: {after(cleanup: () => void): void}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  for (const [name, table] of Object.entries(MOBILE_TABLES)) db.exec(`CREATE TABLE ${name} (id TEXT PRIMARY KEY${[...table.text, ...(table.integer ?? [])].map(field => `, ${field} ${table.integer?.includes(field) ? 'INTEGER' : 'TEXT'}`).join('')})`);
  const watches: (() => void)[] = [];
  const queries: string[] = [];
  let firstSync!: () => void, unsubscribed = 0;
  const first = new Promise<void>(resolve => {firstSync = resolve;});
  const calls: unknown[] = [];
  const execute = async (sql: string, parameters: unknown[] = []) => db.prepare(sql).run(...parameters as never[]);
  const getOptional = async <T,>(sql: string, parameters: unknown[] = []): Promise<T | null> => db.prepare(sql).get(...parameters as never[]) as T | undefined ?? null;
  const database = {
    execute,
    getOptional,
    async getAll<T>(sql: string, parameters: unknown[] = []): Promise<T[]> { return db.prepare(sql).all(...parameters as never[]) as T[]; },
    async writeTransaction<T>(work: (transaction: SqlTransaction) => Promise<T>): Promise<T> {
      db.exec('BEGIN');
      try {
        const result = await work({execute, getOptional});
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    watch(sql, parameters, handler, options) {
      queries.push(sql);
      const publish = () => {if (!options.signal.aborted) handler.onResult({rows: {_array: db.prepare(sql).all(...parameters as (string | null)[])}});};
      watches.push(publish); publish();
    },
    syncStream(name, parameters) {
      calls.push({name, parameters});
      return {subscribe: async options => {
        calls.push(options);
        return {unsubscribe: () => {unsubscribed++;}, waitForFirstSync: async signal => {
          await first;
          if (signal?.aborted) throw new Error('cancelled');
        }};
      }};
    },
  } satisfies SqlDatabase;
  const lease = new AccountDatabaseLease(database);
  const repositories = new MobileRepositories(lease, () => 'uuid');
  t.after(() => lease.invalidate());
  return {db, lease, rss: repositories.rss, calls, queries, firstSync, unsubscribed: () => unsubscribed, publish: () => watches.forEach(publish => publish())};
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('RSS queries join own subscriptions and bookmarks, normalize timestamps, and order the local window', t => {
  const f = fixture(t);
  f.db.exec(`
    INSERT INTO sr_rss_feed (id, title, feed_url, icon_url, next_fetch_at, next_allowed_at, refreshing_until) VALUES
      ('feed', 'Feed', 'https://example.invalid/rss', 'https://example.invalid/icon', '2026-10-19 00:00:00+00', '2026-10-19 00:00:00+00', '2999-01-01T00:00:00Z'),
      ('other', 'Other', 'https://other.invalid/rss', NULL, '2026-10-19T00:00:00Z', '2026-10-19T00:00:00Z', NULL);
    INSERT INTO sr_rss_subscription (id, feed_id, remark, created_at) VALUES ('b', 'feed', 'Mine', '2026-01-02'), ('a', 'other', '', '2026-01-01');
    INSERT INTO sr_rss_entry (id, feed_id, title, article_url, first_seen_at, published_at, sort_at, content_truncated) VALUES
      ('e1', 'feed', 'First', 'https://example.invalid/1', '2026-10-19 00:00:00+00', NULL, '2026-10-19', 1),
      ('e2', 'feed', 'Second', 'https://example.invalid/2', '2026-10-19T00:00:00Z', '2026-10-19T00:00:00Z', '2026-10-19', 0),
      ('old', 'other', 'Old', NULL, '2026-10-18T00:00:00Z', NULL, '2026-10-18', 0),
      ('unsubscribed', 'foreign', 'Hidden', NULL, '2026-10-20', NULL, '2026-10-20', 0);
    INSERT INTO sr_user_bookmark (id, metadata, deleted_at) VALUES
      ('saved', '{"bookmark":{"target_url":"https://example.invalid/1"}}', NULL),
      ('deleted', '{"bookmark":{"target_url":"https://example.invalid/2"}}', '2026-10-19'),
      ('saved-again', '{"bookmark":{"target_url":"https://example.invalid/1"}}', NULL);
  `);
  let subscriptions: RssSubscription[] = [], entries: RssEntry[] = [], selected: RssEntry[] = [];
  const stop = f.rss.watchSubscriptions(rows => {subscriptions = rows;});
  f.rss.watchEntries(null, rows => {entries = rows;});
  f.rss.watchEntries('b', rows => {selected = rows;});
  assert.deepEqual(subscriptions.map(row => row.id), ['a', 'b']);
  assert.equal(subscriptions[1]!.refreshing, true);
  assert.equal(subscriptions[1]!.next_allowed_at, '2026-10-19T00:00:00.000Z');
  assert.equal(subscriptions[1]!.icon_url, 'https://example.invalid/icon');
  assert.deepEqual(entries.map(row => row.id), ['e2', 'e1', 'old']);
  assert.deepEqual(selected.map(row => row.id), ['e2', 'e1']);
  assert.equal(entries[0]!.bookmark_user_uuid, null);
  assert.equal(entries[1]!.bookmark_user_uuid, 'saved');
  assert.equal(entries[1]!.source_title, 'Mine');
  assert.equal(entries[2]!.source_title, 'Other');
  assert.equal(entries[1]!.first_seen_at, '2026-10-19T00:00:00.000Z');
  assert.equal(entries[1]!.published_at, null);
  assert.equal(entries[1]!.sort_at, '2026-10-19T00:00:00.000Z');
  stop(); f.lease.invalidate(); f.db.exec('DELETE FROM sr_rss_entry'); f.publish();
  assert.equal(entries.length, 3);
});

test('RSS stream waits for its own first sync, uses a seven-day TTL, and is released by account invalidation', async t => {
  const f = fixture(t); let ready = 0;
  f.rss.connect(() => {ready++;}, error => assert.fail(error.message));
  await flush(); assert.equal(ready, 0);
  assert.deepEqual(f.calls, [{name: 'rss_v1', parameters: undefined}, {ttl: 604800}]);
  f.firstSync(); await flush(); assert.equal(ready, 1);
  f.lease.invalidate(); assert.equal(f.unsubscribed(), 1);
});

test('RSS first sync cannot publish after disposal or account replacement', async t => {
  const f = fixture(t); let ready = 0, errors = 0;
  const stop = f.rss.connect(() => {ready++;}, () => {errors++;});
  await flush(); stop(); f.lease.invalidate(); f.firstSync(); await flush();
  assert.equal(ready, 0); assert.equal(errors, 0); assert.equal(f.unsubscribed(), 1);
});

test('RSS saved lookup resolves only requested article URLs from live bookmarks', t => {
  const f = fixture(t);
  f.db.exec(`
    INSERT INTO sr_user_bookmark (id, metadata, deleted_at) VALUES
      ('saved-b', '{"bookmark":{"target_url":"https://example.invalid/1"}}', NULL),
      ('saved-a', '{"bookmark":{"target_url":"https://example.invalid/1"}}', NULL),
      ('deleted', '{"bookmark":{"target_url":"https://example.invalid/2"}}', '2026-10-19'),
      ('unrequested', '{"bookmark":{"target_url":"https://example.invalid/3"}}', NULL);
  `);
  let saved = new Map<string, string>();
  f.rss.watchSaved(['https://example.invalid/1', 'https://example.invalid/2'], rows => {saved = rows;});
  assert.deepEqual([...saved], [['https://example.invalid/1', 'saved-a']]);
  f.db.exec(`UPDATE sr_user_bookmark SET deleted_at = NULL WHERE id = 'deleted'`); f.publish();
  assert.deepEqual([...saved].sort(), [['https://example.invalid/1', 'saved-a'], ['https://example.invalid/2', 'deleted']]);
});

test('RSS cache presence uses a real SQLite existence query', async t => {
  const f = fixture(t);
  assert.equal(await f.rss.hasCachedData(), false);
  f.db.exec(`INSERT INTO sr_rss_subscription (id, feed_id) VALUES ('sub', 'feed')`);
  assert.equal(await f.rss.hasCachedData(), true);
});

test('RSS saved URL join plan indexes the materialized saved rows and matches the previous query', t => {
  const f = fixture(t);
  f.db.exec(`
    INSERT INTO sr_rss_feed (id, title, feed_url, next_fetch_at, next_allowed_at) VALUES ('feed', 'Feed', 'https://example.invalid/feed', '2026-10-19', '2026-10-19');
    INSERT INTO sr_rss_subscription (id, feed_id) VALUES ('sub', 'feed');
  `);
  const insertEntry = f.db.prepare(`INSERT INTO sr_rss_entry (id, feed_id, title, article_url, first_seen_at, sort_at) VALUES (?, 'feed', ?, ?, '2026-10-19', '2026-10-19')`);
  const insertBookmark = f.db.prepare(`INSERT INTO sr_user_bookmark (id, metadata, deleted_at) VALUES (?, ?, NULL)`);
  f.rss.watchEntries(null, () => {});
  const currentSql = f.queries.at(-1)!;
  assert.match(currentSql, /CAST\(json_extract\(metadata, '\$\.bookmark\.target_url'\) AS TEXT\) AS url/);
  const previousSql = currentSql.replace("CAST(json_extract(metadata, '$.bookmark.target_url') AS TEXT)", "json_extract(metadata, '$.bookmark.target_url')");
  const scales = [[1000, 1250], [2000, 2500], [4000, 5000]] as const;
  const timings: {entries: number; bookmarks: number; previousMs: number; currentMs: number}[] = [];
  let planEvidence: {sqliteVersion: string; previous: string[]; current: string[]} | undefined;
  let entryCount = 0, bookmarkCount = 0;
  for (const [entries, bookmarks] of scales) {
    while (entryCount < entries) {
      const url = `https://example.invalid/${entryCount}`;
      insertEntry.run(`entry-${entryCount}`, `Entry ${entryCount}`, url);
      if (entryCount >= bookmarkCount) {
        insertBookmark.run(`bookmark-${entryCount}`, JSON.stringify({bookmark: {target_url: url}}));
        bookmarkCount++;
      }
      entryCount++;
    }
    while (bookmarkCount < bookmarks) {
      insertBookmark.run(`bookmark-${bookmarkCount}`, JSON.stringify({bookmark: {target_url: `https://example.invalid/${bookmarkCount}`}}));
      bookmarkCount++;
    }
    const currentPlan = f.db.prepare(`EXPLAIN QUERY PLAN ${currentSql}`).all(null, null).map(row => String(row.detail));
    const previousPlan = f.db.prepare(`EXPLAIN QUERY PLAN ${previousSql}`).all(null, null).map(row => String(row.detail));
    assert.ok(currentPlan.some(detail => /SEARCH saved USING AUTOMATIC COVERING INDEX \(url=\?\)/.test(detail)), currentPlan.join('\n'));
    assert.ok(previousPlan.some(detail => /SCAN saved/.test(detail)), previousPlan.join('\n'));
    planEvidence ??= {sqliteVersion: String(f.db.prepare('SELECT sqlite_version() AS version').get()?.version), previous: previousPlan, current: currentPlan};
    const before = process.hrtime.bigint();
    const oldRows = f.db.prepare(previousSql).all(null, null);
    const previousMs = Number(process.hrtime.bigint() - before) / 1e6;
    const after = process.hrtime.bigint();
    const newRows = f.db.prepare(currentSql).all(null, null);
    const currentMs = Number(process.hrtime.bigint() - after) / 1e6;
    assert.deepEqual(newRows, oldRows);
    assert.equal(newRows.length, entries);
    timings.push({entries, bookmarks, previousMs: Number(previousMs.toFixed(2)), currentMs: Number(currentMs.toFixed(2))});
  }
  console.log(`RSS SQLite query benchmark ${JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, ...planEvidence, timings})}`);
});
