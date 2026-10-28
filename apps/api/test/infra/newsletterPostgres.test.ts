/** Native multi-connection evidence; run only against a disposable migrated PostgreSQL database. */
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/hyperdrive-client'
import { beforeAll, afterAll, beforeEach, describe, test, expect } from 'vitest'
import { NewsletterRepo, type NewsletterRecipient } from '@/infra/repository/dbNewsletter'
import { NewsletterSaveRepo } from '@/infra/repository/dbNewsletterSave'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { LabRepo } from '@/infra/repository/dbLab'
const native = process.env.NEWSLETTER_LOCAL_PG_TEST === '1' ? describe : describe.skip
native('independent Newsletter native transactions', () => {
  const pool = new Pool({ connectionString: process.env.HYPERDRIVE_DATABASE_URL, max: 8 })
  const pg = new PrismaClient({ adapter: new PrismaPg(pool) })
  const repo = new NewsletterRepo(() => pg),
    lab = new LabRepo(() => pg),
    saves = new NewsletterSaveRepo(() => pg)
  let recipient: NewsletterRecipient
  const hash = (value: number) => value.toString(16).padStart(64, '0')
  beforeAll(async () => {
    const account = 'native-' + crypto.randomUUID().slice(0, 8)
    const user = await pg.sr_user.create({ data: { email: account + '@fixture.invalid', account, created_at: new Date(), last_login_at: new Date() } })
    await lab.upsert(user.id, 'newsletter', true)
    await repo.address(user.id, 'newsletterreader.slax.dev', true)
    recipient = (await repo.recipient('newsletterreader.slax.dev', account))!
  })
  beforeEach(async () => {
    await pg.$executeRaw`DELETE FROM sr_newsletter_feed WHERE user_id=${recipient.user_id}`
    await lab.upsert(recipient.user_id, 'newsletter', true)
  })
  afterAll(async () => {
    await pg.$disconnect()
    await pool.end()
  })
  test('parallel admissions reserve one identity and publication commits a coherent winner', async () => {
    const attempts = await Promise.all(Array.from({ length: 8 }, () => repo.admit(recipient, hash(1), hash(2), 'sender@fixture.invalid')))
    expect(attempts.filter(row => row.created)).toHaveLength(1)
    expect(new Set(attempts.map(row => String(row.mail.id))).size).toBe(1)
    const candidates = Array.from({ length: 8 }, (_, i) => ({
      senderName: 'Sender ' + i,
      title: 'Title ' + i,
      summary: 'Summary ' + i,
      publishedAt: null,
      contentKey: 'newsletter-content/' + i,
      truncated: false,
      startedAt: Date.now()
    }))
    const published = await Promise.all(candidates.map(item => repo.publish(attempts[0].mail.id, recipient.user_id, recipient.id, item)))
    expect(published.filter(row => row.published)).toHaveLength(1)
    const winner = published.find(row => row.published)!.mail,
      index = Number(winner.content_key!.split('/').at(-1))
    expect(winner).toMatchObject({ title: 'Title ' + index, summary: 'Summary ' + index, sender_name: 'Sender ' + index })
  })
  test('the final daily quota slot admits only one parallel new identity', async () => {
    await pg.$executeRaw`INSERT INTO sr_newsletter_feed(user_id,source_key,sender,message_key) SELECT ${recipient.user_id},${hash(1)},'sender@fixture.invalid',lpad(to_hex(i),64,'0') FROM generate_series(1,199) i`
    const outcomes = await Promise.allSettled([
      repo.admit(recipient, hash(1), hash(300), 'sender@fixture.invalid'),
      repo.admit(recipient, hash(1), hash(301), 'sender@fixture.invalid')
    ])
    expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(row => row.status === 'rejected')).toHaveLength(1)
  })
  test('disable then re-enable fences a previously admitted publication', async () => {
    const { mail } = await repo.admit(recipient, hash(1), hash(2), 'sender@fixture.invalid')
    await lab.upsert(recipient.user_id, 'newsletter', false)
    await lab.upsert(recipient.user_id, 'newsletter', true)
    expect(
      await repo.publish(mail.id, recipient.user_id, recipient.id, {
        senderName: 'late',
        title: 'late',
        summary: 'late',
        publishedAt: null,
        contentKey: 'newsletter-content/late',
        truncated: false,
        startedAt: Date.now()
      })
    ).toMatchObject({ published: false, mail: { state: 'cancelled', content_key: null } })
  })
  test('parallel Inbox publications produce one independent private bookmark', async () => {
    const { mail } = await repo.admit(recipient, hash(1), hash(2), 'sender@fixture.invalid')
    await repo.publish(mail.id, recipient.user_id, recipient.id, {
      senderName: 'Sender',
      title: 'Title',
      summary: 'Summary',
      publishedAt: null,
      contentKey: 'newsletter-content/native',
      truncated: false,
      startedAt: Date.now()
    })
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => {
        const uuid = crypto.randomUUID()
        return saves.publish(recipient.user_id, mail.id, 'newsletter-content/native', {
          uuid,
          content_key: 'html/body/' + uuid + '.html',
          content_md_key: 'text/body/' + uuid + '.txt',
          content_word_count: 10
        })
      })
    )
    expect(outcomes.filter(row => row.result === 'created')).toHaveLength(1)
    expect(new Set(outcomes.map(row => row.relation.uuid)).size).toBe(1)
    expect(await pg.sr_bookmark_share.findFirst({ where: { bookmark_id: outcomes[0].relation.bookmark_id } })).toBeNull()
  })
  test('real HTTP-style trash then save restoration reactivates existing tag relations', async () => {
    const { mail } = await repo.admit(recipient, hash(1), hash(2), 'sender@fixture.invalid')
    await repo.publish(mail.id, recipient.user_id, recipient.id, {
      senderName: 'Sender',
      title: 'Tagged mail',
      summary: 'Summary',
      publishedAt: null,
      contentKey: 'newsletter-content/native-tag',
      truncated: false,
      startedAt: Date.now()
    })
    const uuid = crypto.randomUUID(),
      created = await saves.publish(recipient.user_id, mail.id, 'newsletter-content/native-tag', {
        uuid,
        content_key: 'html/body/' + uuid + '.html',
        content_md_key: 'text/body/' + uuid + '.txt',
        content_word_count: 10
      })
    const vocabulary = await pg.sr_user_tag.create({ data: { user_id: recipient.user_id, tag_name: 'Kept tag' } })
    const tag = await pg.sr_user_bookmark_tag.create({
      data: { user_id: recipient.user_id, bookmark_id: created.relation.bookmark_id, tag_id: vocabulary.id, tag_name: 'Kept tag', source: 'user' }
    })
    await new BookmarkRepo(
      () => pg,
      () => pg
    ).updateBookmarkDeleteAt(created.relation.bookmark_id, recipient.user_id, true)
    expect((await pg.sr_user_bookmark_tag.findUnique({ where: { id: tag.id } }))?.is_deleted).toBe(true)
    expect((await saves.publish(recipient.user_id, mail.id, 'newsletter-content/native-tag')).result).toBe('restored')
    expect(await pg.sr_user_bookmark_tag.findUnique({ where: { id: tag.id } })).toMatchObject({ uuid: tag.uuid, is_deleted: false, tag_name: 'Kept tag', source: 'user' })
  })
})
