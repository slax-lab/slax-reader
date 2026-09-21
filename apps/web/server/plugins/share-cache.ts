import { BCACHE_MAX_AGE, getEdgeCache, OWNER_UID_HEADER, ownerKey, SHARE_PATH, visitorKey } from '../utils/shareCache'

export default defineNitroPlugin(nitroApp => {
  nitroApp.hooks.hook('render:response', (response: unknown, ctx: { event?: unknown }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const event = ctx?.event as any
    if (!event) return
    const uuid = SHARE_PATH.exec(getRequestURL(event).pathname)?.[1]
    if (!uuid) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = response as any
    if (r?.statusCode !== 200 || typeof r?.body !== 'string') return

    const cache = getEdgeCache()
    if (!cache) return

    const isOwner = !!event.context.__isOwner
    const bcacheType = isOwner ? 'owner' : 'visitor'
    setResponseHeader(event, 'x-bcache', 'store')
    setResponseHeader(event, 'x-bcache-type', bcacheType)

    const headers = new Headers()
    headers.set('content-type', (r.headers?.['content-type'] as string) || 'text/html; charset=utf-8')
    headers.set('cache-control', `public, max-age=${BCACHE_MAX_AGE}`)
    headers.set('x-bcache-type', bcacheType)
    const ownerUid = String(event.context.__ownerUid ?? '')
    if (ownerUid) headers.set(OWNER_UID_HEADER, ownerUid)

    let key: string
    if (isOwner) {
      key = ownerKey(uuid)
    } else {
      key = visitorKey(uuid)
    }

    const p = cache.put(new Request(key), new Response(r.body, { status: 200, headers }))
    const cfCtx = event.context.cloudflare?.context
    if (cfCtx?.waitUntil) cfCtx.waitUntil(p)
    else void p.catch(() => {})
  })
})
