// 推文正文 → HTML：照 Twitter 网页版的做法
// - entities.urls 里的 t.co 换成 <a href=expanded_url>display_url</a>
// - 图片 / 视频对应的 t.co 不显示（媒体已在卡片里）
// - 引用推文的 t.co 在引用卡片已渲染时不显示
// - 其余文本转义；\n 原样保留，由前端 whitespace-pre-line 渲染
// indices 按 Unicode 码点计，所以先把正文拆成码点数组再切片
import type { TweetInfo } from '@/const/twitterapi/struct'
import { escapeHtml, escAttr } from '@/utils/escape'

type Segment = { start: number; end: number; html: string }

const link = (href: string, label: string): string => `<a href="${escAttr(href)}" rel="noopener">${escapeHtml(label)}</a>`

const BARE_URL_RE = /https?:\/\/[^\s<]+/g

// entities 缺失时的备用做法：转义全文后把裸 URL 包成链接
const linkifyBare = (text: string): string =>
  escapeHtml(text).replace(BARE_URL_RE, m => {
    const raw = m
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
    return link(raw, raw)
  })

export const renderTweetText = (item: TweetInfo, hasQuoteCard: boolean): string => {
  const text = (item.text || '').trim()
  // 只有 entities 整个缺失才走备用做法；urls 为空数组是正常情况（比如只有媒体）
  if (!item.entities) {
    return linkifyBare(text)
  }
  const urls = item.entities.urls || []

  const chars = Array.from(text)
  const quotedId = hasQuoteCard ? item.quoted_tweet?.id : undefined
  const segments: Segment[] = []

  for (const u of urls) {
    const [start, end] = u.indices || []
    const hideAsQuote = !!quotedId && !!u.expanded_url && u.expanded_url.includes(`/status/${quotedId}`)
    segments.push({ start, end, html: hideAsQuote ? '' : link(u.expanded_url || u.url, u.display_url || u.expanded_url || u.url) })
  }
  for (const m of item.extendedEntities?.media || []) {
    const [start, end] = m.indices || []
    segments.push({ start, end, html: '' })
  }

  segments.sort((a, b) => a.start - b.start)

  let out = ''
  let cursor = 0
  for (const seg of segments) {
    // 越界或与前一段重叠的跳过
    if (!Number.isInteger(seg.start) || !Number.isInteger(seg.end) || seg.start < cursor || seg.end > chars.length || seg.end <= seg.start) continue
    out += escapeHtml(chars.slice(cursor, seg.start).join(''))
    out += seg.html
    cursor = seg.end
  }
  out += escapeHtml(chars.slice(cursor).join(''))

  return out.trim()
}
