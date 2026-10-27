import { describe, expect, test } from 'vitest'
import { parseNewsletter, readNewsletterRaw, newsletterLocalPart, newsletterDomain } from '@/domain/newsletter/parser'

const mail = (body: string, headers = '') =>
  new TextEncoder().encode(
    'From: =?UTF-8?B?5rWL6K+V?= <News@Example.com>\r\nSubject: Weekly\r\nMessage-ID: <one@example.com>\r\nDate: Thu, 22 Oct 2026 10:00:00 +0000\r\n' + headers + '\r\n' + body
  )
describe('bounded Newsletter input', () => {
  test('canonical account and domain are validated without silently changing unsafe names', () => {
    expect(newsletterLocalPart('Jane.Doe')).toBe('jane.doe')
    expect(newsletterLocalPart('a'.repeat(59))).toHaveLength(59)
    for (const value of ['', '.jane', 'jane.', 'a..b', 'a+b', '你好', 'a'.repeat(60), ' a ']) expect(newsletterLocalPart(value)).toBeNull()
    expect(newsletterDomain('Slax.Dev')).toBe('slax.dev')
    for (const value of ['', 'https://slax.dev', 'slax.dev/path', 'a@slax.dev', 'slax.dev ', '-a.dev']) expect(newsletterDomain(value)).toBeNull()
  })
  test('parses encoded sender and keeps Message-ID separate from body fallback', async () => {
    const value = await parseNewsletter(mail('hello <script>x</script>'))
    expect(value.sender).toBe('news@example.com')
    expect(value.sourceTitle).toBe('测试')
    expect(value.title).toBe('Weekly')
    expect(value.html).toContain('&lt;script&gt;')
    expect(value.messageKey).toBe((await parseNewsletter(mail('changed'))).messageKey)
  })
  test('fallback identity includes stable body, sender, subject and date', async () => {
    const raw = (body: string) => new TextEncoder().encode('From: Sender <a@example.com>\r\nSubject: Same\r\n\r\n' + body)
    expect((await parseNewsletter(raw('one'))).messageKey).not.toBe((await parseNewsletter(raw('two'))).messageKey)
    expect((await parseNewsletter(raw('one'))).messageKey).toBe((await parseNewsletter(raw('one'))).messageKey)
  })
  test('removes CID/relative images and unsafe embeds and reports truncation', async () => {
    const value = await parseNewsletter(
      mail(
        '<script>x</script><img src="cid:one"><img src="/relative"><picture><source srcset="/tracker.png 1x"><img srcset="cid:part 2x"></picture><img src="https://example.com/a.png"><a href="/unsubscribe">relative</a><iframe src="https://bad.example"></iframe>',
        'Content-Type: text/html\r\n'
      )
    )
    expect(value.html).not.toMatch(/script|iframe|cid:|tracker\.png|rss\.invalid|\/relative|href="\/unsubscribe"/)
    expect(value.html).toContain('https://example.com/a.png')
    const big = await parseNewsletter(mail('<p>' + 'a'.repeat(250_000) + '</p>', 'Content-Type: text/html\r\n'))
    expect(big.truncated).toBe(true)
    expect(big.html).toContain('a'.repeat(100))
  })
  test('rejects oversized declared size before consuming raw and verifies actual streamed bytes', async () => {
    let pulls = 0
    const stream = () =>
      new ReadableStream<Uint8Array>({
        pull(c) {
          pulls++
          c.enqueue(new Uint8Array(3 * 1024 * 1024))
          if (pulls > 3) c.close()
        }
      })
    await expect(readNewsletterRaw({ rawSize: 6 * 1024 * 1024, raw: stream() })).rejects.toMatchObject({ code: 'invalid_message' })
    const previous = pulls
    await expect(readNewsletterRaw({ rawSize: 1, raw: stream() })).rejects.toMatchObject({ code: 'invalid_message' })
    expect(pulls).toBeGreaterThan(previous)
  })
  test('rejects absent sender and excessive MIME part count', async () => {
    await expect(parseNewsletter(new TextEncoder().encode('Subject: missing sender\r\n\r\nx'))).rejects.toMatchObject({ code: 'invalid_message' })
    const parts = Array.from({ length: 210 }, () => '--b\r\nContent-Type: text/plain\r\n\r\nx\r\n').join('')
    await expect(parseNewsletter(mail(parts + '--b--', 'Content-Type: multipart/mixed; boundary=b\r\n'))).rejects.toMatchObject({ code: 'invalid_message' })
  })
})

import { receiveNewsletterEmail } from '@/domain/newsletter'
import { NewsletterError } from '@/domain/newsletter/parser'
import { vi } from 'vitest'
test('SMTP wrapper uses a generic policy rejection and propagates sanitized infrastructure failure', async () => {
  const setReject = vi.fn(),
    message = { setReject } as unknown as ForwardableEmailMessage
  await receiveNewsletterEmail(
    message,
    {} as Env,
    {
      receive: async () => {
        throw new NewsletterError('not_found')
      }
    } as any
  )
  expect(setReject).toHaveBeenCalledWith('Newsletter delivery is not available for this message.')
  setReject.mockClear()
  await expect(
    receiveNewsletterEmail(
      message,
      {} as Env,
      {
        receive: async () => {
          throw new Error('postgres://private@example.com')
        }
      } as any
    )
  ).rejects.toThrow('Newsletter admission unavailable')
  expect(setReject).not.toHaveBeenCalled()
})

test('mail removes explicit tracking images before sanitization and preserves signed ordinary images and links quietly', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'))
  try {
    const result = await parseNewsletter(
      mail(
        '<meta property="og:site_name" content="Medium"><p>Confirm your subscription <a href="https://example.com/confirm?token=secret">Confirm</a></p><img width="1" height="1" src="https://example.com/pixel"><img style="display: none" src="https://example.com/hidden"><img src="https://example.com/photo?signature=abc">',
        'Content-Type: text/html\r\n'
      )
    )
    expect(result.html).not.toMatch(/pixel|hidden/)
    expect(result.html).toContain('signature=abc')
    expect(result.html).toContain('token=secret')
    expect(result.removedTrackingImages).toBe(2)
    expect(log).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  } finally {
    log.mockRestore()
    fetchSpy.mockRestore()
  }
})

test('attachment-only mail is readable without exposing bytes and fallback identity includes attachment content', async () => {
  const raw = (content: string) =>
    new TextEncoder().encode(
      'From: a@example.com\r\nSubject: Documents\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="report.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
        content +
        '\r\n--b--'
    )
  const result = await parseNewsletter(raw('YWJj'))
  expect(result.html).toContain('report.pdf')
  expect(result.html).toContain('application/pdf')
  expect(result.html).toContain('3 bytes')
  expect(result.html).not.toMatch(/YWJj|href=/)
  expect(result.attachments).toEqual([{ filename: 'report.pdf', mimeType: 'application/pdf', size: 3 }])
  expect(result.messageKey).not.toBe((await parseNewsletter(raw('ZGVm'))).messageKey)
})

test('retains multiple articles, external links and MIME metadata when extraction would lose content', async () => {
  const result = await parseNewsletter(
    mail(
      '<html><head><title>Wrong title</title><meta name="author" content="Wrong sender"></head><body><header>Issue introduction</header><article><h1>First story</h1><p>' +
        'First story detail. '.repeat(80) +
        '</p><a href="https://example.com/one?token=a">First link</a></article><aside><h2>Second story</h2><p>Second story detail</p><a href="https://example.com/two?token=b">Second link</a></aside><footer>Issue conclusion</footer></body></html>',
      'Content-Type: text/html\r\n'
    )
  )
  expect(result.title).toBe('Weekly')
  expect(result.sourceTitle).toBe('测试')
  expect(result.publishedAt?.toISOString()).toBe('2026-10-22T10:00:00.000Z')
  for (const text of ['Issue introduction', 'First story', 'Second story', 'token=a', 'token=b', 'Issue conclusion']) expect(result.html).toContain(text)
})

test('removes tracking images hidden by an ancestor and keeps ordinary single-axis narrow images', async () => {
  const result = await parseNewsletter(
    mail(
      '<div style="visibility: hidden"><img src="https://example.com/ancestor-tracker"></div><img width="1" height="100" src="https://example.com/rule"><img width="0" height="0" src="https://example.com/zero">',
      'Content-Type: text/html\r\n'
    )
  )
  expect(result.html).not.toContain('ancestor-tracker')
  expect(result.html).not.toContain('/zero')
  expect(result.html).toContain('/rule')
  expect(result.removedTrackingImages).toBe(2)
})

test('removes images with either explicitly zero dimension without removing ordinary narrow images', async () => {
  const result = await parseNewsletter(
    mail(
      '<img width="0" height="100" src="https://example.com/zero-width"><img height="0" width="100" src="https://example.com/zero-height"><img style="width:0px" src="https://example.com/style-zero"><img style="height:0" src="https://example.com/style-height-zero"><img width="1" height="100" src="https://example.com/narrow">',
      'Content-Type: text/html\r\n'
    )
  )
  expect(result.html).not.toMatch(/zero-width|zero-height|style-zero|style-height-zero/)
  expect(result.html).toContain('/narrow')
  expect(result.removedTrackingImages).toBe(4)
})

import PostalMime from 'postal-mime'
import { serializeNewsletterContent } from '@/domain/newsletter/parser'
test('clean staged MIME is compatible with old MIME readers and preserves Unicode metadata and links', async () => {
  const parsed = await parseNewsletter(mail('<p>你好 <a href="https://example.com/?token=abc">阅读</a></p>', 'Content-Type: text/html; charset=utf-8\r\n'))
  parsed.title = '每周简报 '.repeat(80) + '\r\nBcc: injected@example.com'
  parsed.sourceTitle = '测试作者\r\nBcc: injected@example.com'
  parsed.truncated = true
  const staged = serializeNewsletterContent(parsed)
  const decoded = await PostalMime.parse(staged)
  expect(decoded.from?.address).toBe(parsed.sender)
  expect(decoded.from?.name).toBe('测试作者  Bcc: injected@example.com')
  expect(decoded.subject).toContain('每周简报')
  expect(decoded.bcc).toBeUndefined()
  expect(decoded.messageId).toBe('<' + parsed.messageKey + '@newsletter.invalid>')
  expect(decoded.html).toBe(parsed.html)
  expect(decoded.attachments).toEqual([])
  expect(decoded.date).toBe(parsed.publishedAt?.toISOString())
  expect(staged).toContain('Content-Transfer-Encoding: base64')
  expect(staged).not.toContain('"version":')
  expect(staged.split('\r\n').every(line => line.length <= 998)).toBe(true)
  const reparsed = await parseNewsletter(new TextEncoder().encode(staged))
  expect(reparsed.html).toContain('token=abc')
  expect(reparsed.truncated).toBe(true)
})

test('staged attachment mail contains metadata-only HTML and rejects injectable sender headers', async () => {
  const raw = new TextEncoder().encode(
    'From: a@example.com\r\nSubject: Document\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="report.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nYWJj\r\n--b--'
  )
  const parsed = await parseNewsletter(raw)
  const decoded = await PostalMime.parse(serializeNewsletterContent(parsed))
  expect(decoded.attachments).toEqual([])
  expect(decoded.html).toContain('report.pdf')
  expect(decoded.html).not.toContain('YWJj')
  expect(decoded.html).not.toContain('href=')
  expect(() => serializeNewsletterContent({ ...parsed, sender: 'a@example.com\r\nBcc: hidden@example.com' })).toThrow('invalid_message')
})
