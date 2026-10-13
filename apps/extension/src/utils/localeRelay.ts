import type { AccountLocaleInvalidated } from '@commons/frontend-types/locale'
export const isLocaleInvalidation = (value: unknown): value is AccountLocaleInvalidated => {
  const message = value as AccountLocaleInvalidated | null
  return message?.type === 'slax-reader:account-locale-invalidated' && message.version === 1
}
export const isLocaleSender = (sender: { id?: string; url?: string; frameId?: number }, id: string, base: string) => {
  try {
    return sender.id === id && sender.frameId === 0 && new URL(sender.url || '').origin === new URL(base).origin
  } catch {
    return false
  }
}
export const startLocaleRelay = (): (() => void) => {
  try {
    if (window !== window.top || location.origin !== new URL(process.env.PUBLIC_BASE_URL || '').origin) return () => {}
  } catch {
    return () => {}
  }
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin || !isLocaleInvalidation(event.data)) return
    void browser.runtime.sendMessage({ target: 'slax-background', method: 'invalidate-account-locale', version: 1 }).catch(() => {})
  }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
