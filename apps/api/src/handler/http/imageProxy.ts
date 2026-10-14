import { ContextManager } from '@/utils/context'
import { isValidReferer } from '@/middleware/cors'
import { getImageProxyHeaders } from '@/utils/imager'
import { RequestUtils } from '@/utils/requestUtils'
import { Failed, NotFound, responseImage, responseRedirect, isSafeImageMime, isSafeMediaMime } from '@/utils/responseUtils'
import { hashMD5, hashSHA256 } from '@/utils/strings'
import { publicFetch } from '@/utils/publicFetch'
import { publicTarget } from '@/utils/publicTargetPolicy'

const maxImageBytes = 3 * 1024 * 1024
const maxTrustedImageBytes = 20 * 1024 * 1024

const isSafeRange = (range: string): boolean => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match || (!match[1] && !match[2])) return false
  const start = match[1] ? Number(match[1]) : undefined
  const end = match[2] ? Number(match[2]) : undefined
  if ((start !== undefined && !Number.isSafeInteger(start)) || (end !== undefined && !Number.isSafeInteger(end))) return false
  return start === undefined ? end! > 0 : end === undefined || end >= start
}

const readImage = async (body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | null> => {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function handleImageProxy(ctx: ContextManager, request: Request): Promise<Response> {
  const params = await RequestUtils.query<{ u: string; r: string; d: string; m?: string }>(request)
  if (!params?.u) return Failed(NotFound('action not found'))
  if (!params.d) return new Response(null, { status: 403 })

  if (params.m && params.m !== 'rss') return new Response(null, { status: 400 })
  const rss = params.m === 'rss'
  const checkDigest = (await hashMD5(params.u + params.r + ctx.env.IMAGER_CHECK_DIGST_SALT + (params.m || ''))) === params.d
  const validReferer = isValidReferer(request.headers.get('Referer') || '', ctx.env.FRONT_END_URL)
  if (!ctx.env.IMAGER_CHECK_DIGST_SALT || !checkDigest || !validReferer) return new Response(null, { status: 403 })

  let sourceUrl: string
  try {
    sourceUrl = publicTarget(decodeURIComponent(params.u)).href
  } catch {
    return new Response(null, { status: 400 })
  }

  const range = request.headers.get('Range')
  if ((rss && range !== null) || (range !== null && !isSafeRange(range))) return new Response(null, { status: 400 })
  const cache = typeof caches !== 'undefined' ? caches.default : undefined
  const cacheKey = new Request(request.url, { method: 'GET' })
  const cached = !range && cache ? await cache.match(cacheKey) : undefined
  if (cached) {
    if (!(rss ? isSafeImageMime : isSafeMediaMime)(cached.headers.get('Content-Type') || '')) {
      await cached.body?.cancel()
      return new Response(null, { status: 415 })
    }
    if (rss && cached.status === 200 && cached.body) {
      const bytes = await readImage(cached.body, maxImageBytes)
      return bytes ? responseImage(bytes, cached.headers.get('Content-Type') || '', true) : new Response(null, { status: 413 })
    }
    if (cached.status === 200 && cached.body) return responseImage(cached.body, cached.headers.get('Content-Type')!, true, 200, cached.headers)
    await cached.body?.cancel()
  }

  const fileKey = `${rss ? 'rss-image' : 'image'}/${await hashSHA256(params.u)}`
  const object = range ? null : await ctx.env.OSS.get(fileKey)
  if (rss && object && (object.size > maxImageBytes || !isSafeImageMime(object.httpMetadata?.contentType || ''))) {
    await object.body.cancel()
    return new Response(null, { status: 415 })
  }
  if (object && !object.customMetadata?.large) return responseImage(object.body, object.httpMetadata?.contentType || '', true)
  await object?.body.cancel()

  const headers = new Headers(getImageProxyHeaders(sourceUrl, params.r, request.headers))
  headers.set('Accept-Encoding', 'identity')
  if (range) headers.set('Range', range)
  let imageResponse: Response
  try {
    imageResponse = await publicFetch(sourceUrl, { method: request.method, headers }, { maxBytes: rss ? maxImageBytes : 128 * 1024 * 1024, timeoutMs: rss ? 30_000 : 120_000 })
  } catch {
    return new Response(null, { status: 502 })
  }

  if (range && imageResponse.status === 416) {
    await imageResponse.body?.cancel()
    const headers = new Headers({ 'Cache-Control': 'no-store' })
    const contentRange = imageResponse.headers.get('Content-Range')
    if (contentRange && /^bytes \*\/\d+$/.test(contentRange)) headers.set('Content-Range', contentRange)
    return new Response(null, { status: 416, headers })
  }
  if (!imageResponse.ok || imageResponse.body == null) {
    if (!rss) console.log(`fetch image ${sourceUrl} failed, status: ${imageResponse.status}`)
    await imageResponse.body?.cancel()
    return rss ? new Response(null, { status: 502 }) : responseRedirect(ctx.env.IMAGE_PREFIX + 'notfound.png')
  }

  const imageMime = imageResponse.headers.get('Content-Type') || ''
  if (!(rss ? isSafeImageMime : isSafeMediaMime)(imageMime) || (rss && imageResponse.status !== 200)) {
    await imageResponse.body.cancel()
    return new Response(null, { status: 415 })
  }
  if (range || imageResponse.status === 206 || !isSafeImageMime(imageMime)) {
    return responseImage(imageResponse.body, imageMime, false, imageResponse.status, imageResponse.headers)
  }

  const hostname = new URL(imageResponse.url || sourceUrl).hostname
  const trustedImage = ['mmbiz.qpic.cn', 'xhscdn.com', 'twimg.com'].some(host => hostname === host || hostname.endsWith(`.${host}`))
  let body: Uint8Array | null
  try {
    body = await readImage(imageResponse.body, !rss && trustedImage ? maxTrustedImageBytes : maxImageBytes)
  } catch {
    return new Response(null, { status: 502 })
  }
  if (!body) return rss ? new Response(null, { status: 413 }) : responseRedirect(sourceUrl)

  ctx.execution.waitUntil(ctx.env.OSS.put(fileKey, body, { httpMetadata: { contentType: imageMime } }).catch(error => console.error(`Error storing in R2: ${error}`)))
  const response = responseImage(body, imageMime, true)
  response.headers.set('Content-Length', String(body.byteLength))
  if (cache) ctx.execution.waitUntil(cache.put(cacheKey, response.clone()))
  return response
}
