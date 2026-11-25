import { getTokenUserId } from '~/utils/sessionOwner'

import { createErrorCollector, type ErrorCollector } from '@commons/frontend-utils/errorLog'
import { useUserStore } from '~/stores/user'

let collector: ErrorCollector | undefined

const disabledCollector: ErrorCollector = { enabled: false, capture: () => undefined, flush: async () => {} }

// Reads one cookie straight from `document.cookie`. The shared helpers use `useCookies()`, which
// registers a change listener (a `cookieStore` handler or a 300 ms poll) that is released only with a
// Vue scope; the collector runs outside any scope, so each read through them would leak one.
const readCookie = (name: string): string | undefined => {
  if (!name || typeof document === 'undefined') return undefined
  for (const part of document.cookie ? document.cookie.split(';') : []) {
    const index = part.indexOf('=')
    if (index < 0 || part.slice(0, index).trim() !== name) continue
    const raw = part.slice(index + 1).trim()
    try {
      return decodeURIComponent(raw) || undefined
    } catch {
      return raw || undefined
    }
  }
  return undefined
}

/** The page's error collector; a disabled no-op when the build has no ingestion endpoint or setup fails. */
export const useClientErrorLog = (): ErrorCollector => {
  if (collector) return collector
  try {
    const config = useRuntimeConfig().public
    const tokenCookie = typeof config.COOKIE_TOKEN_NAME === 'string' ? config.COOKIE_TOKEN_NAME.trim() : ''
    const isBridge = typeof location !== 'undefined' && location.pathname === '/x/ext-bridge'
    // The bridge runs in the Extension's iframe where cookies are unavailable; the page itself reads
    // this store for its bridge responses, so the collector reads the same source and never the payload.
    // The collector is created by a 'pre' plugin before Pinia exists, so the store is resolved per record.
    const bridgeUser = () => {
      try {
        const userStore = useUserStore()
        if (!userStore.userInfo) userStore.$hydrate()
        return userStore.userInfo?.userId
      } catch {
        return undefined
      }
    }
    const base = createErrorCollector({
      endpoint: import.meta.client ? String(config.CLIENT_ERROR_INGEST_URL || '') : '',
      app: 'web',
      release: String(config.appVersion || ''),
      env: String(config.slaxEnv || ''),
      getContext: () => ({ userId: isBridge ? bridgeUser() : getTokenUserId(readCookie(tokenCookie)), deviceId: readCookie('_su') ?? null })
    })
    collector = isBridge ? { ...base, capture: (kind, error, properties = {}) => base.capture(kind, error, { ...properties, surface: 'ext-bridge' }) } : base
  } catch {
    collector = disabledCollector
  }
  return collector
}
