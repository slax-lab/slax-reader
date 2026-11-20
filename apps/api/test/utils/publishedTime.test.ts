import { describe, expect, test } from 'vitest'
import { parsePublishedTime } from '@/utils/publishedTime'

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
