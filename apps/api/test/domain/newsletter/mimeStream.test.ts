import { Buffer } from 'node:buffer'
import { expect, test, vi } from 'vitest'
import { parseNewsletter, parseNewsletterStream } from '@/utils/newsletter'
import { readNewsletterMime, NEWSLETTER_LIMITS } from '@/utils/newsletterMime'
import { NewsletterService, receiveNewsletterEmail } from '@/domain/newsletter'

const MiB = 1024 * 1024
const part = (headers: string, content: string | Uint8Array) => Buffer.concat([Buffer.from('--b\r\n' + headers + '\r\n\r\n'), Buffer.from(content), Buffer.from('\r\n')])
const multipart = (parts: Buffer[], subtype = 'mixed') =>
  Buffer.concat([Buffer.from('From: Sender <a@example.com>\r\nSubject: Stream\r\nContent-Type: multipart/' + subtype + '; boundary=b\r\n\r\n'), ...parts, Buffer.from('--b--\r\n')])
const html = (value = '<p>正文 Body</p>') => part('Content-Type: text/html; charset=utf-8', value)
const attachment = (value: string | Uint8Array, name = 'file.pdf') => part('Content-Type: application/pdf\r\nContent-Disposition: attachment; filename="' + name + '"', value)
const image = (value: Uint8Array, cid: string) =>
  part('Content-Type: image/png\r\nContent-ID: <' + cid + '>\r\nContent-Transfer-Encoding: base64', Buffer.from(value).toString('base64'))
const input = (raw: Uint8Array, chunk = 65536, rawSize = raw.length) => {
  let position = 0
  return {
    rawSize,
    raw: new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (position === raw.length) return controller.close()
          const end = Math.min(position + chunk, raw.length)
          controller.enqueue(raw.subarray(position, end))
          position = end
        }
      },
      { highWaterMark: 0 }
    )
  }
}

test.each([65536, 30 * MiB])('retained MIME excludes eight MiB of ordinary binary with input chunks of %i', async chunk => {
  const value = await readNewsletterMime(input(multipart([html(), attachment(Buffer.alloc(8 * MiB, 65))]), chunk))
  expect(value.mime.length).toBeLessThan(5000)
  expect(value.attachments).toEqual([{ filename: 'file.pdf', mimeType: 'application/pdf', contentId: '', size: 8 * MiB }])
  expect(JSON.stringify(value.attachments).length).toBeLessThan(500)
})

test('near-platform-limit raw mail retains its small body', async () => {
  const raw = multipart([html(), attachment(Buffer.alloc(25 * MiB - 1024, 65))])
  expect(raw.length).toBeLessThanOrEqual(NEWSLETTER_LIMITS.inboundBytes)
  const result = await parseNewsletterStream(input(raw))
  expect(result.html).toContain('正文 Body')
  expect(result.html.length).toBeLessThan(5000)
})

test.each([1, 7, 65536, 1000000])('chunk boundaries preserve Chinese body, metadata and raw identity: %s', async chunk => {
  const raw = multipart([html(), attachment('binary')])
  const result = await parseNewsletterStream(input(raw, chunk))
  expect(result.html).toContain('正文 Body')
  expect(result.messageKey).toBe((await parseNewsletter(raw)).messageKey)
  expect(result.attachments[0].size).toBe(6)
})

test.each([
  ['base64', Buffer.from('<p>中文邮件</p>').toString('base64')],
  ['quoted-printable', '<p>=E4=B8=AD=E6=96=87=E9=82=AE=E4=BB=B6</p>']
])('transfer decoding and reconstruction preserve %s text', async (encoding, body) => {
  const raw = multipart([part('Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: ' + encoding, body)])
  expect((await parseNewsletterStream(input(raw, 1))).html).toContain('中文邮件')
})

test('keeps HTML alternatives and discards explicitly attached text and forwarded EML bodies', async () => {
  const raw = multipart(
    [
      part('Content-Type: text/plain', 'plain alternative'),
      html(),
      part('Content-Type: text/plain\r\nContent-Disposition: attachment; filename=note.txt', 'ordinary text secret'),
      part('Content-Type: message/rfc822\r\nContent-Disposition: attachment; filename=forward.eml', 'From: b@example.com\r\n\r\nforwarded secret')
    ],
    'alternative'
  )
  const result = await parseNewsletter(raw)
  expect(result.html).toContain('正文 Body')
  expect(result.html).not.toMatch(/ordinary text secret|forwarded secret|plain alternative/)
  expect(result.attachments.map(value => value.filename)).toEqual(['note.txt', 'forward.eml'])
})

test.each([false, true])('CID can appear before or after the HTML: %s', async before => {
  const png = Buffer.from('complete PNG bytes')
  const body = html('<p>before<img src="cid:logo">after</p>')
  const img = image(png, 'logo')
  const parsed = await parseNewsletterStream(input(multipart(before ? [img, body] : [body, img]), 7))
  expect(parsed.html).toContain('data:image/png;base64,' + png.toString('base64'))
  expect(parsed.html).toContain('after')
  expect(parsed.attachments).toEqual([])
})

test('omits an oversized first CID, never substitutes a duplicate, and preserves a later distinct image', async () => {
  const raw = multipart([
    image(Buffer.alloc(6 * MiB, 65), 'oversized'),
    image(Buffer.from('WRONG'), 'oversized'),
    image(Buffer.from('GOOD'), 'good'),
    html('<p>before<img src="cid:oversized"><img src="cid:good">after</p>')
  ])
  const result = await parseNewsletterStream(input(raw))
  expect(result.truncated).toBe(true)
  expect(result.html).toContain('data:image/png;base64,' + Buffer.from('GOOD').toString('base64'))
  expect(result.html).not.toContain('data:image/png;base64,' + Buffer.from('WRONG').toString('base64'))
  expect(result.html).toContain('after')
})

test('keeps duplicate filenames separate and hashes discarded bytes when Message-ID is absent', async () => {
  const one = multipart([html(), attachment('one'), attachment('two')])
  const two = multipart([html(), attachment('one'), attachment('changed')])
  const parsed = await parseNewsletter(one)
  expect(parsed.attachments.map(value => value.size)).toEqual([3, 3])
  expect(parsed.messageKey).not.toBe((await parseNewsletter(two)).messageKey)
  expect(parsed.messageKey).toBe((await parseNewsletterStream(input(one, 1))).messageKey)
})

test('large retained text truncates a readable prefix without blocking the rest of the stream', async () => {
  const parsed = await parseNewsletterStream(input(multipart([html('<p>Prefix ' + 'x'.repeat(3 * MiB) + '</p>'), attachment('discard')])))
  expect(parsed.truncated).toBe(true)
  expect(parsed.html).toContain('Prefix')
  expect(parsed.html).toContain('file.pdf')
  expect(parsed.html.length).toBeLessThan(MiB)
})

test('checks actual byte overflow as well as an oversized declaration', async () => {
  const pull = vi.fn()
  await expect(readNewsletterMime({ rawSize: 26 * MiB, raw: new ReadableStream({ pull }, { highWaterMark: 0 }) })).rejects.toMatchObject({ code: 'invalid_message' })
  expect(pull).not.toHaveBeenCalled()
  const raw = multipart([html(), attachment(Buffer.alloc(26 * MiB))])
  await expect(readNewsletterMime(input(raw, 65536, 1))).rejects.toMatchObject({ code: 'invalid_message' })
})

test('short input and reader errors remain infrastructure failures without admission or permanent rejection', async () => {
  const raw = multipart([html()])
  await expect(parseNewsletterStream(input(raw, 7, raw.length + 1))).rejects.toMatchObject({ code: 'unavailable' })
  let sent = false
  const message = {
    rawSize: raw.length,
    to: 'feed+reader1@newsletterreader.slax.dev',
    setReject: vi.fn(),
    raw: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) controller.error(new Error('private transport detail'))
        else {
          sent = true
          controller.enqueue(raw.subarray(0, 20))
        }
      }
    })
  }
  const repo = { recipient: vi.fn().mockResolvedValue({ uuid: 'owner' }), admit: vi.fn() }
  const service = new NewsletterService(repo as never, {} as never)
  await expect(receiveNewsletterEmail(message as ForwardableEmailMessage, { NEWSLETTER_DOMAIN: 'newsletterreader.slax.dev' } as Env, service)).rejects.toThrow(
    'Newsletter admission unavailable'
  )
  expect(repo.admit).not.toHaveBeenCalled()
  expect(message.setReject).not.toHaveBeenCalled()
})

test('aggregate headers and nested MIME retain their bounds including discarded parts', async () => {
  const raw = multipart(Array.from({ length: 100 }, () => part('Content-Type: application/pdf\r\nX-Large: ' + 'x'.repeat(700), 'ignored')))
  await expect(parseNewsletter(raw)).rejects.toMatchObject({ code: 'invalid_message' })
  let body = 'Content-Type: text/plain\r\n\r\ninside'
  for (let i = 0; i < 35; i++) body = 'Content-Type: multipart/mixed; boundary=n' + i + '\r\n\r\n--n' + i + '\r\n' + body + '\r\n--n' + i + '--'
  await expect(parseNewsletter(Buffer.from('From: a@example.com\r\n' + body))).rejects.toMatchObject({ code: 'invalid_message' })
})
