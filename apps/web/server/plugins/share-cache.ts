import { BCACHE_MAX_AGE, getEdgeCache, hasSnapshotCredentials, SHARE_PATH, SNAPSHOT_REVISION_HEADER, snapshotMetadataRevision, visitorKey } from '../utils/shareCache'

export default defineNitroPlugin(nitroApp => {
  nitroApp.hooks.hook('render:response', async (response: unknown, ctx: { event?: unknown }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const event = ctx?.event as any
    if (!event) return
    const uuid = SHARE_PATH.exec(getRequestURL(event).pathname)?.[1]
    if (!uuid) return
    if (hasSnapshotCredentials(event, String(useRuntimeConfig(event).public.COOKIE_TOKEN_NAME))) {
      setResponseHeader(event, 'Cache-Control', 'private, no-store')
      const headers = (response as { headers?: Record<string, string> }).headers
      if (headers) headers['cache-control'] = 'private, no-store'
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = response as any
    if (r?.statusCode !== 200 || typeof r?.body !== 'string') return

    const cache = getEdgeCache()
    if (!cache || !event.context.__snapshotCacheMetadata) return

    if (event.context.__isOwner) return
    const bcacheType = 'visitor'
    setResponseHeader(event, 'x-bcache', 'store')
    setResponseHeader(event, 'x-bcache-type', bcacheType)

    const headers = new Headers()
    headers.set('content-type', (r.headers?.['content-type'] as string) || 'text/html; charset=utf-8')
    headers.set('cache-control', `public, max-age=${BCACHE_MAX_AGE}`)
    headers.set('x-bcache-type', bcacheType)
    headers.set(SNAPSHOT_REVISION_HEADER, await snapshotMetadataRevision(event.context.__snapshotCacheMetadata))
    const p = cache.put(new Request(visitorKey(uuid)), new Response(r.body, { status: 200, headers }))
    const cfCtx = event.context.cloudflare?.context
    if (cfCtx?.waitUntil) cfCtx.waitUntil(p)
    else void p.catch(() => {})
  })
})
