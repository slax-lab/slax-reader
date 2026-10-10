import { isPdfContentKey, pdfByteRange, pdfResponseHeaders } from '@slax-reader/contracts/pdf'

export default defineEventHandler(async event => {
  if (!['GET', 'HEAD'].includes(event.method)) throw createError({ statusCode: 405 })
  const uuid = event.context.params?.uuid
  if (!uuid) throw createError({ statusCode: 400 })
  const { OSS, BACKEND } = event.context.cloudflare.env as unknown as { OSS: R2Bucket; BACKEND: Fetcher }
  const config = useRuntimeConfig(event)
  const token = getCookie(event, config.public.COOKIE_TOKEN_NAME as string)
  const response = await BACKEND.fetch(`https://content.internal/content/meta?uuid=${encodeURIComponent(uuid)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  if (!response.ok) throw createError({ statusCode: response.status })
  const metadata = await response.json() as { content_key?: string }
  if (!isPdfContentKey(metadata.content_key)) throw createError({ statusCode: 404 })
  const object = await OSS.head(metadata.content_key!)
  if (!object) throw createError({ statusCode: 404 })
  let range: ReturnType<typeof pdfByteRange>
  try { range = pdfByteRange(getHeader(event, 'range') || null, object.size) }
  catch {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${object.size}`, 'Cache-Control': 'private, no-store' } })
  }
  const headers = pdfResponseHeaders(object.customMetadata?.filename || 'document.pdf', object.size, range)
  if (event.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers })
  const body = await OSS.get(metadata.content_key!, range ? { range } : undefined)
  if (!body) throw createError({ statusCode: 404 })
  return new Response(body.body, { status: range ? 206 : 200, headers })
})
