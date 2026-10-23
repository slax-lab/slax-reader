import { describe, expect, it } from 'vitest'
import { readerBookmarkUuid, failedReaderSaveUrl } from '@slax-reader/contracts'

const source = '12345678-1234-4234-8234-123456789abc'
const origins = ['https://reader.example.com', 'http://localhost:3000']

describe('Reader snapshot URL classification', () => {
  it.each(['', '/', '?from=share', '#paragraph', '/?from=share#paragraph'])('recognizes the configured snapshot with suffix %s', suffix => {
    expect(readerBookmarkUuid(`https://reader.example.com/b/${source}${suffix}`, origins)).toBe(source)
  })

  it.each([
    `https://reader.example.com.attacker.test/b/${source}`,
    `https://attacker.test/b/${source}?next=https://reader.example.com`,
    `https://user@reader.example.com/b/${source}`,
    `https://reader.example.com:444/b/${source}`,
    `https://reader.example.com/b/${source}/extra`,
    'https://reader.example.com/b/not-a-uuid',
    'https://reader.example.com/s/abc',
    'not a URL'
  ])('does not classify an untrusted or non-snapshot URL: %s', url => {
    expect(readerBookmarkUuid(url, origins)).toBeNull()
  })

  it('supports the configured local origin and normalizes UUID case', () => {
    expect(readerBookmarkUuid(`http://localhost:3000/b/${source.toUpperCase()}`, origins)).toBe(source)
    expect(readerBookmarkUuid(`http://localhost:3001/b/${source}`, origins)).toBeNull()
  })

  it('does not accept credentials or query data in an origin configuration', () => {
    expect(readerBookmarkUuid(`https://reader.example.com/b/${source}`, ['https://user@reader.example.com'])).toBeNull()
    expect(readerBookmarkUuid(`https://reader.example.com/b/${source}`, ['https://reader.example.com?allow=all'])).toBeNull()
  })

  it('keeps queued failure identities distinct and replay-stable without changing the source', () => {
    const first = failedReaderSaveUrl(`https://reader.example.com/b/${source}?from=share#old`, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    const second = failedReaderSaveUrl(`https://reader.example.com/b/${source}?from=share#old`, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    expect(first).toBe(`https://reader.example.com/b/${source}?from=share#slax-failed-save=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`)
    expect(first).not.toBe(second)
    expect(failedReaderSaveUrl(first, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe(first)
    expect(readerBookmarkUuid(first, origins)).toBe(source)
  })
})
