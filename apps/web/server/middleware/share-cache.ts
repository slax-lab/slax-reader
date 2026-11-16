import { isServerTimingEnabled } from '../utils/serverTiming'
import { getResponseHeader } from 'h3'
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
  const timingEnabled = isServerTimingEnabled(event)
  const timings: Record<string, number> = {}
  const setLookupTiming = () => {
    if (!timingEnabled) return
    timings['cache-lookup'] = performance.now() - lookupStartedAt
    setResponseHeader(event, 'Timing-Allow-Origin', '*')
    const current = getResponseHeader(event, 'Server-Timing')
    const metrics = Object.entries(timings).map(([step, duration]) => `front_${step};dur=${Math.max(0, duration).toFixed(1)}`)
    setResponseHeader(event, 'Server-Timing', [current, ...metrics].filter(Boolean).join(', '))
  }

  const cache = getEdgeCache()
  if (!cache) {
    setLookupTiming()
    return
  }

  const backend = event.context.cloudflare?.env.BACKEND as unknown as Parameters<typeof matchesCurrentSnapshot>[1]

  const matchStartedAt = performance.now()
  const visitorCached = await cache.match(new Request(visitorKey(uuid)))
  timings['cache-match'] = performance.now() - matchStartedAt
  if (!visitorCached) {
    setLookupTiming()
    return
  }
  const validationStartedAt = performance.now()
  const valid = await matchesCurrentSnapshot(visitorCached, backend, uuid, undefined, 'visitor', timingEnabled ? value => setResponseHeader(event, 'Server-Timing', value) : undefined)
  timings['cache-validation'] = performance.now() - validationStartedAt
  if (!valid) {
    setLookupTiming()
    return
  }

  event.context.__isOwner = false
  setResponseHeader(event, 'content-type', visitorCached.headers.get('content-type') || 'text/html; charset=utf-8')
  setResponseHeader(event, 'x-bcache', 'hit')
  setResponseHeader(event, 'x-bcache-type', 'visitor')
  const bodyStartedAt = performance.now()
  const body = await visitorCached.text()
  timings['cache-body'] = performance.now() - bodyStartedAt
  setLookupTiming()
  return body
})
