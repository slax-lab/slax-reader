import { beforeEach, test, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { db, adapter } from './fixture'
import { NewsletterSaveRepo } from '@/infra/repository/dbNewsletterSave'
import { NewsletterContent } from '@/domain/newsletterContent'
import { parseNewsletter } from '@/utils/newsletter'
import { NewsletterSaveService } from '@/domain/newsletterSave'
import { memoryBucket } from '../../utils/snapshotBucket'
import { readEmbeddedSnapshot } from '@/utils/snapshotBundle'
let indexing: ReturnType<typeof vi.fn>, service: NewsletterSaveService, repo: NewsletterSaveRepo, storage: ReturnType<typeof memoryBucket>
const ctx = { getUserId: () => 1, env: {}, execution: { waitUntil: vi.fn() }, hashIds: { encodeId: (id: number) => String(id) } } as any
beforeEach(async () => {
  const initial = readFileSync(new URL('../../../prisma/pg_migrations/20250911063331_init_database/migration.sql', import.meta.url), 'utf8')
  for (const name of ['sr_bookmark', 'sr_user_bookmark', 'sr_bookmark_share', 'sr_user_delete_bookmark', 'sr_user_bookmark_tag']) {
    await db.exec(`DROP TABLE IF EXISTS ${name} CASCADE`)
    await db.exec(initial.match(new RegExp('CREATE TABLE "public"\\."' + name + '" \\([\\s\\S]*?\\n\\);'))![0])
  }
  await db.exec(`CREATE UNIQUE INDEX ON sr_bookmark(target_url,private_user); CREATE UNIQUE INDEX ON sr_user_bookmark(user_id,bookmark_id);CREATE UNIQUE INDEX ON sr_bookmark_share(bookmark_id,user_id); ALTER TABLE sr_user_bookmark ADD archived_at TIMESTAMP; ALTER TABLE sr_user ADD COLUMN IF NOT EXISTS snapshot_sharing BOOLEAN DEFAULT true;
 INSERT INTO sr_newsletter_feed(id,user_id,source_key,sender,sender_name,message_key,state,title,summary,content_key) VALUES(1,1,repeat('a',64),'sender@example.com','Sender',repeat('b',64),'ready','Private subject','Summary','newsletter-content/original')`)
  storage = memoryBucket()
  const parsed = await parseNewsletter(
    new TextEncoder().encode(
      'From: Sender <sender@example.com>\r\nSubject: Private subject\r\nContent-Type: text/html\r\n\r\n<p>Private message for reader</p><section>Attachments: example.pdf (not stored)</section>'
    )
  )
  const stored = await new NewsletterContent(() => ({ R2Bucket: storage.bucket }) as never).store({} as Env, 'owner', 1n, parsed)
  await storage.bucket.put('newsletter-content/original', await (await storage.bucket.get(stored.key))!.text())
  await storage.bucket.delete(stored.key)
  const pg = () => adapter(db)
  repo = new NewsletterSaveRepo(pg)
  indexing = vi.fn(async () => [{ status: 'fulfilled', value: undefined }])
  const search = { addSearchRecord: indexing, clearSearchCache: vi.fn(async () => {}) }
  const searchRepo = { upsertUserBookmark: vi.fn(async () => {}) }
  const effects = { createBookmarkChangeLog: vi.fn(async () => {}) }
  service = new NewsletterSaveService(
    repo,
    () => ({ R2Bucket: storage.bucket }) as never,
    search as never,
    searchRepo as never,
    effects as never,
    { sendBookmarkChange: vi.fn(async () => {}) } as never
  )
})
test.each([true, false])('copies mail into an owned HTML/text snapshot and follows account sharing=%s', async defaultSharing => {
  await db.exec(`UPDATE sr_user SET snapshot_sharing=${defaultSharing} WHERE id=1`)
  const result = await service.save(ctx, 1n)
  expect(result).toMatchObject({ result: 'created', processing_status: 'ready' })
  const [row] = (
    await db.query<any>(
      'SELECT b.*,ub.uuid AS relation_uuid,s.is_enable FROM sr_bookmark b JOIN sr_user_bookmark ub ON ub.bookmark_id=b.id LEFT JOIN sr_bookmark_share s ON s.bookmark_id=b.id'
    )
  ).rows
  expect(row).toMatchObject({
    private_user: 1,
    status: 'success',
    target_url: 'slax-newsletter://message/1',
    title: 'Private subject',
    is_enable: null,
    relation_uuid: result.bookmark_user_uuid
  })
  expect((await db.query('SELECT snapshot_sharing FROM sr_user WHERE id=1')).rows).toEqual([{ snapshot_sharing: defaultSharing }])
  expect(row.content_key).toMatch(/^html\/body\//)
  expect(row.content_key).not.toBe('newsletter-content/original')
  const html = await (await storage.bucket.get(row.content_key))!.text()
  expect(indexing.mock.calls[0]).toEqual([ctx, row.id, 'Private subject', expect.stringContaining('Private message for reader')])
  expect(html).toContain('Private message')
  expect(readEmbeddedSnapshot(html)).toMatchObject({ managed: true, manifest: { schema: 1, kind: 'html' } })
  expect(await (await storage.bucket.get(row.content_md_key))!.text()).toContain('Private message')
  await storage.bucket.delete('newsletter-content/original')
  expect(await storage.bucket.get(row.content_key)).not.toBeNull()
})
test.each([true, false])('repeat and Trash restore preserve identity, annotations and deliberate sharing=%s', async explicitSharing => {
  const first = await service.save(ctx, 1n),
    keys = [...storage.objects.keys()]
  expect(await service.save(ctx, 1n)).toMatchObject({ result: 'already_saved', bookmark_user_uuid: first.bookmark_user_uuid })
  expect([...storage.objects.keys()]).toEqual(keys)
  await db.exec(
    `UPDATE sr_user_bookmark SET deleted_at=now(),archive_status=1,is_starred=true,alias_title='My title'; INSERT INTO sr_user_delete_bookmark(user_id,bookmark_id) SELECT 1,id FROM sr_bookmark;INSERT INTO sr_bookmark_share(user_id,bookmark_id,is_enable) SELECT 1,id,${explicitSharing} FROM sr_bookmark`
  )
  expect(await service.save(ctx, 1n)).toMatchObject({ result: 'restored', bookmark_user_uuid: first.bookmark_user_uuid })
  expect((await db.query('SELECT deleted_at,archive_status,is_starred,alias_title FROM sr_user_bookmark')).rows).toEqual([
    { deleted_at: null, archive_status: 0, is_starred: true, alias_title: 'My title' }
  ])
  expect((await db.query('SELECT * FROM sr_user_delete_bookmark')).rows).toEqual([])
  expect((await db.query('SELECT is_enable FROM sr_bookmark_share')).rows).toEqual([{ is_enable: explicitSharing }])
  expect(indexing).toHaveBeenCalledTimes(1)
})
test('second-member storage failure publishes no bookmark and cleans only its own files', async () => {
  const put = storage.bucket.put.bind(storage.bucket)
  vi.spyOn(storage.bucket, 'put').mockImplementation(async (key: any, body: any, options: any) => {
    if (key.startsWith('text/')) throw new Error('offline')
    return put(key, body, options)
  })
  await expect(service.save(ctx, 1n)).rejects.toThrow()
  expect((await db.query('SELECT * FROM sr_bookmark')).rows).toEqual([])
  expect([...storage.objects.keys()]).toEqual(['newsletter-content/original'])
})
test('COMMIT then lost acknowledgement reconciles without deleting its published copy', async () => {
  const publish = repo.publish.bind(repo)
  vi.spyOn(repo, 'publish').mockImplementation(async (...args) => {
    await publish(...args)
    throw new Error('ack lost')
  })
  const result = await service.save(ctx, 1n)
  expect(result.processing_status).toBe('ready')
  const row = (await db.query<any>('SELECT content_key FROM sr_bookmark')).rows[0]
  expect(await storage.bucket.get(row.content_key)).not.toBeNull()
})
test('foreign or disabled mail cannot create pending bookmarks or copy content', async () => {
  await expect(service.save({ ...ctx, getUserId: () => 2 }, 1n)).rejects.toMatchObject({ code: 'not_found' })
  await db.exec("UPDATE sr_user_lab_feature SET enabled=false WHERE user_id=1 AND feature='newsletter'")
  await expect(service.save(ctx, 1n)).rejects.toMatchObject({ code: 'not_found' })
  expect((await db.query('SELECT * FROM sr_bookmark')).rows).toEqual([])
  expect([...storage.objects.keys()]).toEqual(['newsletter-content/original'])
})

test('ordinary indexing failure keeps a readable copy and unchanged repeat does not rebuild content', async () => {
  indexing.mockRejectedValueOnce(new Error('external unavailable'))
  const first = await service.save(ctx, 1n),
    keys = [...storage.objects.keys()]
  expect((await repo.existing(1, 1n))?.uuid).toBe(first.bookmark_user_uuid)
  expect(await service.save(ctx, 1n)).toMatchObject({ result: 'already_saved', bookmark_user_uuid: first.bookmark_user_uuid })
  expect(indexing).toHaveBeenCalledTimes(1)
  expect([...storage.objects.keys()]).toEqual(keys)
})
test('disabling during copying prevents publication and cleans unpublished copy members', async () => {
  const put = storage.bucket.put.bind(storage.bucket)
  vi.spyOn(storage.bucket, 'put').mockImplementation(async (key: any, body: any, options: any) => {
    const result = await put(key, body, options)
    if (key.startsWith('text/')) await db.exec("UPDATE sr_user_lab_feature SET enabled=false WHERE user_id=1 AND feature='newsletter'")
    return result
  })
  await expect(service.save(ctx, 1n)).rejects.toMatchObject({ code: 'not_found' })
  expect((await db.query('SELECT * FROM sr_bookmark')).rows).toEqual([])
  expect([...storage.objects.keys()]).toEqual(['newsletter-content/original'])
})
