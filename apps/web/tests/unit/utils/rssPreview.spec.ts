import { isRssImageUrl } from '../../../app/utils/rssPreview'

import { describe, expect, it } from 'vitest'

describe('RSS preview image transport', () => {
  const local = 'http://127.0.0.1:8788/static/image?m=rss&d=signed&u=example'
  it('accepts a signed local Wrangler image in development', () => {
    expect(isRssImageUrl(local, true)).toBe(true)
  })
  it('rejects local HTTP image transport in production', () => {
    expect(isRssImageUrl(local)).toBe(false)
  })
  it.each([false, true])('rejects raw origin images (development=%s)', dev => {
    expect(isRssImageUrl('https://source.example/raw.png', dev)).toBe(false)
    expect(isRssImageUrl('http://source.example/raw.png', dev)).toBe(false)
  })
  it('accepts a signed HTTPS image in either environment', () => {
    for (const dev of [false, true]) expect(isRssImageUrl('https://images.example/static/image?m=rss&d=signed', dev)).toBe(true)
  })
  it.each(['javascript:alert(1)', 'data:image/svg+xml,test', '/static/image?m=rss&d=signed', 'https://images.example/?m=rss', 'https://user:pass@images.example/?m=rss&d=signed'])('rejects invalid image URL %s', url => {
    expect(isRssImageUrl(url, true)).toBe(false)
  })
})
