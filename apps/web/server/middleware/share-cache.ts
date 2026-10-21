import { SHARE_PATH } from '../utils/shareCache'

import { defineEventHandler, getRequestURL, setResponseHeader } from 'h3'

export default defineEventHandler(async event => {
  if (event.method !== 'GET' || !SHARE_PATH.test(getRequestURL(event).pathname)) return
  // `/b/<uuid>` is a stable user-bookmark URL. A direct capture or Fork can
  // publish new R2 keys under the same UUID, so an HTML edge cache keyed only
  // by UUID would serve stale content and stale attribution. Keep this
  // middleware as an explicit bypass until a revision-aware cache exists.
  setResponseHeader(event, 'cache-control', 'private, no-store')
})
