import { createError, getCookie, type H3Event, setResponseHeader } from 'h3'

// 后端 userShareCollectInfo 原样透传
export type CollectionInfoResult = Record<string, unknown>

// 内部 content 通道，带 x-slax-token
export async function loadCollection(event: H3Event, code: string, page: number): Promise<CollectionInfoResult> {
  // 窄化取 BACKEND，绕开 cloudflare.env 递归类型
  const { BACKEND } = event.context.cloudflare.env as unknown as { BACKEND: { fetch: (input: string, init?: RequestInit) => Promise<Response> } }
  const config = useRuntimeConfig(event)
  const token = getCookie(event, config.public.COOKIE_TOKEN_NAME as string)

  const headers: Record<string, string> = {}
  // 透传 token→is_owner；匿名走公开读
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    // 传 URL 字符串+init，勿传 Request
    response = await BACKEND.fetch(`https://content.internal/content/collection?collect_code=${encodeURIComponent(code)}&page=${page}`, { headers })
  } catch (error) {
    console.error(`[collection] get ${code} failed via BACKEND.fetch:`, error)
    throw createError({ statusCode: 502, message: 'collection upstream error' })
  }

  const serverTiming = response.headers.get('Server-Timing')
  if (serverTiming) setResponseHeader(event, 'Server-Timing', serverTiming)

  // 404→notFound；其它非 2xx→502
  if (response.status === 404) throw createError({ statusCode: 404, message: 'not found' })
  if (!response.ok) throw createError({ statusCode: 502, message: 'collection upstream error' })

  return (await response.json()) as CollectionInfoResult
}
