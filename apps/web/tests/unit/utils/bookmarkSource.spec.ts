import { bookmarkMatchesSourceDomain, getBookmarkSourceDomain, normalizeSourceDomain } from '~~/app/utils/bookmarkSource'

import { describe, expect, it } from 'vitest'

describe('bookmarkSource', () => {
  it.each([
    ['Example.COM', 'example.com'],
    ['https://WWW.Example.com:443/path?q=1', 'www.example.com'],
    ['sub.example.com.', 'sub.example.com'],
    ['', '']
  ])('normalizeSourceDomain(%s) → %s', (input, expected) => {
    expect(normalizeSourceDomain(input)).toBe(expected)
  })

  it('host_url 非法时回退 target_url', () => {
    expect(getBookmarkSourceDomain({ host_url: '://', target_url: 'https://fallback.example/post' })).toBe('fallback.example')
  })

  it('只匹配相同 hostname', () => {
    expect(bookmarkMatchesSourceDomain({ host_url: 'https://Example.com/path', target_url: '' }, 'example.com')).toBe(true)
    expect(bookmarkMatchesSourceDomain({ host_url: 'other.example', target_url: '' }, 'example.com')).toBe(false)
  })
})
