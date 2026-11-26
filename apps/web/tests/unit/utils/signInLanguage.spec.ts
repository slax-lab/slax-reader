// @vitest-environment happy-dom
import { beginSignInLanguage, completeSignInLanguage, takeSignInLanguageChoice } from '~/utils/signInLanguage'

import { beforeEach, describe, expect, it } from 'vitest'

const token = 'head.' + btoa(JSON.stringify({ id: 'reader' })) + '.signature'

const setHost = (host: string) => {
  // happy-dom keeps the same cookie jar when the browser moves between fixture origins.
  ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('https://' + host)
}

beforeEach(() => {
  setHost('reader.slax.test')
  for (const item of document.cookie.split(';')) document.cookie = item.split('=')[0] + '=; path=/; max-age=0'
})

describe('completed Web sign-in language', () => {
  it('offers the language of the completed provider once per login', () => {
    beginSignInLanguage('google', 'en')
    beginSignInLanguage('email', 'zh')
    completeSignInLanguage('email', token)
    expect(takeSignInLanguageChoice('id:reader', 'en')).toEqual({ accountKey: 'id:reader', origin: 'zh' })
    expect(takeSignInLanguageChoice('id:reader', 'en')).toBeUndefined()
    expect(document.cookie).not.toContain('slax_completed_signin_language')
  })

  it('recovers on a sibling provider callback and consumes once back on the reader host', () => {
    beginSignInLanguage('google', 'zh', 'slax.test')
    setHost('auth.slax.test')
    completeSignInLanguage('google', token, 'slax.test')
    setHost('reader.slax.test')
    expect(takeSignInLanguageChoice('id:reader', 'en', 'slax.test')).toEqual({ accountKey: 'id:reader', origin: 'zh' })
    expect(takeSignInLanguageChoice('id:reader', 'en', 'slax.test')).toBeUndefined()
  })

  it('does not offer a matching language or reuse another account’s attempt', () => {
    beginSignInLanguage('apple', 'zh')
    completeSignInLanguage('apple', token)
    expect(takeSignInLanguageChoice('id:reader', 'zh')).toBeUndefined()
    beginSignInLanguage('google', 'zh')
    completeSignInLanguage('google', token)
    expect(takeSignInLanguageChoice('id:different', 'en')).toBeUndefined()
  })

  it('does not infer a language for an unrelated callback', () => {
    beginSignInLanguage('google', 'zh')
    completeSignInLanguage('apple', token)
    expect(takeSignInLanguageChoice('id:reader', 'en')).toBeUndefined()
  })
})
