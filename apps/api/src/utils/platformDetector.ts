/**
 * 集中管理各社交媒体平台的 URL 匹配正则。
 * 所有需要按 URL 判断平台的地方都应引用此模块，避免正则分散在多个文件中漂移。
 */

export type RouteKind = 'twitter' | 'twitter_article' | 'xhs' | 'weibo' | 'reddit' | 'zhihu' | 'weixin' | 'youtube' | 'regular'

/** Twitter 推文页（/status/数字ID） */
export const TWITTER_STATUS_RE = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/\w+\/status\/\d+/

/** Twitter 文章页（/article/数字ID） */
export const TWITTER_ARTICLE_RE = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/\w+\/article\/\d+/

/** Twitter 短链形式（/i/status/数字ID，需要解析真实作者） */
export const TWITTER_SHORT_STATUS_RE = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/status\/\d+/

/** 小红书笔记页 */
export const XHS_RE = /https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery)\/[a-zA-Z0-9]+/

/** 微博 — 桌面端 */
export const WEIBO_DESKTOP_RE = /https?:\/\/(?:www\.)?weibo\.com\/\d+\/[a-zA-Z0-9]+/

/** 微博 — 移动端 */
export const WEIBO_MOBILE_RE = /https?:\/\/m\.weibo\.cn\/(?:status|detail)\/\d+/

/** Reddit 帖子 */
export const REDDIT_RE = /https?:\/\/(?:www\.)?reddit\.com\/r\/\w+\/comments\//

/** 知乎公开内容：问题、回答、专栏文章、想法 */
export const ZHIHU_RE = /https?:\/\/(?:www\.)?(?:zhihu\.com\/(?:question\/\d+(?:\/answer\/\d+)?|answer\/\d+|pin\/\d+)|zhuanlan\.zhihu\.com\/(?:p|appview\/p)\/\d+)/

/** 微信公众号文章：覆盖 /s?__biz=... 与 /s/xxxx 两种形态 */
export const WECHAT_MP_RE = /https?:\/\/mp\.weixin\.qq\.com\/s(?:\/|\?)/

/** YouTube 域名粗匹配（youtube.com / youtu.be，含 www/m/music 子域） */
export const YOUTUBE_RE = /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i

/** YouTube videoId 校验：11 位 [A-Za-z0-9_-] */
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

export function extractYoutubeVideoId(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }

  const host = u.hostname.replace(/^www\./, '')
  const valid = (id: string | null | undefined) => (id && YOUTUBE_VIDEO_ID_RE.test(id) ? id : null)

  // youtu.be/ID
  if (host === 'youtu.be') {
    return valid(u.pathname.split('/').filter(Boolean)[0])
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    // watch?v=ID
    if (u.pathname === '/watch') {
      return valid(u.searchParams.get('v'))
    }
    // /shorts/ID、/embed/ID、/live/ID
    const segs = u.pathname.split('/').filter(Boolean)
    if (segs.length >= 2 && (segs[0] === 'shorts' || segs[0] === 'embed' || segs[0] === 'live')) {
      return valid(segs[1])
    }
  }

  return null
}

export function normalizeYoutubeUrl(url: string): string {
  const id = extractYoutubeVideoId(url)
  return id ? `https://www.youtube.com/watch?v=${id}` : url
}

/** 社交媒体域名粗匹配（用于快速判断是否属于社交媒体平台） */
export const SOCIAL_MEDIA_DOMAIN_RE = /https?:\/\/(?:www\.)?(?:(?:x|twitter|xiaohongshu|weibo|reddit|zhihu)\.com|zhuanlan\.zhihu\.com)/

const SOCIAL_MEDIA_ROUTES: RouteKind[] = ['twitter', 'twitter_article', 'xhs', 'weibo', 'reddit', 'zhihu']

/**
 * 根据 URL 判断应走的抓取路由。
 */
export function detectRoute(url: string): RouteKind {
  if (TWITTER_ARTICLE_RE.test(url)) return 'twitter_article'
  if (TWITTER_STATUS_RE.test(url)) return 'twitter'
  if (XHS_RE.test(url)) return 'xhs'
  if (WEIBO_DESKTOP_RE.test(url) || WEIBO_MOBILE_RE.test(url)) return 'weibo'
  if (REDDIT_RE.test(url)) return 'reddit'
  if (ZHIHU_RE.test(url)) return 'zhihu'
  if (WECHAT_MP_RE.test(url)) return 'weixin'
  if (extractYoutubeVideoId(url)) return 'youtube'
  return 'regular'
}

/** 判断路由是否属于社交媒体 */
export function isSocialMediaRoute(route: RouteKind): boolean {
  return SOCIAL_MEDIA_ROUTES.includes(route)
}

/** 判断 URL 是否属于社交媒体域名（粗匹配） */
export function isSocialMediaUrl(url: string): boolean {
  return SOCIAL_MEDIA_DOMAIN_RE.test(url)
}

/** 判断 URL 是否需要预解析（如 Twitter /i/status/ 短链） */
export function needsResolve(url: string): boolean {
  return TWITTER_SHORT_STATUS_RE.test(url)
}
