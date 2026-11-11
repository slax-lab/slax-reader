import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { parseHTML } from 'linkedom'
import { buildImageProxyUrl, Imager } from '@/utils/imager'

// Node lacks Workers' MD5 Web Crypto extension. Keep the digest inputs real.
vi.mock('@/utils/strings', async () => {
  const { createHash } = await import('node:crypto')
  return { hashMD5: async (input: string) => createHash('md5').update(input).digest('hex') }
})

const env = { PROXY_IMAGE_PREFIX: 'https://api.example.com/static/image', IMAGER_CHECK_DIGST_SALT: 'test-salt', RUN_ENV: 'production' } as Env
const source = 'https://images.example.com/photo.png?size=large&name=a%2Fb'
const referer = 'https://example.com/article'

function signed(url: string, mode?: 'rss', prefix = env.PROXY_IMAGE_PREFIX) {
  const proxy = new URL(prefix)
  const encoded = encodeURIComponent(url)
  proxy.searchParams.set('u', encoded)
  proxy.searchParams.set('r', referer)
  if (mode) proxy.searchParams.set('m', mode)
  proxy.searchParams.set('d', createHash('md5').update(encoded + referer + env.IMAGER_CHECK_DIGST_SALT + (mode || '')).digest('hex'))
  return proxy.href
}

describe('configured signed image proxy reuse', () => {
  it.each([undefined, 'rss'] as const)('preserves ordinary signing and reuses a valid %s URL byte-for-byte', async mode => {
    const existing = signed(source, mode)
    expect(await buildImageProxyUrl(env, source, referer, mode)).toBe(existing)
    expect(await buildImageProxyUrl(env, existing, 'https://different.example/article', mode)).toBe(existing)
    expect(await buildImageProxyUrl(env, await buildImageProxyUrl(env, existing, referer, mode), referer, mode)).toBe(existing)
  })

  it('preserves the original query encoding rather than serializing a reusable URL', async () => {
    const existing = signed(source).replaceAll('%3A', '%3a').replaceAll('+', '%20')
    expect(await buildImageProxyUrl(env, existing, referer)).toBe(existing)
  })

  it.each([
    signed(source).replace('api.example.com', 'api.example.com.evil.test'),
    signed(source).replace('/static/image?', '/other?'),
    signed(source).replace(/d=[^&]+/, 'd=invalid'),
    signed(source).replace(/&r=[^&]+/, ''),
    signed(source).replace(/&d=[^&]+/, ''),
    signed(source).replace('https://api.', 'https://user:password@api.')
  ])('keeps the existing signer path for an unsupported or invalid URL', async input => {
    expect(await buildImageProxyUrl(env, input, referer)).toBe(signed(input))
  })

  it.each([[undefined, 'rss'], ['rss', undefined]] as const)('does not reuse another signing mode: %s to %s', async (from, to) => {
    const input = signed(source, from)
    expect(await buildImageProxyUrl(env, input, referer, to)).toBe(signed(input, to))
  })

  it('keeps the RSS proxy endpoint configuration check before reuse', async () => {
    await expect(buildImageProxyUrl({ ...env, PROXY_IMAGE_PREFIX: 'http://api.example.com/static/image' }, signed(source, 'rss'), referer, 'rss')).rejects.toThrow('Invalid RSS image proxy configuration')
  })

  it('keeps image and video sources stable through two real capture passes', async () => {
    const { document } = parseHTML(`<html><body><img src="${source.replaceAll('&', '&amp;')}"><video poster="${source.replaceAll('&', '&amp;')}" src="${source.replaceAll('&', '&amp;')}"></video></body></html>`)
    const imager = new Imager(env)
    await imager.batchReplaceImage(new URL(referer), document)
    const first = document.body.innerHTML
    await imager.batchReplaceImage(new URL(referer), document)
    expect(document.body.innerHTML).toBe(first)
    expect(document.querySelector('img')!.getAttribute('src')).toBe(signed(source))
  })
})
