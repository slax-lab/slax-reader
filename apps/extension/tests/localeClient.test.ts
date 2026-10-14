import { getExtensionLocale } from '../src/utils/locale'
import { initializeLocaleClient } from '../src/utils/localeClient'

import { afterEach, expect, it, vi } from 'vitest'
const snapshot = (generation: string, revision: number, locale = 'zh') => ({ version: 1, generation, revision, locale, accountKey: 'A', source: 'account', verifiedAt: 1 })
afterEach(() => vi.unstubAllGlobals())
it('keeps a newer same-generation event and handshakes on cache recreation', async () => {
  let listener: (changes: object, area: string) => void = () => {},
    resolve!: (v: unknown) => void
  const send = vi.fn(
    () =>
      new Promise(r => {
        resolve = r
      })
  )
  vi.stubGlobal('browser', {
    i18n: { getUILanguage: () => 'en' },
    runtime: { sendMessage: send },
    storage: {
      onChanged: {
        addListener: (fn: typeof listener) => {
          listener = fn
        },
        removeListener: vi.fn()
      }
    }
  })
  const client = initializeLocaleClient()
  listener({ 'slax:account-locale:v1': { newValue: snapshot('g1', 20) } }, 'local')
  resolve({ success: true, snapshot: snapshot('g1', 1, 'en') })
  await client.ready
  expect(getExtensionLocale()).toBe('zh')
  listener({ 'slax:account-locale:v1': { newValue: snapshot('g2', 1, 'en') } }, 'local')
  resolve({ success: true, snapshot: snapshot('g2', 1, 'en') })
  await Promise.resolve()
  await Promise.resolve()
  expect(getExtensionLocale()).toBe('en')
  client.dispose()
})
it('ignores a handshake arriving after context disposal', async () => {
  let resolve!: (v: unknown) => void
  vi.stubGlobal('browser', {
    i18n: { getUILanguage: () => 'en' },
    runtime: {
      sendMessage: () =>
        new Promise(r => {
          resolve = r
        })
    },
    storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } }
  })
  const client = initializeLocaleClient()
  client.dispose()
  resolve({ success: true, snapshot: snapshot('g', 1) })
  await client.ready
  expect(getExtensionLocale()).toBe('en')
})
