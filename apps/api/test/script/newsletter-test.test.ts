import { expect, test } from 'vitest'
import { localEmailUrl, previewDocument } from '../../script/newsletter-test'

test('delivery only accepts localhost HTTP and preserves plus recipient', () => {
  const url = localEmailUrl('http://localhost:8787', 'feed+account@newsletterreader.slax.dev', 'sender@example.com')
  expect(url.searchParams.get('to')).toBe('feed+account@newsletterreader.slax.dev')
  expect(url.pathname).toBe('/cdn-cgi/local/email')
  for (const edge of ['https://example.com', 'http://127.0.0.1.evil.test', 'file:///tmp/test']) expect(() => localEmailUrl(edge, 'a', 'b')).toThrow()
})
test('preview blocks external resources and scripts', () => {
  expect(previewDocument('<p>Mail</p>')).toContain("default-src 'none'")
  expect(previewDocument('<p>Mail</p>')).toContain('<p>Mail</p>')
})

test('preview emits bounded readable artifacts without network access', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { vi } = await import('vitest')
  const { runNewsletterTest } = await import('../../script/newsletter-test')
  const folder = await mkdtemp(join(tmpdir(), 'newsletter-test-'))
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'))
  try {
    await writeFile(
      join(folder, 'sample.eml'),
      'From: a@example.com\r\nSubject: Synthetic\r\nContent-Type: text/html\r\n\r\n<p>Hello reader <a href="https://example.com/?token=abc">Read more</a></p>'
    )
    await runNewsletterTest(['--mode', 'preview', '--eml', join(folder, 'sample.eml'), '--out', join(folder, 'out')])
    expect(await readFile(join(folder, 'out/newsletter.html'), 'utf8')).toContain("default-src 'none'")
    expect(await readFile(join(folder, 'out/newsletter.txt'), 'utf8')).toContain('Hello reader')
    expect(JSON.parse(await readFile(join(folder, 'out/report.json'), 'utf8')).title).toBe('Synthetic')
    expect(fetchSpy).not.toHaveBeenCalled()
  } finally {
    fetchSpy.mockRestore()
    await rm(folder, { recursive: true, force: true })
  }
})
