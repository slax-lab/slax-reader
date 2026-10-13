import type { AccountLocaleInvalidated } from '@commons/frontend-types/locale'
export const notifyExtensionAccountLocaleInvalidated = () => {
  if (typeof window === 'undefined') return
  const message: AccountLocaleInvalidated = { type: 'slax-reader:account-locale-invalidated', version: 1 }
  window.postMessage(message, window.location.origin)
}
