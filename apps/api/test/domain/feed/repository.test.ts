import orderFixture from '../../../../../packages/contracts/test-fixtures/feed-order.json'
import { test, expect } from 'vitest'
import { db, adapter } from '../newsletter/fixture'
import { FeedRepo } from '@/infra/repository/dbFeed'
const rss = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const setup = async () => {
  await db.exec(`CREATE TABLE IF NOT EXISTS sr_bookmark(id SERIAL PRIMARY KEY,target_url TEXT,private_user INT,status TEXT); CREATE TABLE IF NOT EXISTS sr_user_bookmark(uuid TEXT,bookmark_id INT,user_id INT,deleted_at TIMESTAMP); TRUNCATE sr_bookmark,sr_user_bookmark;
 INSERT INTO sr_user_lab_feature VALUES(1,'rss',true);INSERT INTO sr_rss_feed(id,feed_url,title) VALUES('${rss}','https://rss.example','RSS');INSERT INTO sr_rss_subscription(id,user_id,feed_id) VALUES('${sub}',1,'${rss}');
 INSERT INTO sr_rss_entry(id,feed_id,entry_key,title,summary,content_key,sort_at) VALUES('${rss}','${rss}','e','RSS','summary','rss-content/a','2026-10-01');
 INSERT INTO sr_newsletter_feed(id,user_id,source_key,sender,message_key,state,title,content_key,received_at) VALUES(9,1,repeat('a',64),'sender@example.com',repeat('a',64),'ready','Nine','newsletter-content/9','2026-10-01'),(10,1,repeat('a',64),'sender@example.com',repeat('b',64),'ready','Ten','newsletter-content/10','2026-10-01'),(11,2,repeat('b',64),'other@example.com',repeat('c',64),'ready','Foreign','newsletter-content/11','2026-10-01')`)
  return new FeedRepo(() => adapter(db))
}
test('one mixed keyset orders numeric mail IDs and tied RSS rows without duplicates or foreign data', async () => {
  const repo = await setup(),
    kinds = ['rss', 'newsletter'] as const
  const rows = await repo.entries(1, [...kinds], null, null, 2)
  expect(rows.map(r => r.id)).toEqual([rss, 'newsletter:10'])
  const next = await repo.entries(1, [...kinds], null, { at: rows[1].sort_at, kind: 'newsletter', id: 'newsletter:10' }, 2)
  expect(next.map(r => r.id)).toEqual(['newsletter:9'])
  expect((await repo.entries(1, ['newsletter'], `newsletter:${'a'.repeat(64)}`, null, 20)).map(r => r.title)).toEqual(['Ten', 'Nine'])
  expect((await repo.entries(1, ['rss'], null, null, 20)).map(r => r.id)).toEqual([rss])
  await expect(repo.entry(1, 'newsletter:11', ['newsletter'])).rejects.toMatchObject({ code: 'not_found' })
})
test('source groups contain only ready owned mail and no fake polling fields', async () => {
  const repo = await setup()
  expect(await repo.newsletterSources(1)).toEqual([{ id: `newsletter:${'a'.repeat(64)}`, kind: 'newsletter', title: 'sender@example.com', sender: 'sender@example.com' }])
  await db.exec("UPDATE sr_user_lab_feature SET enabled=false WHERE user_id=1 AND feature='newsletter'")
  expect(await repo.newsletterSources(1)).toEqual([])
  expect(await repo.entries(1, ['newsletter'], null, null, 20)).toEqual([])
})


test.each([1, 2])('shared ordering examples preserve keyset pagination at page size %s', async limit => {
  const repo = await setup()
  await db.exec('TRUNCATE sr_rss_entry,sr_newsletter_feed')
  for (const [i, row] of orderFixture.rows.entries()) {
    if (row.kind === 'rss') await db.query(`INSERT INTO sr_rss_entry(id,feed_id,entry_key,title,summary,content_key,sort_at,published_at) VALUES($1,$2,$1,$1,'','rss-content/a',$3,$4)`, [row.id, rss, row.sort_at, row.published_at])
    else await db.query(`INSERT INTO sr_newsletter_feed(id,user_id,source_key,sender,message_key,state,title,content_key,received_at,published_at) VALUES($1,1,$2,'sender@example.com',$3,'ready',$6,'newsletter-content/a',$4,$5)`, [row.id.slice(11), 'a'.repeat(64), i.toString(16).padStart(64, '0'), row.sort_at, row.published_at, row.id])
  }
  const ids: string[] = []
  let cursor: import('@/infra/repository/dbFeed').FeedCursor | null = null
  for (;;) {
    const rows = await repo.entries(1, ['rss', 'newsletter'], null, cursor, limit)
    if (!rows.length) break
    ids.push(...rows.map(row => row.id))
    const last = rows[rows.length - 1]
    cursor = { at: last.sort_at, id: last.id, kind: last.kind }
    expect(ids.length).toBeLessThanOrEqual(orderFixture.expected.length)
  }
  expect(ids).toEqual(orderFixture.expected)
})
