import { describe, test, expect } from 'vitest'
import { db, repo, recipient, adapter } from './fixture'
import { LabRepo } from '@/infra/repository/dbLab'
import { UserRepo } from '@/infra/repository/dbUser'
const source = 'a'.repeat(64),
  message = 'b'.repeat(64)
const reserve = async () => repo.admit(await recipient(), source, message, 'mail@example.com')
const candidate = {
  senderName: 'Sender',
  title: 'One',
  summary: 'body',
  publishedAt: null,
  contentKey: 'newsletter-content/test/one.html',
  truncated: false,
  startedAt: Date.now()
}
describe('Newsletter permanent addresses', () => {
  test('a stale full-address confirmation cannot issue a different mailbox', async () => {
    await expect(repo.address(1, 'newsletterreader.slax.dev', true, 'feed+old-name@newsletterreader.slax.dev')).rejects.toMatchObject({ code: 'address_changed' })
    expect((await db.query("SELECT * FROM sr_platform_bind WHERE platform='newsletter'")).rows).toEqual([])
    await expect(repo.address(1, 'newsletterreader.slax.dev', true, 'feed+jane01@newsletterreader.slax.com')).rejects.toMatchObject({ code: 'address_changed' })
    expect((await db.query("SELECT * FROM sr_platform_bind WHERE platform='newsletter'")).rows).toEqual([])
    expect(await repo.address(1, 'newsletterreader.slax.dev', true, 'feed+jane01@newsletterreader.slax.dev')).toMatchObject({
      address: 'feed+jane01@newsletterreader.slax.dev'
    })
  })
  test('confirmation never replaces a receiving address created in another session', async () => {
    await repo.address(1, 'newsletterreader.slax.dev', true)
    await db.exec("UPDATE sr_user SET account='renamed' WHERE id=1")
    await expect(repo.address(1, 'newsletterreader.slax.dev', true, 'feed+renamed@newsletterreader.slax.dev')).rejects.toMatchObject({ code: 'address_changed' })
    expect(await repo.address(1, 'newsletterreader.slax.dev', true, 'feed+jane01@newsletterreader.slax.dev')).toMatchObject({
      address: 'feed+jane01@newsletterreader.slax.dev'
    })
  })
  test('GET is pure, provision is canonical and idempotent, and rename preserves address', async () => {
    expect(await repo.address(1, 'newsletterreader.slax.dev', false)).toMatchObject({
      status: 'not_provisioned',
      address: null
    })
    const first = await repo.address(1, 'newsletterreader.slax.dev', true)
    expect(first).toMatchObject({
      status: 'ready',
      address: 'feed+jane01@newsletterreader.slax.dev'
    })
    await db.query('UPDATE sr_user SET account=$1 WHERE id=1', ['你好'])
    expect(await repo.address(1, 'newsletterreader.slax.dev', true)).toEqual(first)
  })
  test('deleted users cannot receive and retained bindings cannot transfer', async () => {
    await recipient()
    await db.exec("UPDATE sr_user SET deleted_at=now() WHERE id=1; UPDATE sr_user SET account='jane01' WHERE id=2")
    await expect(repo.address(2, 'newsletterreader.slax.dev', true)).rejects.toMatchObject({
      code: 'address_reserved'
    })
    expect(await repo.recipient('slax.com', 'jane01')).toBeNull()
    expect(await repo.recipient('newsletterreader.slax.dev', 'jane01')).toBeNull()
  })
  test('an issued address stays stable across domain changes and distinct from business mail', async () => {
    await db.exec("UPDATE sr_user SET account='daguang' WHERE id=1")
    expect(await repo.address(1, 'newsletterreader.slax.dev', true)).toMatchObject({ address: 'feed+daguang@newsletterreader.slax.dev', status: 'ready' })
    expect(await repo.recipient('newsletterreader.slax.dev', 'daguang')).toMatchObject({ user_id: 1 })
    await expect(repo.address(1, 'newsletterreader.slax.com', true)).rejects.toMatchObject({ code: 'unavailable' })
    expect((await db.query("SELECT platform_id FROM sr_platform_bind WHERE platform='newsletter'")).rows).toEqual([{ platform_id: 'feed+daguang@newsletterreader.slax.dev' }])
  })
  test('an issued platform binding renders its original token after a rename', async () => {
    await repo.address(1, 'newsletterreader.slax.com', true)
    await db.exec("UPDATE sr_user SET account='daguang' WHERE id=1")
    for (const provision of [false, true])
      expect(await repo.address(1, 'newsletterreader.slax.com', provision)).toMatchObject({ address: 'feed+jane01@newsletterreader.slax.com', status: 'ready' })
  })
  test('first configuration accepts 15 characters and rejects 16 without truncation', async () => {
    await db.query('UPDATE sr_user SET account=$1 WHERE id=1', ['a'.repeat(15)])
    const issued = await repo.address(1, 'newsletterreader.slax.dev', true)
    expect(issued.address).toBe('feed+' + 'a'.repeat(15) + '@newsletterreader.slax.dev')
    await db.query('UPDATE sr_user SET account=$1 WHERE id=2', ['b'.repeat(16)])
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
})
describe('independent one-row admission and publication', () => {
  test.each(['', ' ', 'html/body/foreign.html', 'newsletter-content/../foreign'])('rejects invalid final body key %j before publication', async contentKey => {
    const r = await recipient(), first = await reserve()
    await expect(repo.publish(first.mail.id, 1, r.id, { ...candidate, contentKey, startedAt: Date.now() })).rejects.toMatchObject({ code: 'unavailable' })
    expect((await db.query('SELECT state,content_key FROM sr_newsletter_feed')).rows).toEqual([{ state: 'pending', content_key: null }])
  })
  test('existing user deletion blocks address access, admission and late publication', async () => {
    const r = await recipient(),
      first = await reserve()
    const pg = () => adapter(db)
    await new UserRepo(pg, pg).markUserAsDeleted(1)
    await expect(repo.address(1, 'newsletterreader.slax.dev', true)).rejects.toMatchObject({ code: 'not_found' })
    expect(await repo.recipient('newsletterreader.slax.dev', 'jane01')).toBeNull()
    await expect(repo.admit(r, source, 'c'.repeat(64), 'mail@example.com')).rejects.toMatchObject({ code: 'not_found' })
    await expect(repo.publish(first.mail.id, 1, r.id, { ...candidate, startedAt: Date.now() })).rejects.toMatchObject({ code: 'not_found' })
    expect((await db.query('SELECT state,content_key FROM sr_newsletter_feed')).rows).toEqual([{ state: 'cancelled', content_key: null }])
    expect((await db.query("SELECT platform_id FROM sr_platform_bind WHERE user_id=1 AND platform='newsletter'")).rows).toEqual([
      { platform_id: 'feed+jane01@newsletterreader.slax.dev' }
    ])
  })
  test('deduplicates admission and publishes one coherent immutable candidate without touching RSS', async () => {
    const r = await recipient(),
      first = await reserve()
    expect((await reserve()).mail.id).toBe(first.mail.id)
    expect((await db.query('SELECT * FROM sr_newsletter_feed')).rows).toHaveLength(1)
    const one = await repo.publish(first.mail.id, 1, r.id, { ...candidate, startedAt: Date.now() })
    expect(one.published).toBe(true)
    const two = await repo.publish(first.mail.id, 1, r.id, { ...candidate, title: 'Loser', contentKey: 'newsletter-content/loser', startedAt: Date.now() })
    expect(two.published).toBe(false)
    expect((await db.query('SELECT title,content_key,state FROM sr_newsletter_feed')).rows).toEqual([
      { title: 'One', content_key: 'newsletter-content/test/one.html', state: 'ready' }
    ])
    for (const table of ['sr_rss_feed', 'sr_rss_subscription', 'sr_rss_entry']) expect((await db.query(`SELECT * FROM ${table}`)).rows).toEqual([])
  })
  test('disable/re-enable cancels pending work permanently and other owners cannot publish', async () => {
    const r = await recipient(),
      first = await reserve(),
      labs = new LabRepo(() => adapter(db))
    await labs.upsert(1, 'newsletter', false)
    await labs.upsert(1, 'newsletter', true)
    expect((await repo.publish(first.mail.id, 1, r.id, { ...candidate, startedAt: Date.now() })).published).toBe(false)
    await expect(repo.publish(first.mail.id, 2, r.id, { ...candidate, startedAt: Date.now() })).rejects.toMatchObject({ code: 'not_found' })
    expect((await db.query('SELECT state,content_key FROM sr_newsletter_feed')).rows).toEqual([{ state: 'cancelled', content_key: null }])
  })
  test('an expired content attempt cannot publish, and a fresh actual attempt can', async () => {
    const r = await recipient(),
      first = await reserve()
    await expect(repo.publish(first.mail.id, 1, r.id, { ...candidate, startedAt: Date.now() - 301000 })).rejects.toMatchObject({ code: 'unavailable' })
    expect((await db.query('SELECT state FROM sr_newsletter_feed')).rows).toEqual([{ state: 'pending' }])
    expect((await repo.publish(first.mail.id, 1, r.id, { ...candidate, startedAt: Date.now() })).published).toBe(true)
  })
  test('quotas count admitted identities including pending, but a duplicate charges once', async () => {
    await reserve()
    await db.exec(
      `INSERT INTO sr_newsletter_feed(user_id,source_key,sender,message_key) SELECT 1,repeat('a',64),'mail@example.com',lpad(to_hex(i),64,'0') FROM generate_series(1,199)i`
    )
    expect((await reserve()).created).toBe(false)
    await expect(repo.admit(await recipient(), source, 'c'.repeat(64), 'mail@example.com')).rejects.toMatchObject({ code: 'limit_reached' })
    await db.exec(
      `TRUNCATE sr_newsletter_feed; INSERT INTO sr_newsletter_feed(user_id,source_key,sender,message_key,received_at) SELECT 1,lpad(to_hex(i),64,'0'),'mail'||i||'@example.com',repeat('b',64),now()-interval '2 days' FROM generate_series(1,200)i`
    )
    await expect(reserve()).rejects.toMatchObject({ code: 'limit_reached' })
  })
})
