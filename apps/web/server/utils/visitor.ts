import { getCookie, getRequestHeader, type H3Event, setCookie } from 'h3'

// 匿名访客身份与 bot 判定唯一来源
// SSR、SPA 两处铸 _su，勿各写一份

export const SU_COOKIE = '_su'
export const SU_MAX_AGE = 31536000 // 365 天

// strict 跨站导航不发送，会每次重铸 id
// dev 关 secure，否则 http 下被丢弃
const SU_COOKIE_OPTIONS = { sameSite: 'lax', maxAge: SU_MAX_AGE } as const

/** 取 _su，缺失则铸一个并下发 */
export function resolveVisitorId(event: H3Event): string {
  const existing = getCookie(event, SU_COOKIE)
  if (existing) return existing

  const visitorId = `${crypto.randomUUID().replaceAll('-', '')}.${Date.now()}`
  setCookie(event, SU_COOKIE, visitorId, { ...SU_COOKIE_OPTIONS, secure: !import.meta.dev })
  return visitorId
}

const BOT_UA =
  /bot\b|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|embedly|showyoubot|outbrain|pinterest|vkshare|w3c_validator|whatsapp|telegrambot|semrush|ahrefs|petalbot|bytespider|gptbot|claudebot|ccbot|perplexity|headlesschrome/i

/** UA 是否为爬虫，仅供分析侧过滤 */
export function isBotUserAgent(event: H3Event): boolean {
  return BOT_UA.test(getRequestHeader(event, 'user-agent') || '')
}

// 后端按 UA 判 platform，RPC 不带原请求头，须显式转发
export function getUserAgent(event: H3Event): string | undefined {
  return getRequestHeader(event, 'user-agent') || undefined
}
