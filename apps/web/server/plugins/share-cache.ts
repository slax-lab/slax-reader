import { SHARE_PATH } from '../utils/shareCache'

import { getRequestURL, setResponseHeader } from 'h3'

export default defineNitroPlugin(nitroApp => {
  nitroApp.hooks.hook('render:response', (response: unknown, ctx: { event?: unknown }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const event = ctx?.event as any
    if (!event) return
    if (!SHARE_PATH.test(getRequestURL(event).pathname)) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = response as any
    if (r?.statusCode !== 200 || typeof r?.body !== 'string') return

    // Do not cache `/b/<uuid>` HTML. The UUID is stable while body and Fork
    // attribution are versioned in the database/R2 publication path.
    setResponseHeader(event, 'cache-control', 'private, no-store')
  })
})
