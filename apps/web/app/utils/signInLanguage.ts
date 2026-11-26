import { tokenFingerprint } from './accountContext'
import { localeAccountIdentity } from './userLocaleTasks'
import type { AppLocale } from '@commons/frontend-types/locale'
import Cookies from 'universal-cookie'

type Method = 'email' | 'google' | 'apple'
const attemptKey = 'slax_signin_language_'
const completedKey = 'slax_completed_signin_language'
export type SignInLanguageChoice = { accountKey: string; origin: AppLocale }

// Use the same cookie scope as the login session: provider callbacks can run on a sibling host.
const scope = (domain?: string) => ({ path: '/', domain: domain || undefined, sameSite: 'lax' as const, secure: location.protocol === 'https:' })

export function beginSignInLanguage(method: Method, origin: string, domain?: string) {
  if (origin !== 'en' && origin !== 'zh') return
  new Cookies().set(attemptKey + method, origin, { ...scope(domain), maxAge: 15 * 60 })
}

export function completeSignInLanguage(method: Method, token: string, domain?: string) {
  const cookies = new Cookies()
  const origin = cookies.get(attemptKey + method, { doNotParse: true })
  const options = scope(domain)
  for (const provider of ['email', 'google', 'apple']) cookies.remove(attemptKey + provider, options)
  const accountKey = localeAccountIdentity(token)
  if (accountKey && (origin === 'en' || origin === 'zh')) {
    cookies.set(completedKey, tokenFingerprint(accountKey) + '.' + origin, { ...options, maxAge: 15 * 60 })
  } else cookies.remove(completedKey, options)
}

export function takeSignInLanguageChoice(accountKey: string, current: AppLocale, domain?: string): SignInLanguageChoice | undefined {
  const cookies = new Cookies()
  const raw = cookies.get(completedKey, { doNotParse: true })
  if (typeof raw !== 'string') return
  const [owner, origin] = raw.split('.')
  if (owner !== tokenFingerprint(accountKey)) return
  cookies.remove(completedKey, scope(domain))
  if ((origin === 'zh' || origin === 'en') && current !== origin) return { accountKey, origin }
}
