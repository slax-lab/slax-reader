import { getTokenUserId } from '~/utils/sessionOwner'

import { createErrorCollector, type ErrorCollector } from '@commons/frontend-utils/errorLog'

let collector: ErrorCollector | undefined

const disabledCollector: ErrorCollector = { enabled: false, capture: () => {}, flush: async () => {} }

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
    collector = createErrorCollector({
      endpoint: import.meta.client ? String(config.CLIENT_ERROR_INGEST_URL || '') : '',
      app: 'web',
      release: String(config.appVersion || ''),
      env: String(config.slaxEnv || ''),
      getContext: () => ({ userId: getTokenUserId(readCookie(tokenCookie)), deviceId: readCookie('_su') ?? null })
    })
  } catch {
    collector = disabledCollector
  }
  return collector
}
