import { getDeviceId, getUserToken } from '~/utils/request'
import { getTokenUserId } from '~/utils/sessionOwner'

import { createErrorCollector, type ErrorCollector } from '@commons/frontend-utils/errorLog'

let collector: ErrorCollector | undefined

/** The page's error collector; a disabled no-op when the build has no ingestion endpoint. */
export const useClientErrorLog = (): ErrorCollector => {
  if (collector) return collector
  const config = useRuntimeConfig().public
  collector = createErrorCollector({
    endpoint: import.meta.client ? String(config.CLIENT_ERROR_INGEST_URL || '') : '',
    app: 'web',
    release: String(config.appVersion || ''),
    env: String(config.slaxEnv || ''),
    getContext: () => {
      try {
        return { userId: getTokenUserId(getUserToken()), deviceId: getDeviceId() }
      } catch {
        return {}
      }
    }
  })
  return collector
}
