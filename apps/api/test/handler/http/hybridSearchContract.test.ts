import { describe, expect, test } from 'vitest'
import { parseBookmarkSearchRequest, parseHybridSearchRequest } from '@slax-reader/contracts'

describe('parseHybridSearchRequest', () => {
  test('trims the keyword and returns no invented limit property', () => {
    expect(parseHybridSearchRequest({ keyword: '  reader  ' })).toEqual({ keyword: 'reader' })
    expect(parseHybridSearchRequest({ keyword: '  reader  ' })).not.toHaveProperty('limit')
  })

  test('accepts exactly five hundred Unicode code points, including astral characters', () => {
    expect(parseHybridSearchRequest({ keyword: '😀'.repeat(500) })).toEqual({ keyword: '😀'.repeat(500) })
    expect(parseHybridSearchRequest({ keyword: 'a'.repeat(500) })).toEqual({ keyword: 'a'.repeat(500) })
  })

  test.each([
    ['501 astral code points', '😀'.repeat(501)],
    ['501 ascii characters', 'a'.repeat(501)],
    ['empty', ''],
    ['whitespace only', ' \t\n '],
    ['non-string', 1],
    ['null', null],
    ['array', ['reader']]
  ])('rejects an invalid keyword: %s', (_label, keyword) => {
    expect(parseHybridSearchRequest({ keyword })).toBeNull()
  })

  test.each([0, 1, 20, 100, 101, 1.5, -1, '20', null, true, NaN, Infinity, undefined])('rejects the obsolete limit field %j as unknown', limit => {
    expect(parseHybridSearchRequest({ keyword: 'reader', limit })).toBeNull()
  })

  test.each([null, undefined, 'reader', 1, [], true, { limit: 20 }])('rejects a non-object request %j', value => {
    expect(parseHybridSearchRequest(value)).toBeNull()
  })

  test('rejects unknown fields instead of silently ignoring them', () => {
    expect(parseHybridSearchRequest({ keyword: 'reader', limit: 10, tag_uuids: [] })).toBeNull()
    expect(parseHybridSearchRequest({ keyword: 'reader', extra: true })).toBeNull()
  })

  test('does not mutate the request and returns a new trimmed value', () => {
    const input = { keyword: '  reader  ' }
    expect(parseHybridSearchRequest(input)).toEqual({ keyword: 'reader' })
    expect(input.keyword).toBe('  reader  ')
  })
})

describe('parseBookmarkSearchRequest remains the unchanged legacy contract', () => {
  test('keeps the legacy default (no limit), trimming and optional tags', () => {
    expect(parseBookmarkSearchRequest({ keyword: '  old  ' })).toEqual({ keyword: 'old' })
    expect(parseBookmarkSearchRequest({ keyword: 'old', tag_uuids: ['ABCDEF12-3456-7890-ABCD-EF1234567890', 'abcdef12-3456-7890-abcd-ef1234567890'] })).toEqual({
      keyword: 'old',
      tag_uuids: ['abcdef12-3456-7890-abcd-ef1234567890']
    })
  })

  test.each([
    ['missing keyword', {}],
    ['non-string keyword', { keyword: 1 }],
    ['empty keyword', { keyword: '   ' }],
    ['501 code points', { keyword: '😀'.repeat(501) }],
    ['non-array tags', { keyword: 'old', tag_uuids: 'tag' }],
    ['too many tags', { keyword: 'old', tag_uuids: Array.from({ length: 21 }, (_, index) => `abcdef12-3456-7890-abcd-ef12345678${String(index).padStart(2, '0')}`) }],
    ['malformed tag', { keyword: 'old', tag_uuids: ['not-a-uuid'] }],
    ['non-string tag', { keyword: 'old', tag_uuids: [1] }],
    ['array request', [{ keyword: 'old' }]],
    ['null request', null]
  ])('rejects the legacy-invalid request: %s', (_label, value) => {
    expect(parseBookmarkSearchRequest(value)).toBeNull()
  })

  test('keeps tolerating unrelated legacy keys so existing callers are not tightened', () => {
    expect(parseBookmarkSearchRequest({ keyword: 'old', ignored: true })).toEqual({ keyword: 'old' })
  })
})
