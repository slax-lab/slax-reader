import type { ToutiaoArticle } from '../const/moreapi/toutiao'
import { ToutiaoCaptureError } from './toutiaoUrl'
import { sanitizeArticleBody as sanitizeToutiaoBody } from './articleBody'
export { sanitizeToutiaoBody }

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function buildToutiaoArticle(input: {
  articleId: string
  canonicalUrl: string
  title: string
  author: string
  content: string
  publishStamp?: string | number
}): ToutiaoArticle {
  const { body, text } = sanitizeToutiaoBody(input.content, input.canonicalUrl)
  if (!text || /^(?:该内容已删除|该文章已删除|内容已删除|文章已删除)[。！!]?$/u.test(text)) throw new ToutiaoCaptureError('Toutiao article body is empty or deleted')
  const seconds = typeof input.publishStamp === 'number' ? input.publishStamp : /^\d+(?:\.\d+)?$/.test(input.publishStamp ?? '') ? Number(input.publishStamp) : NaN
  const date = new Date(seconds * 1000)
  const publishedAt = Number.isFinite(seconds) && seconds > 0 && !Number.isNaN(date.valueOf()) ? date.toISOString() : undefined
  const title = input.title.trim() || `Toutiao article ${input.articleId}`
  const author = input.author.trim()
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><meta name="author" content="${escapeHtml(author)}"><meta property="og:site_name" content="Toutiao">${publishedAt ? `<meta property="article:published_time" content="${publishedAt}">` : ''}</head><body><article><h1>${escapeHtml(title)}</h1>${body}</article></body></html>`
  return { articleId: input.articleId, canonicalUrl: input.canonicalUrl, title, author, siteName: 'Toutiao', publishedAt, html, text }
}
