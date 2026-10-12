import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { RssRepo } from '@/infra/repository/dbRss'
import { LabRepo } from '@/infra/repository/dbLab'
import { RssError, parseFeed } from '@/domain/rss/feed'

// Execute production tagged SQL and the migration against embedded PostgreSQL.
// Only Prisma's model-call surface is adapted; SQL, constraints and transactions are real.
let db: PGlite
let repo: RssRepo
const adapter = (connection: any): any => {
  const query = async (parts: TemplateStringsArray, ...values: unknown[]) =>
    (
      await connection.query(
        parts.reduce((sql, part, i) => sql + (i ? '$' + i : '') + part, ''),
        values
      )
    ).rows
  const insert = async (table: string, data: Record<string, unknown>) => {
    const fields = Object.keys(data)
    return (
      await connection.query('INSERT INTO ' + table + '(' + fields.join(',') + ') VALUES (' + fields.map((_, i) => '$' + (i + 1)).join(',') + ') RETURNING *', Object.values(data))
    ).rows[0]
  }
  return {
    $queryRaw: query,
    $executeRaw: query,
    $transaction: (fn: any) => connection.transaction((tx: any) => fn(adapter(tx))),
    sr_user_lab_feature: {
      upsert: async ({ create }: any) =>
        (
          await connection.query(
            'INSERT INTO sr_user_lab_feature(user_id,feature,enabled) VALUES($1,$2,$3) ON CONFLICT(user_id,feature) DO UPDATE SET enabled=EXCLUDED.enabled RETURNING *',
            [create.user_id, create.feature, create.enabled]
          )
        ).rows[0]
    },
    sr_bookmark: {
      upsert: async ({ where, create }: any) => {
        const key = where.target_url_private_user
        const rows = (await connection.query('SELECT * FROM sr_bookmark WHERE target_url=$1 AND private_user=$2', [key.target_url, key.private_user])).rows
        return rows[0] || insert('sr_bookmark', create)
      }
    },
    sr_user_bookmark: {
      findUnique: async ({ where }: any) => {
        const key = where.user_id_bookmark_id
        return (await connection.query('SELECT * FROM sr_user_bookmark WHERE user_id=$1 AND bookmark_id=$2', [key.user_id, key.bookmark_id])).rows[0] || null
      },
      create: ({ data }: any) => insert('sr_user_bookmark', data),
      update: async ({ where, data }: any) =>
        (
          await connection.query(
            'UPDATE sr_user_bookmark SET ' +
              Object.keys(data)
                .map((k, i) => k + '=$' + (i + 1))
                .join(',') +
              ' WHERE id=$' +
              (Object.keys(data).length + 1) +
              ' RETURNING *',
            [...Object.values(data), where.id]
          )
        ).rows[0]
    },
    sr_user_delete_bookmark: {
      deleteMany: async ({ where }: any) => connection.query('DELETE FROM sr_user_delete_bookmark WHERE user_id=$1 AND bookmark_id=$2', [where.user_id, where.bookmark_id])
    }
  }
}
beforeAll(async () => {
  // Prisma adapter-pg serializes and parses TIMESTAMP WITHOUT TIME ZONE as UTC.
  db = new PGlite({
    parsers: { 1114: value => new Date(value.replace(' ', 'T') + 'Z') },
    serializers: { 1114: value => (value instanceof Date ? value.toISOString().replace('T', ' ').replace('Z', '') : String(value)) }
  })
  await db.exec(`
    CREATE TABLE sr_user(id INT PRIMARY KEY, deleted_at TIMESTAMP, lang TEXT DEFAULT 'en');
    CREATE TABLE sr_user_lab_feature(user_id INT, feature TEXT, enabled BOOLEAN, UNIQUE(user_id,feature));
    CREATE TABLE sr_bookmark(id SERIAL PRIMARY KEY,target_url TEXT,private_user INT,host_url TEXT,title TEXT,description TEXT,created_at TIMESTAMP,updated_at TIMESTAMP,published_at TIMESTAMP,status TEXT,UNIQUE(target_url,private_user));
    CREATE TABLE sr_user_bookmark(id SERIAL PRIMARY KEY,uuid TEXT DEFAULT gen_random_uuid()::text,user_id INT,bookmark_id INT,updated_at TIMESTAMP,deleted_at TIMESTAMP,archive_status INT DEFAULT 0,archived_at TIMESTAMP,UNIQUE(user_id,bookmark_id));
    CREATE TABLE sr_user_delete_bookmark(user_id INT,bookmark_id INT);
  `)
  const migration = new URL('../../../prisma/pg_migrations/20260923042657_reset_rss_labs_shared_feed/migration.sql', import.meta.url)
  await db.exec(await readFile(migration, 'utf8'))
  const timelineIndex = new URL('../../../prisma/pg_migrations/20260923044137_add_rss_timeline_index/migration.sql', import.meta.url)
  await db.exec(await readFile(timelineIndex, 'utf8'))
  const history = new URL('../../../prisma/pg_migrations/20260923065020/migration.sql', import.meta.url)
  await db.exec(await readFile(history, 'utf8'))
  repo = new RssRepo(() => adapter(db))
}, 30_000)
beforeEach(async () => {
  await db.exec(`TRUNCATE sr_rss_feed,sr_rss_entry,sr_rss_subscription,sr_rss_save_job,sr_user_bookmark,sr_user_delete_bookmark,sr_bookmark,sr_user_lab_feature,sr_user CASCADE;
  INSERT INTO sr_user(id) VALUES(1),(2);
  INSERT INTO sr_user_lab_feature VALUES(1,'rss',true),(2,'rss',true);`)
})
afterAll(async () => {
  await db?.close()
})
const feed = async (body = '<item><guid>one</guid><title>One</title><link>https://example.com/article</link></item>') => ({
  unchanged: false as const,
  etag: 'one',
  lastModified: null,
  feed: await parseFeed('<rss><channel><title>Feed</title>' + body + '</channel></rss>', 'https://example.com/feed')
})
const stored = (result: Awaited<ReturnType<typeof feed>>) => ({
  ...result,
  feed: { ...result.feed, items: result.feed.items.map(({ content_html, ...item }) => ({ ...item, content_key: 'rss-content/test/' + crypto.randomUUID() })) }
})
const add = async (userId: number, url: string, result: Awaited<ReturnType<typeof feed>>, remark: string | null = null) => {
  const pending = await repo.beginAdd(userId, url, remark)
  return pending.subscription || repo.finishAdd(userId, pending.feed!, stored(result), remark)
}
const due = async (id: string) =>
  db.query("UPDATE sr_rss_feed SET next_fetch_at=now()-interval '1 hour',next_allowed_at=now()-interval '1 hour' WHERE id=(SELECT feed_id FROM sr_rss_subscription WHERE id=$1)", [
    id
  ])
describe('RSS PostgreSQL repository', () => {
  test('remarks survive feed refresh and clearing restores the source title', async () => {
    const sub = await add(1, 'https://example.com/feed', await feed(), 'My reading')
    expect(sub.remark).toBe('My reading')
    const [entry] = await repo.entries(1, null, null, 20)
    expect(entry.source_title).toBe('My reading')
    await due(sub.id)
    const claim = await repo.claim(1, sub.id)
    const changed = await feed()
    changed.feed.title = 'New publisher title'
    await repo.finish(claim, stored(changed))
    expect((await repo.subscriptions(1))[0]).toMatchObject({ title: 'New publisher title', remark: 'My reading' })
    await repo.updateRemark(1, sub.id, 'Another name')
    expect((await repo.entry(1, entry.id)).source_title).toBe('Another name')
    await repo.updateRemark(1, sub.id, null)
    expect((await repo.entry(1, entry.id)).source_title).toBe('New publisher title')
  })
  test('remark writes require ownership and an enabled lab', async () => {
    const sub = await add(1, 'https://example.com/feed', await feed())
    await expect(repo.updateRemark(2, sub.id, 'Other user')).rejects.toMatchObject({ code: 'not_found' })
    await db.query('UPDATE sr_user_lab_feature SET enabled=false WHERE user_id=1')
    await expect(repo.updateRemark(1, sub.id, 'Disabled')).rejects.toMatchObject({ code: 'lab_disabled' })
    expect((await repo.subscriptions(1))[0].remark).toBeNull()
  })
  test('duplicate add is idempotent and data is isolated by account', async () => {
    const a = await add(1, 'https://example.com/feed', await feed())
    const b = await add(1, 'https://example.com/feed', await feed())
    expect(a.id).toBe(b.id)
    expect(await repo.subscriptions(2)).toEqual([])
    const [entry] = await repo.entries(1, null, null, 20)
    await expect(repo.entry(2, entry.id)).rejects.toMatchObject({ code: 'not_found' })
    expect(await repo.entries(2, null, null, 20)).toEqual([])
    await repo.remove(2, a.id)
    expect(await repo.subscriptions(1)).toHaveLength(1)
  })
  test('enforces the quota inside the transaction', async () => {
    for (let i = 0; i < 20; i++) await add(1, 'https://example.com/' + i, await feed(''))
    await expect(add(1, 'https://example.com/extra', await feed(''))).rejects.toMatchObject({ code: 'limit_reached' })
    expect(await repo.subscriptions(1)).toHaveLength(20)
  })
  test('live leases collapse refreshes and stale commits cannot overwrite newer data', async () => {
    const sub = await add(1, 'https://example.com/feed', await feed())
    await due(sub.id)
    const first = await repo.claim(1, sub.id)
    expect(first.claimed).toBe(true)
    expect((await repo.claim(1, sub.id)).claimed).toBe(false)
    expect(await repo.claimDue()).toEqual([])
    await db.query('UPDATE sr_rss_feed SET lease_token=$1 WHERE id=(SELECT feed_id FROM sr_rss_subscription WHERE id=$2)', ['newer', sub.id])
    await repo.finish(first, new RssError('source_unavailable', 502))
    expect((await repo.subscriptions(1))[0].error).toBeNull()
  })
  test('failed refresh retains cached articles and honors retry-after', async () => {
    const sub = await add(1, 'https://example.com/feed', await feed())
    await due(sub.id)
    const claim = await repo.claim(1, sub.id),
      retry = new Date(Date.now() + 7200000)
    await repo.finish(claim, new RssError('source_unavailable', 502, retry))
    const [row] = await repo.subscriptions(1)
    expect(row.error).toBe('source_unavailable')
    expect(row.next_allowed_at.valueOf()).toBeGreaterThanOrEqual(retry.valueOf())
    expect(await repo.entries(1, null, null, 20)).toHaveLength(1)
    await expect(repo.claim(1, sub.id)).rejects.toMatchObject({ code: 'refresh_limited' })
  })
  test('disabled or deleted users cannot save or commit a refresh', async () => {
    const sub = await add(1, 'https://example.com/feed', await feed())
    await due(sub.id)
    const claim = await repo.claim(1, sub.id),
      [entry] = await repo.entries(1, null, null, 20)
    await db.query('UPDATE sr_user_lab_feature SET enabled=false WHERE user_id=1')
    expect(await repo.finish(claim, { unchanged: true })).toBe(false)
    await expect(repo.save(1, entry.id, entry.article_url!)).rejects.toMatchObject({ code: 'lab_disabled' })
    await db.query('UPDATE sr_user SET deleted_at=now() WHERE id=1')
    await expect(add(1, 'https://example.com/other', await feed())).rejects.toMatchObject({ code: 'not_found' })
  })
  test('saves are idempotent, restore deleted relations, and survive unsubscribe', async () => {
    const sub = await add(1, 'https://example.com/feed', await feed())
    const [entry] = await repo.entries(1, null, null, 20)
    const first = await repo.save(1, entry.id, entry.article_url!)
    expect(first.result).toBe('created')
    expect(await repo.save(1, entry.id, entry.article_url!)).toMatchObject({ result: 'already_saved', bookmark_user_uuid: first.bookmark_user_uuid })
    await db.query('UPDATE sr_user_bookmark SET deleted_at=now(),archive_status=1')
    const restored = await repo.save(1, entry.id, entry.article_url!)
    expect(restored).toMatchObject({ result: 'restored', bookmark_user_uuid: first.bookmark_user_uuid })
    expect((await db.query<{ archive_status: number }>('SELECT archive_status FROM sr_user_bookmark')).rows[0].archive_status).toBe(0)
    expect(await repo.saveJobs(1)).toHaveLength(1)
    await repo.remove(1, sub.id)
    expect(await repo.entries(1, null, null, 20)).toHaveLength(0)
    expect(await repo.saveJobs(1)).toHaveLength(1)
    expect((await db.query('SELECT * FROM sr_user_bookmark')).rows).toHaveLength(1)
  })
  test('304 keeps validators and entries, and due claims exclude disabled accounts', async () => {
    const sub = await add(1, 'https://example.com/feed', await feed())
    await due(sub.id)
    const [claim] = await repo.claimDue()
    await repo.finish(claim, { unchanged: true })
    expect((await repo.subscriptions(1))[0]).toMatchObject({ etag: 'one', lease_token: null, error: null })
    expect(await repo.entries(1, null, null, 20)).toHaveLength(1)
    await due(sub.id)
    await db.query('UPDATE sr_user_lab_feature SET enabled=false')
    expect(await repo.claimDue()).toEqual([])
  })
  test('pagination handles identical dates without duplicates', async () => {
    await add(
      1,
      'https://example.com/feed',
      await feed(Array.from({ length: 5 }, (_, i) => '<item><guid>' + i + '</guid><title>' + i + '</title><pubDate>Tue, 22 Sep 2026 00:00:00 GMT</pubDate></item>').join(''))
    )
    const first = await repo.entries(1, null, null, 2)
    const second = await repo.entries(1, null, { id: first[1].id, at: first[1].sort_at }, 4)
    expect(new Set([...first, ...second].map(x => x.id)).size).toBe(5)
  })
  test('orders the combined timeline by publication time and reorders corrected dates', async () => {
    const older = await add(1, 'https://example.com/older', await feed('<item><guid>older</guid><title>Older</title><pubDate>Sun, 20 Sep 2026 00:00:00 GMT</pubDate></item>'))
    await add(1, 'https://example.com/newer', await feed('<item><guid>newer</guid><title>Newer</title><pubDate>Tue, 22 Sep 2026 00:00:00 GMT</pubDate></item>'))
    expect((await repo.entries(1, null, null, 20)).map(row => row.title)).toEqual(['Newer', 'Older'])
    await due(older.id)
    const claim = await repo.claim(1, older.id)
    await repo.finish(claim, stored(await feed('<item><guid>older</guid><title>Older</title><pubDate>Wed, 23 Sep 2026 00:00:00 GMT</pubDate></item>')))
    expect((await repo.entries(1, null, null, 20)).map(row => row.title)).toEqual(['Older', 'Newer'])
    const indexes = await db.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename='sr_rss_entry'")
    expect(indexes.rows.map(row => row.indexname)).toContain('sr_rss_entry_timeline')
  })
})

describe('shared Feed ownership and lifecycle', () => {
  test('two users share entries and fetch state but keep their names and bookmarks', async () => {
    const a = await add(1, 'https://example.com/feed', await feed(), 'Alice')
    const b = await repo.beginAdd(2, 'https://example.com/feed', 'Bob')
    expect(b.feed).toBeUndefined()
    expect(b.subscription?.feed_id).toBe(a.feed_id)
    expect(b.subscription?.id).not.toBe(a.id)
    const [ea] = await repo.entries(1, null, null, 20),
      [eb] = await repo.entries(2, null, null, 20)
    expect(ea.id).toBe(eb.id)
    expect(ea.source_title).toBe('Alice')
    expect(eb.source_title).toBe('Bob')
    await repo.save(1, ea.id, ea.article_url!)
    expect((await repo.entry(1, ea.id)).bookmark_user_uuid).toBeTruthy()
    expect((await repo.entry(2, ea.id)).bookmark_user_uuid).toBeNull()
    expect((await db.query('SELECT * FROM sr_rss_feed')).rows).toHaveLength(1)
    expect((await db.query('SELECT * FROM sr_rss_entry')).rows).toHaveLength(1)
    await due(a.id)
    const claim = await repo.claim(1, a.id)
    expect((await repo.claim(2, b.subscription!.id)).claimed).toBe(false)
    await repo.remove(1, a.id)
    expect(await repo.finish(claim, { unchanged: true })).toBe(true)
    expect(await repo.entries(2, null, null, 20)).toHaveLength(1)
    await expect(repo.entry(1, ea.id)).rejects.toMatchObject({ code: 'not_found' })
  })
  test('concurrent first adds reserve one lease and never create invalid subscriptions', async () => {
    const first = await repo.beginAdd(1, 'https://example.com/new', null)
    await expect(repo.beginAdd(2, 'https://example.com/new', null)).rejects.toMatchObject({ code: 'refresh_limited' })
    expect(await repo.subscriptions(1)).toEqual([])
    expect(await repo.subscriptions(2)).toEqual([])
    await repo.failAdd(first.feed!, new RssError('invalid_feed'))
    expect(await repo.subscriptions(1)).toEqual([])
    expect((await db.query('SELECT * FROM sr_rss_feed')).rows).toHaveLength(0)
  })
  test('preflight never persists an unvalidated feed and successful caches are reused', async () => {
    expect(await repo.reuseForAdd(1, 'https://example.com/feed', null)).toBeNull()
    expect((await db.query('SELECT * FROM sr_rss_feed')).rows).toHaveLength(0)
    const first = await add(1, 'https://example.com/feed', await feed())
    const reused = await repo.reuseForAdd(2, 'https://example.com/feed', 'Mine')
    expect(reused).toMatchObject({ feed_id: first.feed_id, remark: 'Mine' })
    expect((await db.query('SELECT * FROM sr_rss_feed')).rows).toHaveLength(1)
  })
  test('failed initial writes clean expired leases but cannot delete a newer owner', async () => {
    const first = await repo.beginAdd(1, 'https://example.com/feed', null)
    await db.query("UPDATE sr_rss_feed SET lease_until=now()-interval '1 minute',next_allowed_at=now()-interval '1 minute'")
    const newer = await repo.beginAdd(2, 'https://example.com/feed', null)
    await repo.failAdd(first.feed!, new RssError('source_unavailable'))
    expect((await db.query('SELECT * FROM sr_rss_feed')).rows).toHaveLength(1)
    await db.query("UPDATE sr_rss_feed SET lease_until=now()-interval '1 minute'")
    await repo.failAdd(newer.feed!, new RssError('source_unavailable'))
    expect((await db.query('SELECT * FROM sr_rss_feed')).rows).toHaveLength(0)
  })
  test('a first subscriber disabling Labs does not impose source backoff on other users', async () => {
    const pending = await repo.beginAdd(1, 'https://example.com/feed', null)
    await db.query('UPDATE sr_user_lab_feature SET enabled=false WHERE user_id=1')
    await expect(repo.finishAdd(1, pending.feed!, stored(await feed()), null)).rejects.toMatchObject({ code: 'lab_disabled' })
    await repo.failAdd(pending.feed!, new RssError('lab_disabled', 403))
    const other = await repo.beginAdd(2, 'https://example.com/feed', null)
    expect(other.feed?.claimed).toBe(true)
    expect(other.feed?.error).toBeNull()
  })
  test('query tokens identify different feeds', async () => {
    const a = await add(1, 'https://example.com/feed?token=a', await feed())
    const b = await add(2, 'https://example.com/feed?token=b', await feed())
    expect(a.feed_id).not.toBe(b.feed_id)
    const [ea] = await repo.entries(1, null, null, 20)
    await expect(repo.entry(2, ea.id)).rejects.toMatchObject({ code: 'not_found' })
  })
  test('one disabled user does not stop another active subscriber', async () => {
    const a = await add(1, 'https://example.com/feed', await feed())
    await add(2, 'https://example.com/feed', await feed())
    await due(a.id)
    await db.query('UPDATE sr_user_lab_feature SET enabled=false WHERE user_id=1')
    const claimed = await repo.claimDue()
    expect(claimed).toHaveLength(1)
    expect(await repo.finish(claimed[0], { unchanged: true })).toBe(true)
    await db.query('UPDATE sr_user_lab_feature SET enabled=false')
    await due(a.id)
    expect(await repo.claimDue()).toEqual([])
  })
  test('Labs invalidates the shared lease only when the last active subscriber disables RSS', async () => {
    const a = await add(1, 'https://example.com/feed', await feed())
    await add(2, 'https://example.com/feed', await feed())
    await due(a.id)
    const claim = await repo.claim(1, a.id)
    const labs = new LabRepo(() => adapter(db))
    await labs.upsert(1, 'rss', false)
    expect((await repo.subscriptions(2))[0].lease_token).toBe(claim.lease_token)
    await labs.upsert(2, 'rss', false)
    expect((await repo.subscriptions(2))[0].lease_token).toBeNull()
    await labs.upsert(2, 'rss', true)
    expect(await repo.finish(claim, { unchanged: true })).toBe(false)
  })
  test('deleted users lose shared cache access while remaining subscribers retain it', async () => {
    await add(1, 'https://example.com/feed', await feed())
    await add(2, 'https://example.com/feed', await feed())
    const [entry] = await repo.entries(1, null, null, 20)
    await db.query('UPDATE sr_user SET deleted_at=now() WHERE id=1')
    expect(await repo.subscriptions(1)).toEqual([])
    expect(await repo.entries(1, null, null, 20)).toEqual([])
    await expect(repo.entry(1, entry.id)).rejects.toMatchObject({ code: 'not_found' })
    expect((await repo.entry(2, entry.id)).id).toBe(entry.id)
  })
  test('article retention is bounded once per shared feed', async () => {
    const many = await feed(Array.from({ length: 205 }, (_, i) => '<item><guid>' + i + '</guid><title>' + i + '</title></item>').join(''))
    await add(1, 'https://example.com/feed', many)
    await add(2, 'https://example.com/feed', many)
    expect((await db.query('SELECT * FROM sr_rss_entry')).rows).toHaveLength(200)
    expect(await repo.entries(1, null, null, 250)).toHaveLength(200)
    expect(await repo.entries(2, null, null, 250)).toHaveLength(200)
  })
  test('expired leases cannot publish or erase a newer cache', async () => {
    const a = await add(1, 'https://example.com/feed', await feed())
    await due(a.id)
    const claim = await repo.claim(1, a.id)
    const [entry] = await repo.entries(1, null, null, 20)
    await db.query("UPDATE sr_rss_feed SET lease_until=now()-interval '1 second'")
    expect(await repo.finish(claim, stored(await feed()))).toBe(false)
    expect((await repo.entry(1, entry.id)).content_key).toBe(entry.content_key)
  })
  test('GC retains referenced objects and objects of a feed with an active lease', async () => {
    const a = await add(1, 'https://example.com/feed', await feed())
    const [entry] = await repo.entries(1, null, null, 20)
    const orphan = 'rss-content/' + a.feed_id + '/orphan'
    expect(await repo.referencedContent([entry.content_key!, orphan])).toEqual([entry.content_key])
    await due(a.id)
    const claim = await repo.claim(1, a.id)
    expect(await repo.referencedContent([orphan])).toEqual([orphan])
    await repo.finish(claim, { unchanged: true })
    expect(await repo.referencedContent([orphan])).toEqual([])
  })
  test('unsubscribed feeds and stale entries are pruned, saved bookmarks survive', async () => {
    const a = await add(1, 'https://example.com/feed', await feed())
    const [entry] = await repo.entries(1, null, null, 20)
    await repo.save(1, entry.id, entry.article_url!)
    await due(a.id)
    const claim = await repo.claim(1, a.id)
    await repo.remove(1, a.id)
    expect(await repo.finish(claim, stored(await feed()))).toBe(false)
    await db.query("UPDATE sr_rss_feed SET created_at=now()-interval '2 hours'")
    await repo.prune()
    expect((await db.query('SELECT * FROM sr_rss_feed')).rows).toEqual([])
    expect((await db.query('SELECT * FROM sr_rss_entry')).rows).toEqual([])
    expect((await db.query('SELECT * FROM sr_user_bookmark')).rows).toHaveLength(1)
  })
})
