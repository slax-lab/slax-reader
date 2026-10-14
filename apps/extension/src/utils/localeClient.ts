import { setExtensionLocale } from './locale'
import { ACCOUNT_LOCALE_KEY, isLocaleSnapshot, normalizeBrowserLocale } from './localeCore'
import type { ExtensionLocaleSnapshot, LocaleRuntimeResponse } from '@commons/frontend-types/locale'

export const initializeLocaleClient = () => {
  setExtensionLocale(normalizeBrowserLocale(browser.i18n.getUILanguage()))
  let disposed = false,
    current: ExtensionLocaleSnapshot | undefined,
    pending: Promise<void> | undefined
  let eventId = 0,
    foreignEvent: { id: number; generation: string | null } | undefined
  const buffered = new Map<string, ExtensionLocaleSnapshot>()
  const apply = (snapshot: ExtensionLocaleSnapshot) => {
    if (disposed) return
    if (current?.generation === snapshot.generation && current.revision > snapshot.revision) return
    current = snapshot
    setExtensionLocale(snapshot.locale)
  }
  const handshake = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (pending) return pending
    pending = (async () => {
      let again = true
      while (again && !disposed) {
        again = false
        const start = eventId
        const response = (await browser.runtime.sendMessage({ target: 'slax-background', method: 'get-account-locale' })) as LocaleRuntimeResponse
        if (disposed || !response?.success || !isLocaleSnapshot(response.snapshot)) return
        const snapshot = response.snapshot
        if (foreignEvent && foreignEvent.id > start && foreignEvent.generation !== snapshot.generation) {
          again = true
          continue
        }
        const newer = buffered.get(snapshot.generation)
        apply(newer && newer.revision > snapshot.revision ? newer : snapshot)
        buffered.clear()
      }
    })()
      .catch(() => {})
      .finally(() => {
        pending = undefined
      })
    return pending
  }
  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (disposed || area !== 'local' || !Object.hasOwn(changes, ACCOUNT_LOCALE_KEY)) return
    ++eventId
    const value = changes[ACCOUNT_LOCALE_KEY].newValue
    if (isLocaleSnapshot(value)) {
      const old = buffered.get(value.generation)
      if (!old || old.revision < value.revision) buffered.set(value.generation, value)
      if (current?.generation === value.generation) {
        apply(value)
        return
      }
    }
    foreignEvent = { id: eventId, generation: isLocaleSnapshot(value) ? value.generation : null }
    void handshake()
  }
  browser.storage.onChanged.addListener(onStorage)
  const onVisible = () => {
    if (document.visibilityState === 'visible') void handshake()
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
  const ready = handshake()
  return {
    ready,
    refresh: handshake,
    dispose: () => {
      disposed = true
      browser.storage.onChanged.removeListener(onStorage)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    }
  }
}
