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
    sr_user: {
      update: ({ where, data }: any) => db.query('UPDATE sr_user SET deleted_at=$1 WHERE id=$2', [data.deleted_at, where.id])
    },
    sr_user_api_key: { deleteMany: async () => ({ count: 0 }) },
    $queryRaw: query,
    $executeRaw: query,
    $transaction: (fn: any) => db.transaction((tx: any) => fn(adapter(tx)))
  }
}
beforeAll(async () => {
  db = new PGlite({
    parsers: { 1114: x => new Date(x.replace(' ', 'T') + 'Z') }
  })
  await db.exec(`CREATE TABLE sr_user(id INT PRIMARY KEY, uuid TEXT DEFAULT gen_random_uuid()::text, account TEXT DEFAULT '', deleted_at TIMESTAMP);
    CREATE TABLE sr_user_lab_feature(user_id INT,feature TEXT,enabled BOOLEAN,UNIQUE(user_id,feature));
    CREATE TABLE sr_platform_bind(id SERIAL PRIMARY KEY,uuid TEXT UNIQUE DEFAULT gen_random_uuid()::text,user_id INT,platform TEXT,platform_id TEXT,user_name TEXT,created_at TIMESTAMP DEFAULT now(),UNIQUE(user_id,platform));`)
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
  await db.exec(`TRUNCATE sr_user,sr_user_lab_feature,sr_platform_bind,sr_newsletter_receipt,sr_rss_entry,sr_rss_feed,sr_feed,sr_rss_subscription;
    INSERT INTO sr_user(id,account) VALUES(1,'Jane.Doe'),(2,'other');
    INSERT INTO sr_user_lab_feature VALUES(1,'newsletter',true),(2,'newsletter',true);`)
})
afterAll(async () => {
  await db?.close()
})
const recipient = async () => {
  await repo.address(1, 'newsletterreader.slax.dev', true)
  return (await repo.recipient('newsletterreader.slax.dev', 'jane.doe'))!
}
const reserve = async (source = 'source', message = 'message') => repo.admit(await recipient(), source, message)
describe('Newsletter PostgreSQL boundaries', () => {
  test('GET is pure, provision is canonical and idempotent, and rename preserves address', async () => {
    expect(await repo.address(1, 'newsletterreader.slax.dev', false)).toMatchObject({
      status: 'not_provisioned',
      address: null
    })
    const first = await repo.address(1, 'newsletterreader.slax.dev', true)
    expect(first).toMatchObject({
      status: 'ready',
      address: 'feed+jane.doe@newsletterreader.slax.dev'
    })
    await db.query('UPDATE sr_user SET account=$1 WHERE id=1', ['你好'])
    expect(await repo.address(1, 'newsletterreader.slax.dev', true)).toEqual(first)
  })
  test('retired addresses never transfer and full domain controls ownership', async () => {
    await recipient()
    await db.exec("UPDATE sr_platform_bind SET retired_at=now() WHERE user_id=1 AND platform='newsletter'; UPDATE sr_user SET account='JANE.DOE' WHERE id=2")
    await expect(repo.address(2, 'newsletterreader.slax.dev', true)).rejects.toMatchObject({
      code: 'address_reserved'
    })
    expect(await repo.recipient('slax.com', 'jane.doe')).toBeNull()
    expect(await repo.recipient('newsletterreader.slax.dev', 'jane.doe')).toBeNull()
  })
  test('a Newsletter binding is immutable across domain changes and distinct from business mail', async () => {
    await db.exec("UPDATE sr_user SET account='DaGuAnG' WHERE id=1")
    expect(await repo.address(1, 'newsletterreader.slax.dev', true)).toMatchObject({ address: 'feed+daguang@newsletterreader.slax.dev', status: 'ready' })
    expect(await repo.recipient('newsletterreader.slax.dev', 'daguang')).toMatchObject({ user_id: 1 })
    await expect(repo.address(1, 'newsletterreader.slax.com', true)).rejects.toMatchObject({ code: 'unavailable' })
    expect((await db.query("SELECT platform_id FROM sr_platform_bind WHERE platform='newsletter'")).rows).toEqual([{ platform_id: 'feed+daguang@newsletterreader.slax.dev' }])
  })
  test('an issued platform binding renders its original token after a rename', async () => {
    await repo.address(1, 'newsletterreader.slax.com', true)
    await db.exec("UPDATE sr_user SET account='daguang' WHERE id=1")
    for (const provision of [false, true])
      expect(await repo.address(1, 'newsletterreader.slax.com', provision)).toMatchObject({ address: 'feed+jane.doe@newsletterreader.slax.com', status: 'ready' })
  })
  test('the fixed prefix fits the SMTP local-part limit without silently truncating accounts', async () => {
    await db.query('UPDATE sr_user SET account=$1 WHERE id=1', ['a'.repeat(59)])
    const issued = await repo.address(1, 'newsletterreader.slax.dev', true)
    expect(issued.address).toBe('feed+' + 'a'.repeat(59) + '@newsletterreader.slax.dev')
    await db.query('UPDATE sr_user SET account=$1 WHERE id=2', ['b'.repeat(60)])
    expect(await repo.address(2, 'newsletterreader.slax.dev', false)).toMatchObject({ address: null, status: 'invalid_account' })
    await expect(repo.address(2, 'newsletterreader.slax.dev', true)).rejects.toMatchObject({ code: 'invalid_account' })
    expect((await db.query("SELECT user_id FROM sr_platform_bind WHERE platform='newsletter'")).rows).toEqual([{ user_id: 1 }])
  })
  test('missing account and disabled/deleted users cannot provision or receive', async () => {
    await db.exec("UPDATE sr_user SET account='' WHERE id=1")
    expect(await repo.address(1, 'newsletterreader.slax.dev', false)).toMatchObject({
      status: 'account_required'
    })
    await expect(repo.address(1, 'newsletterreader.slax.dev', true)).rejects.toMatchObject({
      code: 'account_required'
    })
    await db.exec('UPDATE sr_user_lab_feature SET enabled=false WHERE user_id=1')
    await expect(repo.address(1, 'newsletterreader.slax.dev', true)).rejects.toMatchObject({
      code: 'lab_disabled'
    })
    await db.exec('UPDATE sr_user SET deleted_at=now() WHERE id=2')
    await expect(repo.address(2, 'newsletterreader.slax.dev', true)).rejects.toMatchObject({
      code: 'not_found'
    })
  })
  test('duplicates reserve once, lease tokens fence publication, and publication is immutable', async () => {
    const first = await reserve()
    expect((await reserve()).receipt.id).toBe(first.receipt.id)
    expect((await db.query('SELECT * FROM sr_newsletter_receipt')).rows).toHaveLength(1)
    const [claimed] = await repo.claim(first.receipt.id)
    const item = {
      sourceTitle: 'Sender',
      title: 'One',
      summary: 'body',
      publishedAt: null,
      contentKey: 'rss-content/test/revision',
      truncated: false
    }
    expect(await repo.complete({ ...claimed, lease_token: 'wrong' }, item)).toBe(false)
    expect(await repo.complete(claimed, item)).toBe(true)
    expect(await repo.complete(claimed, { ...item, title: 'Changed' })).toBe(false)
    expect((await db.query('SELECT title FROM sr_rss_entry')).rows).toEqual([{ title: 'One' }])
    expect((await db.query('SELECT kind,feed_url FROM sr_feed')).rows).toEqual([{ kind: 'newsletter', feed_url: 'newsletter:source' }])
  })
  test('a failed attempt releases its lease so actual redelivery can publish', async () => {
    const first = await reserve()
    const [claim] = await repo.claim(first.receipt.id)
    await repo.release(claim)
    const [retry] = await repo.claim(first.receipt.id)
    expect(retry.lease_token).not.toBe(claim.lease_token)
    expect(
      await repo.complete(retry, {
        sourceTitle: 'Sender',
        title: 'Recovered',
        summary: 'body',
        publishedAt: null,
        contentKey: 'rss-content/recovered',
        truncated: true
      })
    ).toBe(true)
  })
  test('disable after admission fences commit and ownership is checked again', async () => {
    const first = await reserve()
    const [claim] = await repo.claim(first.receipt.id)
    await db.exec('UPDATE sr_user_lab_feature SET enabled=false WHERE user_id=1')
    await expect(
      repo.complete(claim, {
        sourceTitle: 'Sender',
        title: 'Late',
        summary: '',
        publishedAt: null,
        contentKey: 'rss-content/late',
        truncated: false
      })
    ).rejects.toMatchObject({ code: 'lab_disabled' })
    expect((await db.query('SELECT * FROM sr_rss_entry')).rows).toHaveLength(0)
  })
  test('daily and source limits count pending obligations, while duplicates consume no new slot', async () => {
    await reserve()
    const r = await recipient()
    await db.query(`INSERT INTO sr_newsletter_receipt(user_id,binding_id,source_key,message_key) SELECT 1,$1,'source','seed-'||i FROM generate_series(1,199) i`, [r.id])
    expect((await reserve()).created).toBe(false)
    await expect(reserve('source', 'new')).rejects.toMatchObject({
      code: 'limit_reached'
    })
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
      objects.set(key, {
        bytes: typeof body === 'string' ? new TextEncoder().encode(body) : body,
        uploaded: new Date()
      })
      return { key }
    }),
    get: async (key: string) => {
      const o = objects.get(key)
      return o
        ? {
            arrayBuffer: async () => o.bytes.buffer,
            text: async () => new TextDecoder().decode(o.bytes)
          }
        : null
    },
    list: async ({ prefix }: any) => ({
      objects: [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, o]) => ({ key, uploaded: o.uploaded })),
      truncated: false
    }),
    delete: async (keys: string[]) => {
      for (const key of keys) objects.delete(key)
    }
  }
  const client = {
    R2Bucket: bucket,
    putIfKeyExists: (key: string, body: string) => bucket.put(key, body)
  }
  const service = new NewsletterService(repo, new RssContent(() => client as never))
  const env = {
    NEWSLETTER_DOMAIN: 'newsletterreader.slax.dev'
  } as Env
  const message = (id = '<live@example.com>', to = 'feed+jane.doe@newsletterreader.slax.dev') => {
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
  test('bare, wrong-prefix, multi-detail and foreign envelopes cannot write objects or receipts', async () => {
    await recipient()
    const p = pipeline()
    for (const to of [
      'feed@newsletterreader.slax.dev',
      'feed+@newsletterreader.slax.dev',
      'jane.doe@newsletterreader.slax.dev',
      'r+jane.doe@newsletterreader.slax.dev',
      'feed+jane.doe+extra@newsletterreader.slax.dev',
      'feed+unknown@newsletterreader.slax.dev',
      'feed+jane.doe@newsletterreader.slax.com',
      'feed+jane.doe@newsletterreader.slax.dev.attacker.test',
      'daguang@slax.app',
      'feed+jane.doe@slax.dev',
      'feed%2Bjane.doe@newsletterreader.slax.dev',
      'feed+ jane.doe@newsletterreader.slax.dev'
    ])
      await expect(p.service.receive(p.message('<rejected>', to), p.env)).rejects.toMatchObject({ code: 'not_found' })
    expect(p.objects.size).toBe(0)
    expect((await db.query('SELECT * FROM sr_newsletter_receipt')).rows).toHaveLength(0)
    expect((await db.query('SELECT * FROM sr_rss_entry')).rows).toHaveLength(0)
  })
  test('mixed-case prefixed envelope resolves the bound token independently of header To', async () => {
    await recipient()
    const p = pipeline()
    await p.service.receive(p.message('<case>', 'FeEd+JaNe.DoE@NEWSLETTERREADER.SLAX.DEV'), p.env)
    expect((await db.query('SELECT user_id,state FROM sr_newsletter_receipt')).rows).toEqual([{ user_id: 1, state: 'done' }])
  })
  test('envelope delivery publishes sanitized private content and repeated Message-ID is a no-op', async () => {
    await recipient()
    const p = pipeline()
    await p.service.receive(p.message(), p.env)
    await p.service.receive(p.message(), p.env)
    const rows = (await db.query<any>('SELECT e.*,f.kind FROM sr_rss_entry e JOIN sr_feed f ON f.id=e.feed_id')).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('newsletter')
    const html = new TextDecoder().decode(p.objects.get(rows[0].content_key)!.bytes)
    expect(html).toContain('Safe')
    expect(html).not.toMatch(/script|cid:/)
    expect((await db.query('SELECT state FROM sr_newsletter_receipt')).rows).toEqual([{ state: 'done' }])
    await expect(p.service.receive(p.message('<other>', 'jane.doe@other.example'), p.env)).rejects.toMatchObject({ code: 'not_found' })
    await expect(p.service.receive(p.message(), { ...p.env, NEWSLETTER_DOMAIN: '' })).rejects.toMatchObject({ code: 'not_found' })
  })
  test('account-setting availability uses case-insensitive locking and does not change an issued address', async () => {
    await recipient()
    const users = new UserRepo(
      () => ({}) as any,
      () => adapter(db)
    )
    expect((await users.updateUserName(1, 'Fresh')).account).toBe('fresh')
    await expect(users.updateUserName(2, 'FRESH')).rejects.toMatchObject({
      name: 'EXISTS_USER_NAME_ERROR'
    })
    await expect(users.updateUserName(1, 'bad+name')).rejects.toMatchObject({
      name: 'ERROR_PARAM'
    })
    expect((await repo.address(1, 'newsletterreader.slax.dev', false)).address).toBe('feed+jane.doe@newsletterreader.slax.dev')
  })
})

test('account deletion retires its address immediately and cancels admitted work in the same transaction', async () => {
  await reserve()
  const users = new UserRepo(
    () => ({}) as any,
    () => adapter(db)
  )
  await users.markUserAsDeleted(1)
  expect((await db.query<any>("SELECT retired_at FROM sr_platform_bind WHERE platform='newsletter'")).rows[0].retired_at).not.toBeNull()
  expect((await db.query('SELECT state FROM sr_newsletter_receipt')).rows).toEqual([{ state: 'cancelled' }])
  await db.exec('UPDATE sr_user SET deleted_at=NULL WHERE id=1')
  expect(await repo.recipient('newsletterreader.slax.dev', 'jane.doe')).toBeNull()
})

test('over-quota admission does not perform expensive raw object writes', async () => {
  const r = await recipient(),
    p = pipeline()
  await db.query(`INSERT INTO sr_newsletter_receipt(user_id,binding_id,source_key,message_key) SELECT 1,$1,'source','seed-'||i FROM generate_series(1,200) i`, [r.id])
  await expect(p.service.receive(p.message(), p.env)).rejects.toMatchObject({
    code: 'limit_reached'
  })
  expect(p.bucket.put).not.toHaveBeenCalled()
})

test('disable then re-enable cannot resurrect a pending delivery or its lease', async () => {
  const first = await reserve(),
    [claim] = await repo.claim(first.receipt.id)
  const labs = new LabRepo(() => adapter(db))
  await labs.upsert(1, 'newsletter', false)
  await labs.upsert(1, 'newsletter', true)
  expect(
    await repo.complete(claim, {
      sourceTitle: 'Sender',
      title: 'Late',
      summary: '',
      publishedAt: null,
      contentKey: 'rss-content/late',
      truncated: false
    })
  ).toBe(false)
  expect((await db.query('SELECT state FROM sr_newsletter_receipt')).rows).toEqual([{ state: 'cancelled' }])
})

test('new incoming MIME is not retained as raw mail and pending duplicates resume publication', async () => {
  await recipient()
  const p = pipeline()
  const write = p.bucket.put.getMockImplementation()!
  p.bucket.put.mockImplementation(async (key, body) => {
    if (key.startsWith('rss-content/')) throw new Error('temporary body failure')
    return write(key, body)
  })
  await expect(p.service.receive(p.message(), p.env)).rejects.toThrow()
  expect([...p.objects.keys()].some(key => key.startsWith('newsletter-raw/'))).toBe(false)
  expect(p.objects.size).toBe(0)
  p.bucket.put.mockImplementation(write)
  await p.service.receive(p.message(), p.env)
  expect((await db.query('SELECT state FROM sr_newsletter_receipt')).rows).toEqual([{ state: 'done' }])
  expect((await db.query('SELECT id FROM sr_rss_entry')).rows).toHaveLength(1)
})

test('settings enable provisions once and keeps missing/reserved accounts repairable', async () => {
  const { UserController } = await import('@/handler/http/userController')
  const p = pipeline()
  const labs = new LabRepo(() => adapter(db))
  const user = {
    enableUserSetting: async (_ctx: unknown, _key: string, enabled: boolean) => {
      await labs.upsert(1, 'newsletter', enabled)
      return 'ok'
    }
  }
  const controller = new UserController(user as never, null as never, null as never, null as never, null as never, null as never, null as never, p.service)
  const ctx = { getUserId: () => 1, env: p.env } as any
  const enable = () =>
    controller.handleEnableUserSettingRequest(
      ctx,
      new Request('http://localhost/v1/user/setting/enable', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'lab:newsletter' }) })
    )
  await db.exec("UPDATE sr_user SET account='' WHERE id=1")
  expect((await enable()).status).toBe(200)
  expect(await p.service.address(ctx, false)).toMatchObject({ status: 'account_required' })
  await db.exec("UPDATE sr_user SET account='other' WHERE id=1")
  await repo.address(2, 'newsletterreader.slax.dev', true)
  expect((await enable()).status).toBe(200)
  expect(await p.service.address(ctx, false)).toMatchObject({ status: 'address_reserved' })
  await db.exec("UPDATE sr_user SET account='fixed' WHERE id=1")
  expect((await enable()).status).toBe(200)
  expect((await enable()).status).toBe(200)
  expect(await p.service.address(ctx, false)).toMatchObject({ status: 'ready', address: 'feed+fixed@newsletterreader.slax.dev' })
  const response = await controller.newsletterAddress(ctx, new Request('http://localhost/v1/user/newsletter_address'))
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect((await db.query("SELECT id FROM sr_platform_bind WHERE user_id=1 AND platform='newsletter'")).rows).toHaveLength(1)
})

test('successful synchronous delivery stores only final Feed content, without a recovery payload', async () => {
  await recipient()
  const p = pipeline()
  await p.service.receive(p.message('<without-staging>'), p.env)
  expect(p.objects.size).toBe(1)
  expect([...p.objects.keys()].every(key => key.startsWith('rss-content/'))).toBe(true)
})

test('failed synchronous delivery stores no recovery payload and succeeds only on a fresh delivery', async () => {
  await recipient()
  const p = pipeline(),
    write = p.bucket.put.getMockImplementation()!
  p.bucket.put.mockImplementation(async (key, body) => {
    if (key.startsWith('rss-content/')) throw new Error('temporary body failure')
    return write(key, body)
  })
  await expect(p.service.receive(p.message('<redelivery-only>'), p.env)).rejects.toThrow('temporary body failure')
  expect(p.objects.size).toBe(0)
  expect((await db.query('SELECT state FROM sr_newsletter_receipt')).rows).toEqual([{ state: 'pending' }])
  expect((await db.query('SELECT id FROM sr_rss_entry')).rows).toHaveLength(0)
  p.bucket.put.mockImplementation(write)
  await p.service.receive(p.message('<redelivery-only>'), p.env)
  await p.service.receive(p.message('<redelivery-only>'), p.env)
  expect((await db.query('SELECT id FROM sr_rss_entry')).rows).toHaveLength(1)
  expect(p.objects.size).toBe(1)
})

test('only actual redelivery can take over an expired lease and the old event cannot publish', async () => {
  const first = await reserve(),
    [initial] = await repo.claim(first.receipt.id)
  expect(await repo.claim(first.receipt.id)).toHaveLength(0)
  await db.exec("UPDATE sr_newsletter_receipt SET lease_until=now()-interval '1 second'")
  const [next] = await repo.claim(first.receipt.id)
  expect(next.lease_token).not.toBe(initial.lease_token)
  const item = { sourceTitle: 'Sender', title: 'New delivery', summary: 'body', publishedAt: null, contentKey: 'rss-content/new-delivery', truncated: false }
  expect(await repo.complete(initial, item)).toBe(false)
  expect(await repo.complete(next, item)).toBe(true)
  expect((await db.query('SELECT id FROM sr_rss_entry')).rows).toHaveLength(1)
})
