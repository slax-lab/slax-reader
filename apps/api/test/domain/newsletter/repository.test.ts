import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { LabRepo } from '@/infra/repository/dbLab'
import { NewsletterRepo } from '@/infra/repository/dbNewsletter'

let db: PGlite
let repo: NewsletterRepo
const adapter = (db: any): any => {
  const query = async (parts: TemplateStringsArray, ...values: unknown[]) =>
    (
      await db.query(
        parts.reduce((sql, s, i) => sql + (i ? '$' + i : '') + s, ''),
        values
      )
    ).rows
  return {
    sr_user_lab_feature: {
      upsert: async ({ create }: any) =>
        (
          await db.query(
            'INSERT INTO sr_user_lab_feature(user_id,feature,enabled) VALUES($1,$2,$3) ON CONFLICT(user_id,feature) DO UPDATE SET enabled=EXCLUDED.enabled RETURNING *',
            [create.user_id, create.feature, create.enabled]
          )
        ).rows[0]
    },
    sr_user: { update: ({ where, data }: any) => db.query('UPDATE sr_user SET deleted_at=$1 WHERE id=$2', [data.deleted_at, where.id]) },
    sr_user_api_key: { deleteMany: async () => ({ count: 0 }) },
    $queryRaw: query,
    $executeRaw: query,
    $transaction: (fn: any) => db.transaction((tx: any) => fn(adapter(tx)))
  }
}
beforeAll(async () => {
  db = new PGlite({ parsers: { 1114: x => new Date(x.replace(' ', 'T') + 'Z') } })
  await db.exec(`CREATE TABLE sr_user(id INT PRIMARY KEY, uuid TEXT DEFAULT gen_random_uuid()::text, account TEXT DEFAULT '', deleted_at TIMESTAMP);
    CREATE TABLE sr_user_lab_feature(user_id INT,feature TEXT,enabled BOOLEAN,UNIQUE(user_id,feature));`)
  for (const path of [
    '20260923042657_reset_rss_labs_shared_feed',
    '20260923044137_add_rss_timeline_index',
    '20260923065020',
    '20261019090000_rss_local_first',
    '20261022090000_newsletter_feed'
  ])
    await db.exec(await readFile(new URL('../../../prisma/pg_migrations/' + path + '/migration.sql', import.meta.url), 'utf8'))
  repo = new NewsletterRepo(() => adapter(db))
})
beforeEach(async () => {
  await db.exec(`TRUNCATE sr_user,sr_user_lab_feature,sr_newsletter_address,sr_newsletter_receipt,sr_rss_entry,sr_rss_feed,sr_rss_subscription;
    INSERT INTO sr_user(id,account) VALUES(1,'Jane.Doe'),(2,'other');
    INSERT INTO sr_user_lab_feature VALUES(1,'newsletter',true),(2,'newsletter',true);`)
})
afterAll(async () => {
  await db?.close()
})
const recipient = async () => {
  await repo.address(1, 'slax.dev', true)
  return (await repo.recipient('slax.dev', 'jane.doe'))!
}
const reserve = async (source = 'source', message = 'message', key = 'newsletter-raw/test') => repo.admit(await recipient(), source, message, key)
describe('Newsletter PostgreSQL boundaries', () => {
  test('GET is pure, provision is canonical and idempotent, and rename preserves address', async () => {
    expect(await repo.address(1, 'slax.dev', false)).toMatchObject({ status: 'not_provisioned', address: null })
    const first = await repo.address(1, 'slax.dev', true)
    expect(first).toMatchObject({ status: 'ready', address: 'jane.doe@slax.dev' })
    await db.query('UPDATE sr_user SET account=$1 WHERE id=1', ['你好'])
    expect(await repo.address(1, 'slax.dev', true)).toEqual(first)
  })
  test('retired addresses never transfer and full domain controls ownership', async () => {
    await recipient()
    await db.exec("UPDATE sr_newsletter_address SET retired_at=now() WHERE user_id=1; UPDATE sr_user SET account='JANE.DOE' WHERE id=2")
    await expect(repo.address(2, 'slax.dev', true)).rejects.toMatchObject({ code: 'address_reserved' })
    expect(await repo.recipient('slax.com', 'jane.doe')).toBeNull()
    expect(await repo.recipient('slax.dev', 'jane.doe')).toBeNull()
  })
  test('missing account and disabled/deleted users cannot provision or receive', async () => {
    await db.exec("UPDATE sr_user SET account='' WHERE id=1")
    expect(await repo.address(1, 'slax.dev', false)).toMatchObject({ status: 'account_required' })
    await expect(repo.address(1, 'slax.dev', true)).rejects.toMatchObject({ code: 'account_required' })
    await db.exec('UPDATE sr_user_lab_feature SET enabled=false WHERE user_id=1')
    await expect(repo.address(1, 'slax.dev', true)).rejects.toMatchObject({ code: 'lab_disabled' })
    await db.exec('UPDATE sr_user SET deleted_at=now() WHERE id=2')
    await expect(repo.address(2, 'slax.dev', true)).rejects.toMatchObject({ code: 'not_found' })
  })
  test('duplicates reserve once, lease tokens fence publication, and publication is immutable', async () => {
    const first = await reserve()
    expect((await reserve()).receipt.id).toBe(first.receipt.id)
    expect((await db.query('SELECT * FROM sr_newsletter_receipt')).rows).toHaveLength(1)
    const [claimed] = await repo.claim(first.receipt.id)
    const item = { sourceTitle: 'Sender', title: 'One', summary: 'body', publishedAt: null, contentKey: 'rss-content/test/revision', truncated: false }
    expect(await repo.complete({ ...claimed, lease_token: 'wrong' }, item)).toBe(false)
    expect(await repo.complete(claimed, item)).toBe(true)
    expect(await repo.complete(claimed, { ...item, title: 'Changed' })).toBe(false)
    expect((await db.query('SELECT title FROM sr_rss_entry')).rows).toEqual([{ title: 'One' }])
    expect((await db.query('SELECT kind,feed_url FROM sr_rss_feed')).rows).toEqual([{ kind: 'newsletter', feed_url: 'newsletter:source' }])
  })
  test('post-admission failure remains pending and can be recovered', async () => {
    const first = await reserve()
    const [claim] = await repo.claim(first.receipt.id)
    await repo.defer(claim)
    expect(await repo.claim(first.receipt.id)).toHaveLength(0)
    await db.exec("UPDATE sr_newsletter_receipt SET retry_at=now()-interval '1 minute'")
    const [retry] = await repo.claim(first.receipt.id)
    expect(retry.lease_token).not.toBe(claim.lease_token)
    expect(
      await repo.complete(retry, { sourceTitle: 'Sender', title: 'Recovered', summary: 'body', publishedAt: null, contentKey: 'rss-content/recovered', truncated: true })
    ).toBe(true)
  })
  test('disable after admission fences commit and ownership is checked again', async () => {
    const first = await reserve()
    const [claim] = await repo.claim(first.receipt.id)
    await db.exec('UPDATE sr_user_lab_feature SET enabled=false WHERE user_id=1')
    await expect(
      repo.complete(claim, { sourceTitle: 'Sender', title: 'Late', summary: '', publishedAt: null, contentKey: 'rss-content/late', truncated: false })
    ).rejects.toMatchObject({ code: 'lab_disabled' })
    expect((await db.query('SELECT * FROM sr_rss_entry')).rows).toHaveLength(0)
  })
  test('daily and source limits count pending obligations, while duplicates consume no new slot', async () => {
    await reserve()
    const r = await recipient()
    await db.query(`INSERT INTO sr_newsletter_receipt(user_id,address_id,source_key,message_key,raw_key) SELECT 1,$1,'source','seed-'||i,'raw' FROM generate_series(1,199) i`, [
      r.id
    ])
    expect((await reserve()).created).toBe(false)
    await expect(reserve('source', 'new')).rejects.toMatchObject({ code: 'limit_reached' })
    await db.exec(
      "TRUNCATE sr_newsletter_receipt; INSERT INTO sr_rss_feed(id,feed_url,kind) SELECT 'f-'||i,'newsletter:s-'||i,'newsletter' FROM generate_series(1,200) i; INSERT INTO sr_rss_subscription(user_id,feed_id) SELECT 1,id FROM sr_rss_feed"
    )
    await expect(reserve()).rejects.toMatchObject({ code: 'limit_reached' })
  })
})

import { NewsletterService } from '@/domain/newsletter'
import { RssContent } from '@/domain/rss/content'
import { UserRepo } from '@/infra/repository/dbUser'
import { vi } from 'vitest'

const pipeline = () => {
  const objects = new Map<string, { bytes: Uint8Array; uploaded: Date }>()
  const bucket = {
    put: vi.fn(async (key: string, body: string | Uint8Array) => {
      objects.set(key, { bytes: typeof body === 'string' ? new TextEncoder().encode(body) : body, uploaded: new Date() })
      return { key }
    }),
    get: async (key: string) => {
      const o = objects.get(key)
      return o ? { arrayBuffer: async () => o.bytes.buffer, text: async () => new TextDecoder().decode(o.bytes) } : null
    },
    list: async ({ prefix }: any) => ({ objects: [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, o]) => ({ key, uploaded: o.uploaded })), truncated: false }),
    delete: async (keys: string[]) => {
      for (const key of keys) objects.delete(key)
    }
  }
  const client = { R2Bucket: bucket, putIfKeyExists: (key: string, body: string) => bucket.put(key, body) }
  const service = new NewsletterService(repo, new RssContent(() => client as never), () => client as never)
  const env = { NEWSLETTER_ENABLED: 'true', NEWSLETTER_DOMAIN: 'slax.dev' } as Env
  const message = (id = '<live@example.com>', to = 'jane.doe@slax.dev') => {
    const raw = new TextEncoder().encode(
      'From: Weekly <mail@example.com>\r\nTo: wrong@other.example\r\nSubject: Received\r\nMessage-ID: ' +
        id +
        '\r\nContent-Type: text/html\r\n\r\n<p>Safe</p><script>bad()</script><img src="cid:part">'
    )
    return {
      to,
      rawSize: raw.byteLength,
      raw: new ReadableStream({
        start(c) {
          c.enqueue(raw)
          c.close()
        }
      })
    } as ForwardableEmailMessage
  }
  return { objects, bucket, service, env, message }
}
describe('Newsletter service real database and object pipeline', () => {
  test('envelope delivery publishes sanitized private content and repeated Message-ID is a no-op', async () => {
    await recipient()
    const p = pipeline()
    await p.service.receive(p.message(), p.env)
    await p.service.receive(p.message(), p.env)
    const rows = (await db.query<any>('SELECT e.*,f.kind FROM sr_rss_entry e JOIN sr_rss_feed f ON f.id=e.feed_id')).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('newsletter')
    const html = new TextDecoder().decode(p.objects.get(rows[0].content_key)!.bytes)
    expect(html).toContain('Safe')
    expect(html).not.toMatch(/script|cid:/)
    expect((await db.query('SELECT state FROM sr_newsletter_receipt')).rows).toEqual([{ state: 'done' }])
    await expect(p.service.receive(p.message('<other>', 'jane.doe@other.example'), p.env)).rejects.toMatchObject({ code: 'not_found' })
    await expect(p.service.receive(p.message(), { ...p.env, NEWSLETTER_ENABLED: 'false' })).rejects.toMatchObject({ code: 'not_found' })
  })
  test('accepted raw receipt recovers after body write failure, and unpersisted raw never creates a receipt', async () => {
    await recipient()
    const p = pipeline(),
      write = p.bucket.put.getMockImplementation()!
    p.bucket.put.mockImplementation(async (key, body) => {
      if (key.startsWith('rss-content/')) throw new Error('body store failure')
      return write(key, body)
    })
    await p.service.receive(p.message(), p.env)
    expect((await db.query('SELECT state FROM sr_newsletter_receipt')).rows).toEqual([{ state: 'pending' }])
    expect((await db.query('SELECT * FROM sr_rss_entry')).rows).toHaveLength(0)
    p.bucket.put.mockImplementation(write)
    await db.exec("UPDATE sr_newsletter_receipt SET retry_at=now()-interval '1 minute'")
    await p.service.tick({ env: p.env } as any)
    expect((await db.query('SELECT state FROM sr_newsletter_receipt')).rows).toEqual([{ state: 'done' }])
    p.bucket.put.mockRejectedValue(new Error('raw store failure'))
    await expect(p.service.receive(p.message('<raw-fail>'), p.env)).rejects.toThrow('raw store failure')
    expect((await db.query('SELECT * FROM sr_newsletter_receipt')).rows).toHaveLength(1)
  })
  test('raw sweep protects pending obligations and removes old unreferenced mail', async () => {
    const p = pipeline()
    await reserve('source', 'mail', 'newsletter-raw/pending')
    for (const key of ['newsletter-raw/pending', 'newsletter-raw/orphan']) p.objects.set(key, { bytes: new Uint8Array(), uploaded: new Date(0) })
    await db.exec("UPDATE sr_newsletter_receipt SET retry_at=now()+interval '1 day'")
    await p.service.tick({ env: p.env } as any)
    expect(p.objects.has('newsletter-raw/pending')).toBe(true)
    expect(p.objects.has('newsletter-raw/orphan')).toBe(false)
  })
  test('account-setting availability uses case-insensitive locking and does not change an issued address', async () => {
    await recipient()
    const users = new UserRepo(
      () => ({}) as any,
      () => adapter(db)
    )
    expect((await users.updateUserName(1, 'Fresh')).account).toBe('fresh')
    await expect(users.updateUserName(2, 'FRESH')).rejects.toMatchObject({ name: 'EXISTS_USER_NAME_ERROR' })
    await expect(users.updateUserName(1, 'bad+name')).rejects.toMatchObject({ name: 'ERROR_PARAM' })
    expect((await repo.address(1, 'slax.dev', false)).address).toBe('jane.doe@slax.dev')
  })
})

test('account deletion retires its address immediately and cancels admitted work in the same transaction', async () => {
  await reserve()
  const users = new UserRepo(
    () => ({}) as any,
    () => adapter(db)
  )
  await users.markUserAsDeleted(1)
  expect((await db.query<any>('SELECT retired_at FROM sr_newsletter_address')).rows[0].retired_at).not.toBeNull()
  expect((await db.query('SELECT state FROM sr_newsletter_receipt')).rows).toEqual([{ state: 'cancelled' }])
  await db.exec('UPDATE sr_user SET deleted_at=NULL WHERE id=1')
  expect(await repo.recipient('slax.dev', 'jane.doe')).toBeNull()
})

test('over-quota admission does not perform expensive raw object writes', async () => {
  const r = await recipient(),
    p = pipeline()
  await db.query(`INSERT INTO sr_newsletter_receipt(user_id,address_id,source_key,message_key,raw_key) SELECT 1,$1,'source','seed-'||i,'raw' FROM generate_series(1,200) i`, [r.id])
  await expect(p.service.receive(p.message(), p.env)).rejects.toMatchObject({ code: 'limit_reached' })
  expect(p.bucket.put).not.toHaveBeenCalled()
})

test('disable then re-enable cannot resurrect a pending delivery or its lease', async () => {
  const first = await reserve(),
    [claim] = await repo.claim(first.receipt.id)
  const labs = new LabRepo(() => adapter(db))
  await labs.upsert(1, 'newsletter', false)
  await labs.upsert(1, 'newsletter', true)
  expect(await repo.complete(claim, { sourceTitle: 'Sender', title: 'Late', summary: '', publishedAt: null, contentKey: 'rss-content/late', truncated: false })).toBe(false)
  expect((await db.query('SELECT state FROM sr_newsletter_receipt')).rows).toEqual([{ state: 'cancelled' }])
})
