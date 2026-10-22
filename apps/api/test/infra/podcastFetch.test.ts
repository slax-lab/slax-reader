/**
 * Outbound fetch for podcast pages, feeds and transcripts: every redirect hop is screened, the body
 * is capped, a loop of redirects ends.
 * 来源: src/infra/external/podcastFetch.ts, docs/podcast-article/spec.md 第 2 节
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchPublicText } from '@/infra/external/podcastFetch'

afterEach(() => vi.unstubAllGlobals())

describe('fetchPublicText', () => {
  test('follows a public redirect and returns the body', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      return url.endsWith('/old') ? new Response('', { status: 301, headers: { location: '/new' } }) : new Response('hello', { status: 200 })
    })
    expect(await fetchPublicText('https://example.com/old')).toBe('hello')
    expect(calls).toEqual(['https://example.com/old', 'https://example.com/new'])
  })

  test('refuses private addresses up front and after a redirect; ends a redirect loop', async () => {
    await expect(fetchPublicText('http://localhost/x')).rejects.toThrow('blocked_url:local_host')
    vi.stubGlobal('fetch', async () => new Response('', { status: 302, headers: { location: 'https://example.com/again' } }))
    await expect(fetchPublicText('https://example.com/a')).rejects.toThrow('too_many_redirects')
  })

  test('caps the body by header and by bytes read', async () => {
    vi.stubGlobal('fetch', async () => new Response('x'.repeat(100), { status: 200, headers: { 'content-length': '100' } }))
    await expect(fetchPublicText('https://example.com/a', { maxBytes: 50 })).rejects.toThrow('too_large')
    vi.stubGlobal('fetch', async () => new Response('x'.repeat(100), { status: 200 }))
    await expect(fetchPublicText('https://example.com/a', { maxBytes: 50 })).rejects.toThrow('too_large')
    expect(await fetchPublicText('https://example.com/a', { maxBytes: 100 })).toHaveLength(100)
  })
})
