import { loadContent } from '../../utils/loadContent'

export default defineEventHandler(async event => {
  const uuid = event.context.params?.uuid
  if (!uuid) throw createError({ statusCode: 400, message: 'missing uuid' })

  return await loadContent(event, uuid)
})
