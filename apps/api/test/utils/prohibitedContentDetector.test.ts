import { describe, test, expect } from 'vitest'
import { isProhibitedContentUrl } from '@/utils/prohibitedContentDetector'

describe('isProhibitedContentUrl', () => {
  test('matches known adult-content domains', () => {
    expect(isProhibitedContentUrl('https://www.pornhub.com/view_video?viewkey=abc')).toBe(true)
    expect(isProhibitedContentUrl('https://xvideos.com/video123')).toBe(true)
    expect(isProhibitedContentUrl('https://t66y.com/thread/123')).toBe(true)
    expect(isProhibitedContentUrl('http://91porn.com/view.php?id=1')).toBe(true)
    expect(isProhibitedContentUrl('https://jable.tv/videos/abc/')).toBe(true)
  })

  test('matches subdomains of blocked hosts', () => {
    expect(isProhibitedContentUrl('https://cn.pornhub.com/video/123')).toBe(true)
    expect(isProhibitedContentUrl('https://m.xvideos.com/video123')).toBe(true)
  })

  test('is case-insensitive', () => {
    expect(isProhibitedContentUrl('https://WWW.PORNHUB.COM/video')).toBe(true)
  })

  test('does not match unrelated domains', () => {
    expect(isProhibitedContentUrl('https://www.google.com/search?q=cats')).toBe(false)
    expect(isProhibitedContentUrl('https://github.com/anthropics')).toBe(false)
    expect(isProhibitedContentUrl('https://weibo.com/1234567890/abc')).toBe(false)
  })

  test('does not false-positive on domains that merely contain a blocked substring', () => {
    expect(isProhibitedContentUrl('https://notxvideos.com/page')).toBe(false)
    expect(isProhibitedContentUrl('https://xvideos.evil.com/page')).toBe(false)
  })

  test('accepts a URL object as input', () => {
    expect(isProhibitedContentUrl(new URL('https://xhamster.com/video/1'))).toBe(true)
    expect(isProhibitedContentUrl(new URL('https://example.com/video/1'))).toBe(false)
  })

  test('returns false for empty or invalid input rather than throwing', () => {
    expect(isProhibitedContentUrl('')).toBe(false)
    expect(isProhibitedContentUrl('not a url')).toBe(false)
  })
})
