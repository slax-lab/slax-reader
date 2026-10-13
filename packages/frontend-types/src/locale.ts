export type AppLocale = 'en' | 'zh'

export interface AccountLocaleInvalidated {
  type: 'slax-reader:account-locale-invalidated'
  version: 1
}

export interface ExtensionLocaleSnapshot {
  version: 1
  generation: string
  accountKey: string | null
  locale: AppLocale
  source: 'account' | 'browser'
  revision: number
  verifiedAt: number
}

export type LocaleRefreshReason = 'startup' | 'session' | 'user-save' | 'open' | 'online' | 'alarm'
export type LocaleRuntimeRequest = { target: 'slax-background'; method: 'get-account-locale' } | { target: 'slax-background'; method: 'invalidate-account-locale'; version: 1 }
export type LocaleRuntimeResponse = { success: true; snapshot: ExtensionLocaleSnapshot } | { success: false }
