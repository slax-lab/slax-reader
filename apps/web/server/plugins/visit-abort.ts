import { getUserAgent, isBotUserAgent, resolveVisitorId } from '../utils/visitor'

const SHARE_PATH = /^\/b\/([^/]+)\/?$/
// code 段限定 [a-zA-Z0-9]+，与 track 端点、后端 validator 同一口径
// 照抄 /b 的 [^/]+ 会把 /c/%20 这类扫描请求也上报
const COLLECTION_PATH = /^\/c\/([a-zA-Z0-9]+)\/?$/
const CLIENT_CLOSED = 499
const CTX_START = '__visitStart'
const CTX_VISITOR = '__visitorId'
const CTX_REPORTED = '__visitReported'

type VisitTarget = { kind: 'share' | 'collection'; id: string }

function matchVisit(pathname: string): VisitTarget | null {
  const uuid = SHARE_PATH.exec(pathname)?.[1]
  if (uuid) return { kind: 'share', id: uuid }
  const code = COLLECTION_PATH.exec(pathname)?.[1]
  if (code) return { kind: 'collection', id: code }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reportVisit(event: any, target: VisitTarget, statusCode: number, isOwner?: boolean) {
  // 须早于 3xx 返回，否则 302 断连会补记
  if (event.context[CTX_REPORTED]) return
  event.context[CTX_REPORTED] = true

  // 越界 page 的 302 不记：否则一次点击算两条，抬高 UV 分母
  // /b 分支维持原状，避免改动存量口径
  if (target.kind === 'collection' && statusCode >= 300 && statusCode < 400) return

  const startedAt = (event.context[CTX_START] as number | undefined) ?? Date.now()
  const durationMs = Date.now() - startedAt
  // 原先硬编码 'token'，beta 环境全被记成匿名
  const token = getCookie(event, useRuntimeConfig(event).public.COOKIE_TOKEN_NAME as string)
  const visitorId = event.context[CTX_VISITOR] as string | undefined

  const cf = event.context.cloudflare
  if (!cf?.env?.BACKEND) return

  const userAgent = getUserAgent(event)

  if (target.kind === 'share') {
    cf.context.waitUntil(
      Promise.resolve(cf.env.BACKEND.trackEvent({ event: 'visit', target: target.id, token, visitorId, userAgent, durationMs, statusCode, isOwner })).catch(
        (err: unknown) => console.error(`[visit] trackEvent visit ${target.id} failed:`, err)
      )
    )
    return
  }

  // entry_page 表示「从第几页进来」，不是翻页深度 —— 翻页是客户端 useAsyncData，不会再产生 SSR 请求
  const pageNum = Number(getQuery(event).page)
  const entryPage = Number.isInteger(pageNum) && pageNum >= 1 ? pageNum : 1
  const isCurator = (event.context as Record<string, unknown>).__isCurator as boolean | undefined
  const isBot = isBotUserAgent(event)

  cf.context.waitUntil(
    Promise.resolve(
      cf.env.BACKEND.trackEvent({
        event: 'collection_visit',
        target: target.id,
        token,
        visitorId,
        userAgent,
        durationMs,
        statusCode,
        extra: { entry_page: entryPage, is_curator: isCurator, is_bot: isBot, via: 'ssr' }
      })
    ).catch((err: unknown) => console.error(`[visit] trackEvent collection_visit ${target.id} failed:`, err))
  )
}

export default defineNitroPlugin(nitroApp => {
  nitroApp.hooks.hook('request', event => {
    if (event.method !== 'GET') return
    const target = matchVisit(getRequestURL(event).pathname)
    if (!target) return

    event.context[CTX_START] = Date.now()
    event.context[CTX_VISITOR] = resolveVisitorId(event)

    const signal: AbortSignal | undefined = (event.context.cloudflare as any)?.request?.signal
    signal?.addEventListener('abort', () => reportVisit(event, target, CLIENT_CLOSED), { once: true })
  })

  nitroApp.hooks.hook('afterResponse', event => {
    // 非 GET 打不到页面，不该记访问
    if (event.method !== 'GET') return
    const target = matchVisit(getRequestURL(event).pathname)
    if (!target) return
    const isOwner = (event.context as Record<string, unknown>).__isOwner as boolean | undefined
    reportVisit(event, target, event.node.res.statusCode || 200, isOwner)
  })

  nitroApp.hooks.hook('error', (error: any, ctx: any) => {
    const event = ctx?.event
    if (!event || event.method !== 'GET') return
    const target = matchVisit(getRequestURL(event).pathname)
    if (target) reportVisit(event, target, error?.statusCode ?? 500)
  })
})
