import en from '../locales/en.json'
import zh from '../locales/zh_CN.json'
import type { AppLocale, ExtensionLocaleSnapshot } from '@commons/frontend-types/locale'

export const normalizeAccountLocale = (value: unknown): AppLocale | null => (value === 'en' || value === 'zh' ? value : null)
export const normalizeBrowserLocale = (value: string): AppLocale => {
  const code = value.toLowerCase().replaceAll('_', '-')
  return /^(zh|zh-cn|zh-sg|zh-hans(?:-.*)?)$/.test(code) ? 'zh' : 'en'
}
export const formatMessage = (message: string, params: string[] = []) =>
  message.replace(/\$\$|\$([1-9])/g, (_match, index: string | undefined) => (index === undefined ? '$' : (params[Number(index) - 1] ?? '')))

const lookup = (dictionary: object, key: string): string | undefined => {
  let value: unknown = dictionary
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return
    value = (value as Record<string, unknown>)[part]
  }
  return typeof value === 'string' ? value : undefined
}
export const translate = (locale: AppLocale, key: string, params?: string[]) => formatMessage(lookup(locale === 'zh' ? zh : en, key) ?? lookup(en, key) ?? key, params)

export const ACCOUNT_LOCALE_KEY = 'slax:account-locale:v1'
export const isLocaleSnapshot = (value: unknown): value is ExtensionLocaleSnapshot => {
  if (!value || typeof value !== 'object') return false
  const s = value as ExtensionLocaleSnapshot
  return (
    s.version === 1 &&
    typeof s.generation === 'string' &&
    s.generation.length > 0 &&
    (s.accountKey === null || (typeof s.accountKey === 'string' && s.accountKey.length > 0)) &&
    normalizeAccountLocale(s.locale) !== null &&
    (s.source === 'browser' || (s.source === 'account' && s.accountKey !== null)) &&
    Number.isSafeInteger(s.revision) &&
    s.revision >= 0 &&
    Number.isFinite(s.verifiedAt) &&
    s.verifiedAt >= 0
  )
}
