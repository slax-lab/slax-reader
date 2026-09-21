import { loadCollection } from '../../utils/loadCollection'

export default defineEventHandler(async event => {
  const code = event.context.params?.code
  if (!code) throw createError({ statusCode: 400, message: 'missing code' })

  // page 严格正整数，否则回落 1
  const n = Number(getQuery(event).page)
  const page = Number.isInteger(n) && n >= 1 ? n : 1

  return await loadCollection(event, code, page)
})
