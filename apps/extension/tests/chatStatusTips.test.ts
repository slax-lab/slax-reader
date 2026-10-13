import { setExtensionLocale } from '../src/utils/locale'

import { formatToolTip } from '../src/components/Chat/statusTips'
import { expect, it } from 'vitest'
it('translates status after switching locale while keeping the literal subject', () => {
  setExtensionLocale('en')
  const tip = { tool: 'search' as const, status: 'finished' as const, subject: 'hello $1' }
  expect(formatToolTip(tip)).toContain('hello $1')
  const en = formatToolTip(tip)
  setExtensionLocale('zh')
  expect(formatToolTip(tip)).not.toBe(en)
  expect(formatToolTip(tip)).toContain('hello $1')
  expect(formatToolTip({ tool: 'browser', status: 'failed' })).toBeTruthy()
})
