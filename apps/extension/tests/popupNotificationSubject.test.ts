import { fitNotificationSubject } from '../src/entrypoints/popup/notificationSubject'
import { expect, test } from 'vitest'

test('keeps a short subject and truncates only the middle of a long subject', () => {
  const status = '已收藏成功'
  const fits = (subject: string) => `「${subject}」${status}`.length <= 17
  expect(fitNotificationSubject('阅读随笔', fits)).toBe('阅读随笔')
  expect(fitNotificationSubject('如何养成更好的长期阅读习惯', fits)).toBe('如何养成更…阅读习惯')
})

test('keeps grapheme clusters intact at both ends', () => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const fits = (subject: string) => Array.from(segmenter.segment(subject)).length <= 5
  expect(fitNotificationSubject('👏🏽春夏秋冬🍊', fits)).toBe('👏🏽春…冬🍊')
})
