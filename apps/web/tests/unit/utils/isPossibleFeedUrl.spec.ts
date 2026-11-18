import { isPossibleFeedUrl } from '@slax-reader/contracts/rss'
import { describe, expect, it } from 'vitest'

describe('isPossibleFeedUrl', () => {
  it.each(['/feed/', '/rss.xml', '/updates.atom', '/?feed=rss2', '/?format=atom'])('recognizes the explicit feed shape %s', path => {
    expect(isPossibleFeedUrl(`https://example.com${path}`)).toBe(true)
  })

  it.each(['/feedback', '/articles/rss-reader-review', '/?q=rss', '/?utm_source=feed', '/sitemap.xml', '/#rss'])('rejects false-positive shape %s', path => {
    expect(isPossibleFeedUrl(`https://example.com${path}`)).toBe(false)
  })

  it.each(['ftp://example.com/feed/', 'javascript:feed()', 'example.com/feed/', ''])('rejects invalid HTTP(S) address %s', address => {
    expect(isPossibleFeedUrl(address)).toBe(false)
  })

  it('uses a comparison copy without changing the full original address', () => {
    const address = '  https://Example.com/Feed/?format=atom&token=A%2Fb%2BC&sort=Newest#original  '
    const original = address
    expect(isPossibleFeedUrl(address)).toBe(true)
    expect(address).toBe(original)
    expect(address).toBe('  https://Example.com/Feed/?format=atom&token=A%2Fb%2BC&sort=Newest#original  ')
  })
})
