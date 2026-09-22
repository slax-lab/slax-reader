import { describe, expect, test } from 'vitest'
import { applyCacheHeaders } from '@/middleware/cacheHeaders'
import { matchCacheableRequest, matchCacheableRoute } from '@/middleware/cacheableRoutes'

describe('image browser cache headers', () => {
  test('only the image proxy routes are cacheable', () => {
    expect(matchCacheableRoute('/static/image', 'GET')).toBeDefined()
    expect(matchCacheableRoute('/static/image/snippets', 'GET')).toBeDefined()
    expect(matchCacheableRoute('/v1/bookmark/detail', 'GET')).toBeUndefined()
    expect(matchCacheableRoute('/v1/share/mark_list', 'GET')).toBeUndefined()
    expect(matchCacheableRoute('/static/image', 'POST')).toBeUndefined()
    expect(matchCacheableRequest(new URL('https://api-reader.slax.com/static/image?key=image-1'), 'GET')).toBeDefined()
  })

  test('images are cached by browsers as public and immutable', () => {
    const request = new Request('https://api-reader.slax.com/static/image?key=image-1')
    const response = applyCacheHeaders(new Response('image'), request)

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=2592000, immutable')
    expect(response.headers.has('Cache-Tag')).toBe(false)
  })

  test('uncached routes and non-200 responses are unchanged', () => {
    const uncached = applyCacheHeaders(new Response('{}'), new Request('https://api-reader.slax.com/v1/bookmark/detail'))
    const failed = applyCacheHeaders(new Response('{}', { status: 404 }), new Request('https://api-reader.slax.com/static/image?key=x'))

    expect(uncached.headers.has('Cache-Control')).toBe(false)
    expect(failed.headers.has('Cache-Control')).toBe(false)
  })
})
