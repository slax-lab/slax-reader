import { describe, expect, test } from 'vitest'
import { isPublisherUser, parsePublishedTime, publisherPublishedTime, suppliedArticleTime } from '@/utils/publishedTime'

describe('article publish time parsing', () => {
  test.each([
    ['2024-03-05T10:20:30Z', '2024-03-05T10:20:30.000Z'],
    ['2024-03-05T10:20:30+08:00', '2024-03-05T02:20:30.000Z'],
    ['2024-03-05 10:20:30 +0800', '2024-03-05T02:20:30.000Z'],
    ['2024-03-05T10:20:30.123456Z', '2024-03-05T10:20:30.123Z'],
    ['Tue, 05 Mar 2024 10:20:30 GMT', '2024-03-05T10:20:30.000Z']
  ])('parses zoned value %s', (value, expected) => {
    expect(parsePublishedTime(value)?.toISOString()).toBe(expected)
  })

  test.each([['2024-03-05'], ['2024-3-5'], ['20240305'], ['March 5, 2024'], ['  2024-03-05  ']])('parses local date %s as local midnight', value => {
    const parsed = parsePublishedTime(value)
    expect(parsed && [parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), parsed.getHours()]).toEqual([2024, 2, 5, 0])
  })

  test('parses a Chinese date after the caller normalizes 年/月/日', () => {
    const parsed = parsePublishedTime('2024年03月05日 10:20'.replace(/年|月/g, '-').replace('日', ''))
    expect(parsed && [parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), parsed.getHours(), parsed.getMinutes()]).toEqual([2024, 2, 5, 10, 20])
  })

  test.each([[''], ['not a date'], ['2024-13-45'], ['2024-03-05-'], ['1709634030000']])('rejects %j', value => {
    expect(parsePublishedTime(value)).toBeUndefined()
  })
})

describe('publisher-supplied publication time', () => {
  const now = new Date('2026-11-27T08:00:00Z')

  test.each([
    ['2013-08-15T00:00:00Z', '2013-08-15T00:00:00.000Z'],
    ['2026-11-10T16:00:00+08:00', '2026-11-10T08:00:00.000Z'],
    ['2023-10-19T12:01:36+0000', '2023-10-19T12:01:36.000Z'],
    ['  2004-03-05T08:00:00Z  ', '2004-03-05T08:00:00.000Z']
  ])('accepts zoned value %j', (value, expected) => {
    expect(publisherPublishedTime(value, now)?.toISOString()).toBe(expected)
  })

  test.each([[undefined], [null], [12345], [''], ['2026-11-10'], ['2026-11-10T08:00:00'], ['not a date'], ['2026-11-27T08:00:01Z']])('rejects %j', value => {
    expect(publisherPublishedTime(value, now)).toBeUndefined()
  })

  test('accepts a time equal to the request time', () => {
    expect(publisherPublishedTime('2026-11-27T08:00:00Z', now)?.toISOString()).toBe('2026-11-27T08:00:00.000Z')
  })

  test('reads article:published_time from supplied HTML', () => {
    const html =
      '<!doctype html><html data-slax-publisher="article"><head><meta charset="utf-8"><title>T</title><meta property="article:published_time" content="2023-10-19T12:01:36+00:00"></head><body><p>x</p></body></html>'
    expect(suppliedArticleTime(html, now)?.toISOString()).toBe('2023-10-19T12:01:36.000Z')
  })

  test.each([
    ['no tag', '<html><head><title>T</title></head><body></body></html>'],
    ['unzoned tag', '<html><head><meta property="article:published_time" content="2023-10-19"></head><body></body></html>'],
    ['tag in body only', '<html><head></head><body><meta property="article:published_time" content="2023-10-19T00:00:00Z"></body></html>']
  ])('ignores supplied HTML with %s', (_name, html) => {
    expect(suppliedArticleTime(html, now)).toBeUndefined()
  })

  test('recognizes allowlisted publisher accounts only', () => {
    expect(isPublisherUser({ PUBLISHER_USER_IDS: '3, 7 ,9' } as never, 7)).toBe(true)
    expect(isPublisherUser({ PUBLISHER_USER_IDS: '3,9' } as never, 7)).toBe(false)
    expect(isPublisherUser({} as never, 7)).toBe(false)
  })
})
