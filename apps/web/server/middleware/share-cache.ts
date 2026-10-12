import { isServerTimingEnabled } from '../utils/serverTiming'
import { canUseVisitorCache, getEdgeCache, OWNER_UID_HEADER, ownerKey, SHARE_PATH, viewerId, visitorKey } from '../utils/shareCache'

export default defineEventHandler(async event => {
  if (event.method !== 'GET') return
  const uuid = SHARE_PATH.exec(getRequestURL(event).pathname)?.[1]
  if (!uuid) return

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

  const config = useRuntimeConfig(event)
  const tokenCookieName = config.public.COOKIE_TOKEN_NAME as string
  const vid = viewerId(getCookie(event, tokenCookieName) || undefined)

  if (vid) {
    const ownerCached = await cache.match(new Request(ownerKey(uuid)))
    if (ownerCached && ownerCached.headers.get(OWNER_UID_HEADER) === vid) {
      event.context.__isOwner = true
      setResponseHeader(event, 'content-type', ownerCached.headers.get('content-type') || 'text/html; charset=utf-8')
      setResponseHeader(event, 'x-bcache', 'hit')
      setResponseHeader(event, 'x-bcache-type', 'owner')
      setLookupTiming()
      removeResponseHeader(event, OWNER_UID_HEADER)
      return await ownerCached.text()
    }
  }

  const visitorCached = await cache.match(new Request(visitorKey(uuid)))
  if (!visitorCached) {
    setLookupTiming()
    return
  }
  if (!canUseVisitorCache(vid, visitorCached.headers.get(OWNER_UID_HEADER))) {
    setLookupTiming()
    return
  }

  event.context.__isOwner = false
  setResponseHeader(event, 'content-type', visitorCached.headers.get('content-type') || 'text/html; charset=utf-8')
  setResponseHeader(event, 'x-bcache', 'hit')
  setResponseHeader(event, 'x-bcache-type', 'visitor')
  setLookupTiming()
  removeResponseHeader(event, OWNER_UID_HEADER)
  return await visitorCached.text()
})
