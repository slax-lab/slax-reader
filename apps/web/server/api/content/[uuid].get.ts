import { loadContent } from '../../utils/loadContent'

import { setResponseHeader } from 'h3'

export default defineEventHandler(async event => {
  const uuid = event.context.params?.uuid
  if (!uuid) throw createError({ statusCode: 400, message: 'missing uuid' })

  const result = await loadContent(event, uuid)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return result
})
