import { afterEach, describe, expect, test, vi } from 'vitest'
import { decodeHtmlBody, SlaxFetch } from '@/infra/external/remoteFetcher'

afterEach(() => vi.restoreAllMocks())

test('Zyte still decodes Base64 URL response bodies', async () => {
  const html = '<html><title>中文</title><body>😀</body></html>'
  const encoded = Buffer.from(html).toString('base64url')
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ statusCode: 200, url: 'https://example.com/article', httpResponseBody: encoded }))

  const result = await new SlaxFetch({ ZYTE_API_KEY: 'test-key' } as Env).zyte('https://example.com/article')

  expect(result).toEqual({ content: html, url: 'https://example.com/article', title: '' })
})

describe('decodeHtmlBody', () => {
  test('按 meta charset 使用 GB2312/GBK 解码旧页面', () => {
    const prefix = new TextEncoder().encode('<html><head><meta http-equiv="content-type" content="text/html; charset=gb2312"><title>')
    const title = new Uint8Array([0xb1, 0xbb, 0xca, 0xd5, 0xc8, 0xdd, 0xd5, 0xdf, 0xcb, 0xef, 0xd6, 0xbe, 0xb8, 0xd5, 0xd6, 0xae, 0xcb, 0xc0])
    const suffix = new TextEncoder().encode('</title></head></html>')
    const bytes = new Uint8Array(prefix.length + title.length + suffix.length)
    bytes.set(prefix)
    bytes.set(title, prefix.length)
    bytes.set(suffix, prefix.length + title.length)

    expect(decodeHtmlBody(bytes.buffer)).toContain('<title>被收容者孙志刚之死</title>')
  })

  test('未声明 charset 时继续使用 UTF-8', () => {
    const html = '<html><head><title>中文标题</title></head></html>'

    expect(decodeHtmlBody(new TextEncoder().encode(html).buffer)).toBe(html)
  })
})
