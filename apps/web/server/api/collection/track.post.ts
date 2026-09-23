import { getUserAgent, isBotUserAgent, resolveVisitorId } from '../../utils/visitor'

import { getCookie, getHeader, getRequestURL, type H3Event, readBody, setResponseStatus } from 'h3'

// 星标合集观测：匿名侧事件入口，公开无鉴权
// 身份只从 cookie 取，不合规即静默 204

const EVENT_WHITELIST = new Set(['collection_share', 'collection_visit'])
// 与 visit-abort、后端 validator 同一口径
const CODE_RE = /^[a-zA-Z0-9]+$/
const MAX_CODE_LEN = 64
const MAX_ENTRY_PAGE = 10000

type TrackBody = {
  event?: string
  code?: string
  is_curator?: boolean
  entry_page?: number
}

const noContent = (event: H3Event) => {
  setResponseStatus(event, 204)
  return null
}

export default defineEventHandler(async event => {
  const body = await readBody<TrackBody>(event).catch(() => null)
  if (!body) return noContent(event)

  const name = typeof body.event === 'string' ? body.event : ''
  const code = typeof body.code === 'string' ? body.code : ''

  if (!EVENT_WHITELIST.has(name)) return noContent(event)
  if (!code || code.length > MAX_CODE_LEN || !CODE_RE.test(code)) return noContent(event)

  // 挡跨站刷量；Origin 缺失不算拒绝条件
  const origin = getHeader(event, 'origin')
  if (origin && origin !== getRequestURL(event).origin) return noContent(event)

  const config = useRuntimeConfig(event)
  const token = getCookie(event, config.public.COOKIE_TOKEN_NAME as string)

  // 缺 _su 不能拒，否则挡掉纯 SPA 的补埋
  const visitorId = resolveVisitorId(event)

  const extra: Record<string, unknown> = {}
  if (name === 'collection_visit') {
    // 必须与 SSR 通道一起写，否则分析侧
    // 一句 is_bot = false 会漏掉 spa 行
    extra.is_bot = isBotUserAgent(event)
    // 写死，否则 ssr/spa 维度不可信
    extra.via = 'spa'
    if (typeof body.is_curator === 'boolean') extra.is_curator = body.is_curator
    if (Number.isInteger(body.entry_page) && body.entry_page! >= 1 && body.entry_page! <= MAX_ENTRY_PAGE) extra.entry_page = body.entry_page
  }

  const backend = (event.context.cloudflare?.env as unknown as { BACKEND?: { trackEvent: (input: Record<string, unknown>) => Promise<void> } })?.BACKEND
  if (!backend) return noContent(event)

  event.context.cloudflare.context.waitUntil(
    Promise.resolve(backend.trackEvent({ event: name, target: code, token, visitorId, userAgent: getUserAgent(event), extra })).catch((err: unknown) =>
      console.error(`[collection] trackEvent ${name} ${code} failed:`, err)
    )
  )

  return noContent(event)
})
