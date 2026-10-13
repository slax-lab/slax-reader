import { formatMessage, normalizeAccountLocale, normalizeBrowserLocale, translate } from '../src/utils/localeCore'

import en from '../src/locales/en.json'
import zh from '../src/locales/zh_CN.json'
import { describe, expect, it } from 'vitest'

describe('locale translation', () => {
  it.each([
    ['en-US', 'en'],
    ['zh_CN', 'zh'],
    ['ZH-hans-SG', 'zh'],
    ['zh-TW', 'en'],
    ['zh-Hant', 'en'],
    ['fr', 'en']
  ])('maps browser %s to %s', (input, expected) => {
    expect(normalizeBrowserLocale(input)).toBe(expected)
  })
  it('only accepts canonical account locales', () => {
    expect(normalizeAccountLocale('zh')).toBe('zh')
    for (const value of ['zh-CN', 'fr', null, {}, 'EN']) expect(normalizeAccountLocale(value)).toBeNull()
  })
  it('interpolates once and keeps literal replacement characters', () => {
    expect(formatMessage('$1 / $1 / $$ / $2', ['$& $1\\x', 'B'])).toBe('$& $1\\x / $& $1\\x / $ / B')
    expect(formatMessage('$1/$2', ['A'])).toBe('A/')
  })
  it('uses real dictionaries and falls back to the key', () => {
    expect(translate('en', 'collect_page')).toBe(en.collect_page)
    expect(translate('zh', 'collect_page')).toBe(zh.collect_page)
    expect(translate('zh', 'missing.key')).toBe('missing.key')
    expect(translate('en', '__proto__.toString')).toBe('__proto__.toString')
  })
  it('ships equal string-only key sets for both languages', () => {
    const leaves = (value: object, prefix = ''): string[] =>
      Object.entries(value).flatMap(([key, item]) => {
        const name = prefix + key
        if (typeof item === 'object' && item !== null) return leaves(item, `${name}.`)
        expect(typeof item).toBe('string')
        expect(item).not.toMatch(/\$[a-zA-Z_]|\{\w+\}|\|\|/)
        return [name]
      })
    expect(leaves(en).sort()).toEqual(leaves(zh).sort())
  })
})
