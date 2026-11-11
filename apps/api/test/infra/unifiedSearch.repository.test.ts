/**
 * Repository-level coverage for unified search.
 *
 * PostgreSQL runs on in-memory PGlite with every committed Prisma migration
 * applied, so the repository SQL executes against the real tables, constraints
 * and triggers. Each test is rolled back.
 *
 * D1 runs on an ephemeral Miniflare database with the committed fulltext
 * migrations, so `BookmarkSearchRepo.searchCandidatePage` executes real SQLite
 * FTS5 MATCH, bm25() and snippet().
 */
import { PGlite } from '@electric-sql/pglite'
import { createRequire } from 'node:module'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PrismaClient } from '@prisma/hyperdrive-client'
import { HybridSearchRepo } from '@/infra/repository/dbHybridSearch'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { BookmarkSearchRepo } from '@/infra/repository/dbBookmarkSearch'

const req = createRequire(import.meta.url)
const { Miniflare } = createRequire(req.resolve('wrangler/package.json'))('miniflare')

const apiRoot = fileURLToPath(new URL('../../', import.meta.url))
const pgMigrationsRoot = path.join(apiRoot, 'prisma/pg_migrations')
const d1FulltextMigrationsRoot = path.join(apiRoot, 'prisma/d1_migrations/fulltext')

let pg: PGlite
let d1: D1Database
let runtime: InstanceType<typeof Miniflare>
let repo: HybridSearchRepo
let pgQuery: ReturnType<typeof vi.fn>

function flattenSql(text: string) {
  return text.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim()
}

async function applyPostgresMigrations(db: PGlite) {
  const dirs = (await readdir(pgMigrationsRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort()
  for (const dir of dirs) {
    await db.exec(await readFile(path.join(pgMigrationsRoot, dir, 'migration.sql'), 'utf8'))
  }
}

async function applyFulltextMigrations(db: D1Database) {
  const files = (await readdir(d1FulltextMigrationsRoot)).filter(name => name.endsWith('.sql')).sort()
  for (const file of files) {
    await db.exec(flattenSql(await readFile(path.join(d1FulltextMigrationsRoot, file), 'utf8')))
  }
}

beforeAll(async () => {
  pg = new PGlite()
  await applyPostgresMigrations(pg)

  runtime = new Miniflare({
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: 'unified-search-fixture',
          type: 'worker',
          compatibilityDate: '2026-08-01',
          manifest: {
            mainModule: 'fixture.mjs',
            modulesRoot: apiRoot,
            modules: { 'fixture.mjs': { type: 'esm', contents: 'export default { fetch(){ return new Response("ok") } }' } }
          },
          env: { DB_FULLTEXT: { type: 'd1', id: 'unified-search-fixture' } }
        }
      }
    ]
  })
  d1 = (await runtime.getD1Database('DB_FULLTEXT')) as unknown as D1Database
  await applyFulltextMigrations(d1)
}, 60_000)

beforeEach(async () => {
  await pg.exec('BEGIN')
  await pg.exec(SEED)
  pgQuery = vi.fn(async (sqlArg: unknown, ...values: unknown[]) => {
    const sql = sqlArg as { text?: string; values?: unknown[] }
    const text = typeof sql?.text === 'string' ? sql.text : ''
    const params = Array.isArray(sql?.values) ? sql.values : values
    return (await pg.query(text, params)).rows
  })
  const throwing = () => {
    throw new Error('unified search fixture must not use the D1 or app Prisma clients')
  }
  repo = new HybridSearchRepo(() => ({ $queryRaw: pgQuery }) as unknown as PrismaClient, new BookmarkRepo(throwing, throwing))
})

afterEach(async () => {
  await pg.exec('ROLLBACK')
})

afterAll(async () => {
  await runtime?.dispose()
  await pg?.close()
})

const SEED = `
INSERT INTO sr_user (id, email, last_login_at, created_at, snapshot_sharing, deleted_at) VALUES
  (1, 'a@example.test', now(), now(), true,  NULL),
  (2, 'b@example.test', now(), now(), true,  NULL),
  (3, 'c@example.test', now(), now(), true,  now()),
  (4, 'd@example.test', now(), now(), true,  NULL),
  (5, 'e@example.test', now(), now(), true,  NULL),
  (6, 'f@example.test', now(), now(), true,  NULL),
  (7, 'g@example.test', now(), now(), true,  NULL),
  (8, 'h@example.test', now(), now(), true,  NULL),
  (9, 'i@example.test', now(), now(), true,  NULL),
  (10, 'j@example.test', now(), now(), false, NULL),
  (11, 'k@example.test', now(), now(), false, NULL),
  (12, 'l@example.test', now(), now(), true,  NULL),
  (13, 'm@example.test', now(), now(), true,  NULL),
  (14, 'n@example.test', now(), now(), true,  NULL),
  (15, 'o15@example.test', now(), now(), true, NULL),
  (16, 'p16@example.test', now(), now(), true, NULL),
  (17, 'q17@example.test', now(), now(), true, NULL),
  (18, 'r18@example.test', now(), now(), true, NULL),
  (19, 's19@example.test', now(), now(), true, NULL),
  (20, 't20@example.test', now(), now(), true, NULL);

INSERT INTO sr_bookmark (id, title, target_url, private_user, status, moderation_result, created_at, updated_at, published_at) VALUES
  (10, 'Alpha Own Article',        'https://example.test/own-10',      1, 'success', 0, now(), now(), now()),
  (11, 'Unrelated Title',          'https://example.test/own-11',      1, 'success', 0, now(), now(), now()),
  (12, 'Alpha Deleted Save',       'https://example.test/own-12',      1, 'success', 0, now(), now(), now()),
  (13, 'Alpha Shortcut',           'https://example.test/own-13',      1, 'success', 0, now(), now(), now()),
  (14, 'Alpha Pending',            'https://example.test/own-14',      1, 'pending', 0, now(), now(), now()),
  (15, 'Alpha Snapshot One',       'https://example.test/shared',      1, 'success', 0, now(), now(), now()),
  (16, 'Alpha Snapshot Two',       'https://example.test/shared',      2, 'success', 0, now(), now(), now()),
  (30, 'Alpha Follow Member',      'https://example.test/follow',      2, 'success', 0, now(), now(), now()),
  (31, 'Alpha Private Member',     'https://example.test/private',    10, 'success', 0, now(), now(), now()),
  (32, 'Alpha Shared Member',      'https://example.test/shared-m',   11, 'success', 0, now(), now(), now()),
  (33, 'Alpha Moderated Member',   'https://example.test/moderated',  12, 'success', 1, now(), now(), now()),
  (34, 'Alpha Unstarred Member',   'https://example.test/unstarred',  13, 'success', 0, now(), now(), now()),
  (35, 'Alpha Deleted Owner Member','https://example.test/deleted-owner', 3, 'success', 0, now(), now(), now()),
  (36, 'Alpha Expired Member',     'https://example.test/expired',    17, 'success', 0, now(), now(), now()),
  (37, 'Alpha Deleted Sub Member', 'https://example.test/deleted-sub', 16, 'success', 0, now(), now(), now()),
  (38, 'Alpha Inactive Sub Member','https://example.test/inactive-sub',9, 'success', 0, now(), now(), now()),
  (39, 'Alpha Closed Member',      'https://example.test/closed',      5, 'success', 0, now(), now(), now()),
  (40, 'Alpha No Code Member',     'https://example.test/nocode',      6, 'success', 0, now(), now(), now()),
  (41, 'Unrelated Follow Member',  'https://example.test/follow-other',2, 'success', 0, now(), now(), now()),
  (42, 'Alpha Share Disabled Member','https://example.test/share-disabled',14, 'success', 0, now(), now(), now()),
  (70, 'Alpha Shared Eight',       'https://example.test/shared-eight', 8, 'success', 0, now(), now(), now()),
  (71, 'Alpha Stale Own Origin',   'https://example.test/stale-own',    8, 'success', 0, now(), now(), now()),
  (80, 'Stable Body Title',        'https://example.test/revocable-alias', 1, 'success', 0, now(), now(), now()),
  (90, 'Pending Status Member',    'https://example.test/pending-member', 18, 'pending', 0, now(), now(), now()),
  (91, 'Private Mismatch Member',  'https://example.test/private-mismatch', 20, 'success', 0, now(), now(), now()),
  (92, 'Own Eligible Member',      'https://example.test/own-eligible',  7, 'success', 0, now(), now(), now()),
  (93, 'Deleted Member Title',     'https://example.test/deleted-member', 20, 'success', 0, now(), now(), now()),
  (50, '100% Alpha',               'https://example.test/pct',         1, 'success', 0, now(), now(), now()),
  (51, '100X Alpha',               'https://example.test/pct-x',       1, 'success', 0, now(), now(), now()),
  (52, 'snake_case Alpha',         'https://example.test/snake',       1, 'success', 0, now(), now(), now()),
  (53, 'back\\slash Alpha',        'https://example.test/back',        1, 'success', 0, now(), now(), now()),
  (54, 'bang!Alpha',               'https://example.test/bang',        1, 'success', 0, now(), now(), now()),
  (55, 'quote''Alpha',             'https://example.test/quote',       1, 'success', 0, now(), now(), now()),
  (60, 'Alpha Case Test',          'https://example.test/case',        1, 'success', 0, now(), now(), now());

INSERT INTO sr_user_bookmark (id, user_id, bookmark_id, updated_at, alias_title, type, is_starred, deleted_at) VALUES
  (100, 1, 10, now(), '', 0, false, NULL),
  (101, 1, 11, now(), '  Alpha Alias  ', 0, false, NULL),
  (102, 1, 12, now(), '', 0, false, now()),
  (103, 1, 13, now(), '', 1, false, NULL),
  (104, 1, 14, now(), '', 0, false, NULL),
  (105, 1, 15, now(), '', 0, false, NULL),
  (107, 1, 30, now(), 'My Alpha Follow', 0, false, NULL),
  (108, 1, 50, now(), '', 0, false, NULL),
  (109, 1, 51, now(), '', 0, false, NULL),
  (110, 1, 52, now(), '', 0, false, NULL),
  (111, 1, 53, now(), '', 0, false, NULL),
  (112, 1, 54, now(), '', 0, false, NULL),
  (113, 1, 55, now(), '', 0, false, NULL),
  (114, 1, 60, now(), '', 0, false, NULL),
  (200, 2, 30, now(), '', 0, true,  NULL),
  (201, 2, 16, now(), '', 0, true,  NULL),
  (202, 2, 41, now(), '', 0, true,  NULL),
  (210, 10, 31, now(), '', 0, true, NULL),
  (211, 11, 32, now(), '', 0, true, NULL),
  (212, 12, 33, now(), '', 0, true, NULL),
  (213, 13, 34, now(), '', 0, false, NULL),
  (214, 3, 35, now(), '', 0, true, NULL),
  (215, 17, 36, now(), '', 0, true, NULL),
  (216, 16, 37, now(), '', 0, true, NULL),
  (217, 9, 38, now(), '', 0, true, NULL),
  (218, 5, 39, now(), '', 0, true, NULL),
  (219, 6, 40, now(), '', 0, true, NULL),
  (220, 14, 42, now(), '', 0, true, NULL),
  (230, 8, 70, now(), '', 0, true, NULL),
  (231, 7, 70, now(), 'My Alpha Shared Eight', 0, false, NULL),
  (232, 7, 71, now(), 'My Alpha Stale Own', 0, false, NULL),
  (234, 18, 90, now(), '', 0, true, NULL),
  (235, 19, 91, now(), '', 0, true, NULL),
  (236, 7, 92, now(), '', 0, true, NULL),
  (237, 20, 93, now(), '', 0, true, now()),
  (240, 1, 80, now(), 'Alpha Revocable Alias', 0, false, NULL);

INSERT INTO sr_user_collection (id, owner_id, display_name, collection_code, status, updated_at) VALUES
  (20, 1,  'Alpha Own Collection',   'own-c',          1, now()),
  (21, 2,  'Alpha Follow Collection','follow-c',       1, now()),
  (22, 3,  'Alpha Deleted Owner',    'deleted-owner-c',1, now()),
  (23, 5,  'Alpha Closed',           'closed-c',       0, now()),
  (24, 6,  'Alpha No Code',          '',               1, now()),
  (25, 17, 'Alpha Expired',          'expired-c',      1, now()),
  (26, 16, 'Alpha Deleted Sub',      'deleted-sub-c',  1, now()),  (27, 9,  'Alpha Inactive Sub',     'inactive-sub-c', 1, now()),
  (28, 10, 'Alpha Private',          'private-c',      1, now()),
  (29, 11, 'Alpha Shared',           'shared-c',       1, now()),
  (30, 12, 'Alpha Moderated',        'moderated-c',    1, now()),
  (31, 13, 'Alpha Unstarred',        'unstarred-c',    1, now()),
  (32, 14, 'Alpha Share Disabled Owner', 'share-disabled-c', 1, now()),
  (33, 8,  'Alpha Eight Collection', 'eight-c',         1, now()),
  (34, 15, 'Alpha Empty Members',    'empty-members-c', 1, now()),
  (35, 18, 'Alpha Pending Status',   'pending-status-c', 1, now()),
  (36, 19, 'Alpha Private Mismatch', 'private-mismatch-c', 1, now()),
  (37, 7,  'Alpha Own Eligible',     'own-eligible-c',  1, now()),
  (38, 20, 'Alpha Deleted Member Subject', 'deleted-member-c', 1, now());

INSERT INTO sr_user_collection_subscriber (user_id, collection_id, owner_id, subscription_end_time, next_invoice_time, updated_at, is_active, is_deleted) VALUES
  (1, 21, 2,  '2999-01-01T00:00:00Z', '2999-01-01T00:00:00Z', now(), true,  false),
  (1, 22, 3,  '2999-01-01T00:00:00Z', '2999-01-01T00:00:00Z', now(), true,  false),
  (1, 23, 5,  '2999-01-01T00:00:00Z', '2999-01-01T00:00:00Z', now(), true,  false),
  (1, 25, 17, now() - interval '1 day', now() - interval '1 day', now(), true, false),
  (1, 26, 16, '2999-01-01T00:00:00Z', '2999-01-01T00:00:00Z', now(), true,  true),
  (1, 27, 9,  '2999-01-01T00:00:00Z', '2999-01-01T00:00:00Z', now(), false, false),
  (1, 28, 10, '2999-01-01T00:00:00Z', '2999-01-01T00:00:00Z', now(), true,  false),
  (1, 29, 11, '2999-01-01T00:00:00Z', '2999-01-01T00:00:00Z', now(), true,  false),
  (1, 30, 12, '2999-01-01T00:00:00Z', '2999-01-01T00:00:00Z', now(), true,  false),
  (1, 31, 13, '2999-01-01T00:00:00Z', '2999-01-01T00:00:00Z', now(), true,  false),
  (1, 32, 14, '2999-01-01T00:00:00Z', '2999-01-01T00:00:00Z', now(), true,  false),
  (7, 33, 8,  '2999-01-01T00:00:00Z', '2999-01-01T00:00:00Z', now(), true,  false);

INSERT INTO sr_bookmark_share (user_id, bookmark_id, is_enable) VALUES
  (11, 32, true),
  (14, 42, false);

INSERT INTO sr_user_lab_feature (user_id, feature, enabled, updated_at) VALUES
  (1, 'rss', true, now()),
  (3, 'rss', true, now()),
  (4, 'rss', false, now());

INSERT INTO sr_rss_feed (id, feed_url, title) VALUES
  ('123', 'https://example.test/feed-123.xml', 'Alpha Feed Title'),
  ('124', 'https://example.test/feed-124.xml', 'Alpha Other Feed'),
  ('125', 'https://example.test/feed-125.xml', 'Alpha Lab Off Feed');

INSERT INTO sr_rss_subscription (id, user_id, feed_id, remark) VALUES
  ('sub-123', 1, '123', '  Alpha Remark  '),
  ('sub-123-c', 3, '123', NULL),
  ('sub-125', 4, '125', NULL);

INSERT INTO sr_rss_entry (id, feed_id, entry_key, title, summary, content_key, sort_at, article_url) VALUES
  ('456', '123', 'entry-456', 'Alpha Entry Title', 'summary', 'rss/456', now(), 'https://example.test/entry-456'),
  ('457', '123', 'entry-457', 'Unrelated Entry',   'summary', 'rss/457', now(), NULL),
  ('458', '124', 'entry-458', 'Alpha Unsub Entry', 'summary', 'rss/458', now(), NULL),
  ('459', '125', 'entry-459', 'Alpha Lab Off Entry','summary','rss/459', now(), NULL);
`

const articleIds = (rows: { type: string; entity_id: string }[]) => rows.filter(row => row.type === 'article').map(row => row.entity_id)
const collectionIds = (rows: { type: string; entity_id: string }[]) => rows.filter(row => row.type === 'collection').map(row => row.entity_id)
const rssFeedIds = (rows: { type: string; entity_id: string }[]) => rows.filter(row => row.type === 'rss_feed').map(row => row.entity_id)
const rssEntryIds = (rows: { type: string; entity_id: string }[]) => rows.filter(row => row.type === 'rss_entry').map(row => row.entity_id)

describe('HybridSearchRepo.titleCandidates', () => {
  test('matches own article titles and aliases case-insensitively', async () => {
    expect(await repo.titleCandidates(1, 'Alpha Own Article', 20)).toEqual([{ type: 'article', entity_id: '10', matched_title: 'Alpha Own Article' }])
    expect(await repo.titleCandidates(1, 'ALPHA OWN ARTICLE', 20)).toEqual([{ type: 'article', entity_id: '10', matched_title: 'Alpha Own Article' }])
    expect(await repo.titleCandidates(1, 'alpha alias', 20)).toEqual([{ type: 'article', entity_id: '11', matched_title: '  Alpha Alias  ' }])
  })

  test('treats %, _, the escape character and backslash literally in the bound title pattern', async () => {
    expect(await repo.titleCandidates(1, '100%', 20)).toEqual([{ type: 'article', entity_id: '50', matched_title: '100% Alpha' }])
    expect(await repo.titleCandidates(1, 'snake_case', 20)).toEqual([{ type: 'article', entity_id: '52', matched_title: 'snake_case Alpha' }])
    expect(await repo.titleCandidates(1, 'snakeXcase', 20)).toEqual([])
    expect(await repo.titleCandidates(1, 'back\\slash', 20)).toEqual([{ type: 'article', entity_id: '53', matched_title: 'back\\slash Alpha' }])
    expect(await repo.titleCandidates(1, 'bang!Alpha', 20)).toEqual([{ type: 'article', entity_id: '54', matched_title: 'bang!Alpha' }])
    expect(await repo.titleCandidates(1, "quote'Alpha", 20)).toEqual([{ type: 'article', entity_id: '55', matched_title: "quote'Alpha" }])
    expect(await repo.titleCandidates(1, '%', 20)).toEqual([{ type: 'article', entity_id: '50', matched_title: '100% Alpha' }])
    expect(await repo.titleCandidates(1, '_', 20)).toEqual([{ type: 'article', entity_id: '52', matched_title: 'snake_case Alpha' }])
    expect(await repo.titleCandidates(1, '\\', 20)).toEqual([{ type: 'article', entity_id: '53', matched_title: 'back\\slash Alpha' }])
  })

  test('binds SQL-shaped keywords as literal text', async () => {
    expect(await repo.titleCandidates(1, "'); DROP TABLE sr_bookmark; --", 20)).toEqual([])
    const count = await pg.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM sr_bookmark')
    expect(count.rows[0].count).toBe(34)
  })

  test('keeps existing article admission for shortcuts, pending saves and deleted saves', async () => {
    expect(await repo.titleCandidates(1, 'Alpha Shortcut', 20)).toEqual([{ type: 'article', entity_id: '13', matched_title: 'Alpha Shortcut' }])
    expect(await repo.titleCandidates(1, 'Alpha Pending', 20)).toEqual([
      { type: 'article', entity_id: '14', matched_title: 'Alpha Pending' },
      { type: 'collection', entity_id: '35', matched_title: 'Alpha Pending Status' }
    ])
    expect(await repo.titleCandidates(1, 'Alpha Deleted Save', 20)).toEqual([])
  })

  test('admits followed Collection members only while the subscription and share policy currently allow it', async () => {
    expect(await repo.titleCandidates(1, 'Alpha Follow Member', 20)).toEqual([{ type: 'article', entity_id: '30', matched_title: 'Alpha Follow Member' }])
    expect(await repo.titleCandidates(1, 'Alpha Shared Member', 20)).toEqual([{ type: 'article', entity_id: '32', matched_title: 'Alpha Shared Member' }])

    const inaccessible = [
      'Alpha Private Member',
      'Alpha Moderated Member',
      'Alpha Unstarred Member',
      'Alpha Deleted Owner Member',
      'Alpha Expired Member',
      'Alpha Deleted Sub Member',
      'Alpha Inactive Sub Member',
      'Alpha Closed Member',
      'Alpha No Code Member',
      'Alpha Share Disabled Member'
    ]
    for (const keyword of inaccessible) {
      expect(articleIds(await repo.titleCandidates(1, keyword, 20)), keyword).toEqual([])
    }
  })

  test('searches published Collection subjects without recommendation exclusions but rejects nonpublic subjects', async () => {
    expect(await repo.titleCandidates(1, 'Alpha Own Collection', 20)).toEqual([{ type: 'collection', entity_id: '20', matched_title: 'Alpha Own Collection' }])
    expect(await repo.titleCandidates(1, 'Alpha Follow Collection', 20)).toEqual([{ type: 'collection', entity_id: '21', matched_title: 'Alpha Follow Collection' }])
    expect(await repo.titleCandidates(1, 'Alpha Private', 20)).toEqual([
      { type: 'collection', entity_id: '28', matched_title: 'Alpha Private' },
      { type: 'collection', entity_id: '36', matched_title: 'Alpha Private Mismatch' }
    ])
    expect(await repo.titleCandidates(1, 'Alpha Shared', 20)).toEqual([
      { type: 'article', entity_id: '32', matched_title: 'Alpha Shared Member' },
      { type: 'collection', entity_id: '29', matched_title: 'Alpha Shared' }
    ])
    expect(await repo.titleCandidates(1, 'Alpha Expired', 20)).toEqual([{ type: 'collection', entity_id: '25', matched_title: 'Alpha Expired' }])
    expect(await repo.titleCandidates(1, 'Alpha Deleted Sub', 20)).toEqual([{ type: 'collection', entity_id: '26', matched_title: 'Alpha Deleted Sub' }])
    expect(await repo.titleCandidates(1, 'Alpha Inactive Sub', 20)).toEqual([{ type: 'collection', entity_id: '27', matched_title: 'Alpha Inactive Sub' }])

    for (const keyword of ['Alpha Deleted Owner', 'Alpha Closed', 'Alpha No Code']) {
      expect(collectionIds(await repo.titleCandidates(1, keyword, 20)), keyword).toEqual([])
    }
  })

  test('searches subscribed RSS feed and entry titles with the lab gate and remark precedence', async () => {
    expect(await repo.titleCandidates(1, 'Alpha Remark', 20)).toEqual([{ type: 'rss_feed', entity_id: '123', matched_title: '  Alpha Remark  ' }])
    expect(await repo.titleCandidates(1, 'Alpha Feed Title', 20)).toEqual([{ type: 'rss_feed', entity_id: '123', matched_title: 'Alpha Feed Title' }])
    expect(await repo.titleCandidates(1, 'Alpha Entry Title', 20)).toEqual([{ type: 'rss_entry', entity_id: '456', matched_title: 'Alpha Entry Title' }])
    expect(await repo.titleCandidates(1, 'Unrelated Entry', 20)).toEqual([{ type: 'rss_entry', entity_id: '457', matched_title: 'Unrelated Entry' }])

    expect(await repo.titleCandidates(1, 'Alpha Lab Off Entry', 20)).toEqual([])
    expect(await repo.titleCandidates(1, 'Alpha Unsub Entry', 20)).toEqual([])
    expect(await repo.titleCandidates(1, 'Alpha Lab Off Feed', 20)).toEqual([])
    expect(await repo.titleCandidates(4, 'Alpha Lab Off Entry', 20)).toEqual([])
    expect(await repo.titleCandidates(4, 'Alpha Lab Off Feed', 20)).toEqual([])
    expect(await repo.titleCandidates(3, 'Alpha Remark', 20)).toEqual([])
    expect(await repo.titleCandidates(3, 'Alpha Entry Title', 20)).toEqual([])
  })

  test('deduplicates one article reached through several origins and keeps same-URL snapshots distinct', async () => {
    expect(await repo.titleCandidates(1, 'Alpha Follow', 20)).toEqual([
      { type: 'article', entity_id: '30', matched_title: 'Alpha Follow Member' },
      { type: 'collection', entity_id: '21', matched_title: 'Alpha Follow Collection' }
    ])

    expect(await repo.titleCandidates(1, 'Alpha Snapshot', 20)).toEqual([
      { type: 'article', entity_id: '15', matched_title: 'Alpha Snapshot One' },
      { type: 'article', entity_id: '16', matched_title: 'Alpha Snapshot Two' }
    ])
  })

  test('returns typed identities, applies the overall limit and orders deterministically', async () => {
    const all = await repo.titleCandidates(1, 'Alpha', 100)
    expect(new Set(all.map(row => row.type))).toEqual(new Set(['article', 'collection', 'rss_feed', 'rss_entry']))
    for (const row of all) {
      expect(typeof row.entity_id).toBe('string')
      expect(typeof row.matched_title).toBe('string')
      expect(row.matched_title.length).toBeGreaterThan(0)
    }
    expect(rssFeedIds(all)).toContain('123')
    expect(rssEntryIds(all)).toContain('456')

    const limited = await repo.titleCandidates(1, 'Alpha', 3)
    expect(limited).toHaveLength(3)
    expect(await repo.titleCandidates(1, 'Alpha', 3)).toEqual(limited)
  })

  test('returns nothing for a deleted viewer', async () => {
    expect(await repo.titleCandidates(3, 'Alpha', 100)).toEqual([])
  })

  test('rejects a leftover own save for another user’s private snapshot when no Collection path exists', async () => {
    expect(await repo.titleCandidates(7, 'Alpha Stale Own Origin', 20)).toEqual([])
  })

  test('admits that private snapshot only through a legitimately followed shared Collection', async () => {
    expect(await repo.titleCandidates(7, 'Alpha Shared Eight', 20)).toEqual([{ type: 'article', entity_id: '70', matched_title: 'Alpha Shared Eight' }])
  })

  test('rechecks bounded keyword candidates after the matching alias is revoked or renamed', async () => {
    const initial = await repo.titleCandidates(1, 'Alpha Revocable Alias', 20)
    expect(initial).toEqual([{ type: 'article', entity_id: '80', matched_title: 'Alpha Revocable Alias' }])
    const bounded = initial.map(({ type, entity_id }) => ({ type, entity_id }))

    await pg.query("UPDATE sr_user_bookmark SET alias_title = '' WHERE id = 240")
    expect(await repo.titleCandidates(1, 'Alpha Revocable Alias', 20, bounded)).toEqual([])
    expect(await repo.articles(1, [80])).toEqual([
      expect.objectContaining({ bookmark_id: 80, user_id: 1, cb_id: 240, title: 'Stable Body Title' })
    ])

    await pg.query("UPDATE sr_user_bookmark SET alias_title = 'Renamed Elsewhere' WHERE id = 240")
    expect(await repo.titleCandidates(1, 'Alpha Revocable Alias', 20, bounded)).toEqual([])
    expect(await repo.titleCandidates(1, 'Renamed Elsewhere', 20, bounded)).toEqual([
      { type: 'article', entity_id: '80', matched_title: 'Renamed Elsewhere' }
    ])
  })

  test('applies candidate type and exact id filters instead of interpreting them as unrestricted', async () => {
    expect(await repo.titleCandidates(1, 'Alpha', 20, [])).toEqual([])
    expect(await repo.titleCandidates(1, 'Alpha', 20, [{ type: 'article', entity_id: '80' }])).toEqual([
      { type: 'article', entity_id: '80', matched_title: 'Alpha Revocable Alias' }
    ])
    expect(
      await repo.titleCandidates(1, 'Alpha', 20, [
        { type: 'article', entity_id: '80' },
        { type: 'article', entity_id: '80' }
      ])
    ).toEqual([{ type: 'article', entity_id: '80', matched_title: 'Alpha Revocable Alias' }])
    expect(await repo.titleCandidates(1, 'Alpha', 20, [{ type: 'collection', entity_id: '20' }])).toEqual([
      { type: 'collection', entity_id: '20', matched_title: 'Alpha Own Collection' }
    ])
    expect(await repo.titleCandidates(1, 'Alpha Own Article', 20, [{ type: 'article', entity_id: '8' }])).toEqual([])
    expect(await repo.titleCandidates(1, 'Alpha', 20, [{ type: 'article', entity_id: '20' }])).toEqual([])
    expect(await repo.titleCandidates(1, 'Alpha', 20, [{ type: 'rss_feed', entity_id: '20' }])).toEqual([])
    expect(await repo.titleCandidates(1, 'Alpha', 20, [{ type: 'rss_feed', entity_id: '123' }])).toEqual([
      { type: 'rss_feed', entity_id: '123', matched_title: '  Alpha Remark  ' }
    ])
  })
})

describe('HybridSearchRepo hydration and current admission', () => {
  test('hydrates own articles with trimmed aliases, numeric cb_id and owner relation', async () => {
    const rows = await repo.articles(1, [10, 11])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ bookmark_id: 10, user_id: 1, cb_id: 100, title: 'Alpha Own Article', collection_id: 20, collection_readable: false })
    expect(rows[1]).toMatchObject({ bookmark_id: 11, user_id: 1, cb_id: 101, title: 'Alpha Alias', collection_id: 20, collection_readable: false })
    expect(typeof rows[0].cb_id).toBe('number')
    expect(typeof rows[0].collection_readable).toBe('boolean')

    const stored = (await pg.query<{ uuid: string; cb_id: number }>('SELECT uuid, id AS cb_id FROM sr_user_bookmark WHERE id = 100')).rows[0]
    expect(rows[0].cb_id).toBe(stored.cb_id)
    expect(rows[0].bookmark_user_uuid).toBe(stored.uuid)
    expect(rows[0].cb_id).not.toBe(rows[0].bookmark_id)
  })

  test('returns the readable Collection origin instead of a stale own origin for another user’s private snapshot', async () => {
    const rows = await repo.articles(1, [30])
    expect(rows.map(row => ({ user_id: row.user_id, cb_id: row.cb_id, collection_id: row.collection_id, readable: row.collection_readable }))).toEqual([
      { user_id: 2, cb_id: 200, collection_id: 21, readable: true }
    ])
    expect(rows[0].title).toBe('Alpha Follow Member')
  })

  test('keeps same-URL snapshots separate and hydrates their real navigation ids', async () => {
    const rows = await repo.articles(1, [15, 16])
    expect(rows.map(row => [row.bookmark_id, row.user_id, row.cb_id])).toEqual([
      [15, 1, 105],
      [16, 2, 201]
    ])
    expect(new Set(rows.map(row => row.target_url))).toEqual(new Set(['https://example.test/shared']))
    expect(rows[1].collection_readable).toBe(true)
  })

  test('hydrates a share-enabled member and drops deleted, expired, inactive, closed, moderated or unstarred saves', async () => {
    expect(await repo.articles(1, [32])).toEqual([
      expect.objectContaining({ bookmark_id: 32, user_id: 11, cb_id: 211, collection_id: 29, collection_readable: true })
    ])

    const inaccessible = [12, 31, 33, 34, 35, 36, 37, 38, 39, 40, 42]
    expect(await repo.articles(1, inaccessible)).toEqual([])
    expect(await repo.articles(3, [10])).toEqual([])
  })

  test('drops stale article-vector and Collection-vector identities at hydration', async () => {
    expect(await repo.articles(1, [12])).toEqual([])
    expect(await repo.collections(1, [23])).toEqual([])
  })

  test('keeps the followed shared Collection origin and drops the stale own origin for a private snapshot', async () => {
    const rows = await repo.articles(7, [70])
    expect(rows.map(row => ({ user_id: row.user_id, cb_id: row.cb_id, collection_id: row.collection_id, collection_readable: row.collection_readable }))).toEqual([
      { user_id: 8, cb_id: 230, collection_id: 33, collection_readable: true }
    ])
    expect(rows[0].title).toBe('Alpha Shared Eight')
    expect(rows[0].target_url).toBe('https://example.test/shared-eight')
    expect(rows.some(row => row.user_id === 7)).toBe(false)
  })

  test('returns no title, URL or body origin for a stale own relation without a Collection path', async () => {
    expect(await repo.articles(7, [71])).toEqual([])
  })

  test('currently exposes a published Collection subject with zero eligible members (metadata discoverability)', async () => {
    const members = await pg.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM sr_user_bookmark WHERE user_id = 15')
    expect(members.rows[0].count).toBe(0)

    expect(await repo.titleCandidates(1, 'Alpha Empty Members', 20)).toEqual([{ type: 'collection', entity_id: '34', matched_title: 'Alpha Empty Members' }])
    expect((await repo.collections(1, [34], false)).map(row => row.collection_id)).toEqual([34])
    expect(await repo.collections(1, [34], true)).toEqual([])
  })

  test('requires a current eligible public member only when Collection vector admission asks for it', async () => {
    const ids = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38]
    expect((await repo.collections(1, ids, true)).map(row => row.collection_id)).toEqual([21, 25, 26, 27, 29, 33, 37])

    for (const id of [20, 28, 30, 31, 32, 35, 36, 38]) expect(await repo.collections(1, [id], true), String(id)).toEqual([])
    expect(await repo.collections(1, [22, 23, 24, 34], true)).toEqual([])

    expect((await repo.collections(1, [31, 35, 36, 38], false)).map(row => row.collection_id)).toEqual([31, 35, 36, 38])
    expect((await repo.collections(7, [33, 37], true)).map(row => row.collection_id)).toEqual([33, 37])
    expect((await repo.collections(1, [21, 33, 37], true)).map(row => row.collection_id)).toEqual([21, 33, 37])

    expect(await repo.titleCandidates(1, 'Alpha Unstarred', 20)).toEqual([{ type: 'collection', entity_id: '31', matched_title: 'Alpha Unstarred' }])
    expect(await repo.titleCandidates(1, 'Alpha Pending Status', 20)).toEqual([{ type: 'collection', entity_id: '35', matched_title: 'Alpha Pending Status' }])
    expect(await repo.titleCandidates(1, 'Alpha Private Mismatch', 20)).toEqual([{ type: 'collection', entity_id: '36', matched_title: 'Alpha Private Mismatch' }])
    expect(await repo.titleCandidates(1, 'Alpha Deleted Member Subject', 20)).toEqual([
      { type: 'collection', entity_id: '38', matched_title: 'Alpha Deleted Member Subject' }
    ])
  })

  test('revalidates current readability before hydration instead of trusting an earlier candidate', async () => {
    expect(await repo.articles(1, [30])).toHaveLength(1)
    await pg.query(`UPDATE sr_user_collection_subscriber SET subscription_end_time = now() - interval '1 day' WHERE user_id = 1 AND collection_id = 21`)
    expect(await repo.articles(1, [30])).toEqual([])

    await pg.query(`UPDATE sr_user SET deleted_at = now() WHERE id = 2`)
    expect(await repo.articles(1, [30])).toEqual([])
    expect(await repo.articles(1, [16])).toEqual([])
    expect(await repo.articles(3, [30])).toEqual([])
  })

  test('hydrates only currently published, owner-alive Collections and revalidates closure', async () => {
    const rows = await repo.collections(1, [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32])
    expect(rows.map(row => row.collection_id)).toEqual([20, 21, 25, 26, 27, 28, 29, 30, 31, 32])
    expect(rows.every(row => typeof row.collection_id === 'number' && typeof row.owner_id === 'number')).toBe(true)
    expect(await repo.collections(3, [20])).toEqual([])

    await pg.query('UPDATE sr_user_collection SET status = 0 WHERE id = 25')
    expect((await repo.collections(1, [25])).map(row => row.collection_id)).toEqual([])
  })

  test('hydrates subscribed RSS ids, remark precedence and the current lab gate', async () => {
    expect(await repo.rssFeeds(1, ['123', '124'])).toEqual([{ feed_id: '123', subscription_id: 'sub-123', title: 'Alpha Remark' }])
    expect(await repo.rssEntries(1, ['456', '457', '458'])).toEqual([
      {
        entry_id: '456',
        feed_id: '123',
        subscription_id: 'sub-123',
        title: 'Alpha Entry Title',
        article_url: 'https://example.test/entry-456',
        source_title: 'Alpha Remark'
      },
      {
        entry_id: '457',
        feed_id: '123',
        subscription_id: 'sub-123',
        title: 'Unrelated Entry',
        article_url: null,
        source_title: 'Alpha Remark'
      }
    ])
    expect(await repo.rssEntries(1, ['459'])).toEqual([])
    expect(await repo.rssEntries(4, ['459'])).toEqual([])
    expect(await repo.rssFeeds(4, ['125'])).toEqual([])
    expect(await repo.rssFeeds(3, ['123'])).toEqual([])

    await pg.query("UPDATE sr_user_lab_feature SET enabled = false WHERE user_id = 1 AND feature = 'rss'")
    expect(await repo.rssFeeds(1, ['123'])).toEqual([])
    expect(await repo.rssEntries(1, ['456'])).toEqual([])
  })

  test('keeps numeric-looking RSS identifiers as strings', async () => {
    const [feed] = await repo.rssFeeds(1, ['123'])
    const [entry] = await repo.rssEntries(1, ['456'])
    expect(typeof feed.feed_id).toBe('string')
    expect(typeof feed.subscription_id).toBe('string')
    expect(typeof entry.entry_id).toBe('string')
    expect(typeof entry.feed_id).toBe('string')
    expect(entry).not.toHaveProperty('summary')
    expect(entry).not.toHaveProperty('content')
  })

  test('does not query for empty id sets', async () => {
    expect(await repo.articles(1, [])).toEqual([])
    expect(await repo.collections(1, [])).toEqual([])
    expect(await repo.rssFeeds(1, [])).toEqual([])
    expect(await repo.rssEntries(1, [])).toEqual([])
    expect(pgQuery).not.toHaveBeenCalled()
  })
})

const d1Prisma = () =>
  ({
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.reduce((text, part, index) => text + part + (index < values.length ? '?' : ''), '')
      const statement = d1.prepare(sql)
      const bound = values.length ? statement.bind(...values) : statement
      return (await bound.all()).results ?? []
    }
  }) as unknown as PrismaClient

const insertRaw = (bookmarkId: number, content: string, title = 'doc') =>
  d1
    .prepare('INSERT INTO slax_bookmark_raw (shard_idx, bookmark_id, content, raw_content, title, raw_title) VALUES (?,?,?,?,?,?)')
    .bind(0, bookmarkId, content, content, title, title)
    .run()

async function rawRows() {
  return (
    await d1
      .prepare(
        'SELECT r.bookmark_id, bm25(slax_fts_bookmark) AS score FROM slax_fts_bookmark JOIN slax_bookmark_raw r ON r.id = slax_fts_bookmark.rowid WHERE slax_fts_bookmark MATCH ? ORDER BY r.bookmark_id'
      )
      .bind('alpha')
      .all<{ bookmark_id: number; score: number }>()
  ).results ?? []
}

describe('BookmarkSearchRepo.searchCandidatePage on real D1 FTS5', () => {
  beforeEach(async () => {
    await d1.exec('DELETE FROM slax_bookmark_raw')
  })

  test('orders BM25 ascending with the real FTS5 relevance engine', async () => {
    const fulltext = new BookmarkSearchRepo(() => d1Prisma())
    await insertRaw(201, 'alpha')
    await insertRaw(202, 'alpha beta')
    await insertRaw(203, 'alpha beta gamma delta epsilon')
    await insertRaw(204, 'beta gamma')

    const rows = await fulltext.searchCandidatePage('alpha', 0, 20)
    expect(rows.map(row => row.bookmark_id)).toEqual([201, 202, 203])
    expect(rows[0].score).toBeLessThan(rows[1].score)
    expect(rows[1].score).toBeLessThan(rows[2].score)
    expect(rows.every(row => typeof row.row_id === 'number' && typeof row.bookmark_id === 'number' && typeof row.score === 'number')).toBe(true)
    expect(rows.every(row => typeof row.excerpt === 'string')).toBe(true)
  })

  test('breaks BM25 ties by bookmark and row id', async () => {
    const fulltext = new BookmarkSearchRepo(() => d1Prisma())
    await insertRaw(206, 'alpha tie')
    await insertRaw(205, 'alpha tie')

    expect((await fulltext.searchCandidatePage('alpha', 0, 20)).map(row => row.bookmark_id)).toEqual([205, 206])
  })

  test('pages a bounded candidate set without duplicates or full-history loading', async () => {
    const fulltext = new BookmarkSearchRepo(() => d1Prisma())
    for (let bookmarkId = 300; bookmarkId < 325; bookmarkId++) await insertRaw(bookmarkId, 'token')

    const first = await fulltext.searchCandidatePage('token', 0, 10)
    const second = await fulltext.searchCandidatePage('token', 10, 10)
    const third = await fulltext.searchCandidatePage('token', 20, 10)

    expect([first.length, second.length, third.length]).toEqual([10, 10, 5])
    const ids = [...first, ...second, ...third].map(row => row.bookmark_id)
    expect(new Set(ids).size).toBe(25)
    expect(ids).toEqual(Array.from({ length: 25 }, (_, index) => 300 + index))
  })

  test('binds the keyword as data and leaves the index intact for SQL-shaped input', async () => {
    const fulltext = new BookmarkSearchRepo(() => d1Prisma())
    await insertRaw(401, 'alpha safe')

    // The keyword is bound, never interpolated. FTS5 may reject the query syntax,
    // but the table and its data must survive either outcome.
    await fulltext.searchCandidatePage("alpha'); DROP TABLE slax_bookmark_raw; --", 0, 10).catch(() => undefined)
    const count = await d1.prepare('SELECT COUNT(*) AS count FROM slax_bookmark_raw').first<{ count: number }>()
    expect(count.count).toBe(1)
    expect((await fulltext.searchCandidatePage('alpha', 0, 10)).map(row => row.bookmark_id)).toEqual([401])
  })

  test('keeps FTS5 synchronized for updated and deleted raw rows', async () => {
    const fulltext = new BookmarkSearchRepo(() => d1Prisma())
    await insertRaw(501, 'alpha old', 'alpha old title')
    await insertRaw(502, 'alpha other')

    await d1.prepare('UPDATE slax_bookmark_raw SET content = ?, title = ? WHERE bookmark_id = ?').bind('delta', 'renamed', 501).run()
    expect((await fulltext.searchCandidatePage('alpha', 0, 10)).map(row => row.bookmark_id)).toEqual([502])
    expect((await fulltext.searchCandidatePage('delta', 0, 10)).map(row => row.bookmark_id)).toEqual([501])

    await d1.prepare('DELETE FROM slax_bookmark_raw WHERE bookmark_id = ?').bind(502).run()
    expect(await fulltext.searchCandidatePage('alpha', 0, 10)).toEqual([])
    expect((await rawRows()).length).toBe(0)
  })

  test('returns stale retrieval candidates that current PostgreSQL admission then removes', async () => {
    const fulltext = new BookmarkSearchRepo(() => d1Prisma())
    await insertRaw(12, 'alpha deleted save')
    await insertRaw(31, 'alpha unreadable member')

    const candidates = await fulltext.searchCandidatePage('alpha', 0, 10)
    expect(candidates.map(row => row.bookmark_id)).toEqual([12, 31])

    expect(await repo.articles(1, candidates.map(row => row.bookmark_id))).toEqual([])
  })
})
