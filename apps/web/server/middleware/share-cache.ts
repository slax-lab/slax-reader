import { isServerTimingEnabled } from '../utils/serverTiming'
import { getEdgeCache, hasSnapshotCredentials, matchesCurrentSnapshot, SHARE_PATH, visitorKey } from '../utils/shareCache'

export default defineEventHandler(async event => {
  if (event.method !== 'GET') return
  const uuid = SHARE_PATH.exec(getRequestURL(event).pathname)?.[1]
  if (!uuid) return
  if (hasSnapshotCredentials(event, String(useRuntimeConfig(event).public.COOKIE_TOKEN_NAME))) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    return
  }

  const lookupStartedAt = performance.now()
  const setLookupTiming = () => {
    if (!isServerTimingEnabled(event)) return
    const duration = Math.max(0, performance.now() - lookupStartedAt).toFixed(1)
    setResponseHeader(event, 'Timing-Allow-Origin', '*')
    setResponseHeader(event, 'Server-Timing', `front_cache-lookup;dur=${duration}`)
  }

  const cache = getEdgeCache()
  if (!cache) {
    setLookupTiming()
    return
  }

  const backend = event.context.cloudflare?.env.BACKEND as unknown as Parameters<typeof matchesCurrentSnapshot>[1]

  const visitorCached = await cache.match(new Request(visitorKey(uuid)))
  if (!visitorCached) {
    setLookupTiming()
    return
  }
  if (!(await matchesCurrentSnapshot(visitorCached, backend, uuid, undefined, 'visitor'))) {
    setLookupTiming()
    return
  }

  event.context.__isOwner = false
  setResponseHeader(event, 'content-type', visitorCached.headers.get('content-type') || 'text/html; charset=utf-8')
  setResponseHeader(event, 'x-bcache', 'hit')
  setResponseHeader(event, 'x-bcache-type', 'visitor')
  setLookupTiming()
  return await visitorCached.text()
})
