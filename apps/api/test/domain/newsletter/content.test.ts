import { test, expect } from 'vitest'
import { db, repo, recipient, adapter } from './fixture'
import { NewsletterService } from '@/domain/newsletter'
import { NewsletterContent } from '@/domain/newsletter/content'
import { LabRepo } from '@/infra/repository/dbLab'
import { memoryRssBucket } from '../rss/testBucket'
const setup = () => {
  const bucket = memoryRssBucket(),
    content = new NewsletterContent(() => bucket.client as never)
  const service = new NewsletterService(repo, content),
    env = { NEWSLETTER_DOMAIN: 'newsletterreader.slax.dev' } as Env
  const message = (id = 'one', to = 'feed+jane01@newsletterreader.slax.dev') => {
    const raw = new TextEncoder().encode(
      `From: Sender <sender@example.com>\r\nTo: foreign@example.com\r\nSubject: Subject\r\nMessage-ID: <${id}@example.com>\r\nContent-Type: text/html\r\n\r\n<p>Private safe body</p><script>bad()</script>`
    )
    return {
      to,
      rawSize: raw.length,
      raw: new ReadableStream({
        start(c) {
          c.enqueue(raw)
          c.close()
        }
      })
    } as ForwardableEmailMessage
  }
  return { ...bucket, content, service, env, message }
}
test('receives exactly one independent final body and never creates RSS entries or replay objects', async () => {
  await recipient()
  const p = setup()
  await p.service.receive(p.message(), p.env)
  await p.service.receive(p.message(), p.env)
  const rows = (await db.query<any>('SELECT * FROM sr_newsletter_feed')).rows
  expect(rows).toHaveLength(1)
  expect(rows[0].state).toBe('ready')
  expect(p.objects.size).toBe(1)
  expect(rows[0].content_key).toMatch(/^newsletter-content\//)
  expect(p.objects.get(rows[0].content_key)?.body).toContain('Private safe body')
  expect(p.objects.get(rows[0].content_key)?.body).not.toContain('script')
  expect((await db.query('SELECT * FROM sr_rss_entry')).rows).toHaveLength(0)
})
test('failed storage remains pending and requires an actual delivery to resume without charging again', async () => {
  await recipient()
  const p = setup(),
    put = p.r2.put.getMockImplementation()!
  p.r2.put.mockRejectedValueOnce(new Error('temporary'))
  await expect(p.service.receive(p.message(), p.env)).rejects.toThrow()
  expect((await db.query('SELECT state FROM sr_newsletter_feed')).rows).toEqual([{ state: 'pending' }])
  expect(p.objects.size).toBe(0)
  p.r2.put.mockImplementation(put)
  await p.service.receive(p.message(), p.env)
  expect((await db.query('SELECT state FROM sr_newsletter_feed')).rows).toEqual([{ state: 'ready' }])
})
test('disable and re-enable during R2 storage fences the pending message', async () => {
  await recipient()
  const p = setup(),
    put = p.r2.put.getMockImplementation()!,
    labs = new LabRepo(() => adapter(db))
  p.r2.put.mockImplementationOnce(async (key, body) => {
    await labs.upsert(1, 'newsletter', false)
    await labs.upsert(1, 'newsletter', true)
    return put(key, body)
  })
  await p.service.receive(p.message(), p.env)
  expect((await db.query('SELECT state,content_key FROM sr_newsletter_feed')).rows).toEqual([{ state: 'cancelled', content_key: null }])
  expect(p.objects.size).toBe(0)
})
test('invalid envelope cannot store body or admit mail', async () => {
  await recipient()
  const p = setup()
  for (const to of ['feed@newsletterreader.slax.dev', 'r+jane01@newsletterreader.slax.dev', 'feed+jane01+extra@newsletterreader.slax.dev', 'feed+jane01@slax.dev'])
    await expect(p.service.receive(p.message('bad', to), p.env)).rejects.toMatchObject({ code: 'not_found' })
  expect(p.objects.size).toBe(0)
  expect((await db.query('SELECT * FROM sr_newsletter_feed')).rows).toEqual([])
})
