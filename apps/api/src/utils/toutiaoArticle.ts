import { parseHTML } from 'linkedom'
import type { ToutiaoArticle } from '../const/moreapi/toutiao'
import { ToutiaoCaptureError } from './toutiaoUrl'
import { publicTarget } from './publicTargetPolicy'

const allowedTags = new Set([
  'p',
  'div',
  'span',
  'section',
  'article',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'figure',
  'figcaption',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'sup',
  'sub'
])
const dropTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'noscript', 'form', 'input', 'textarea', 'select', 'button', 'template'])
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Use an allowlist so scripts, CSS, event handlers and embedded executable documents cannot survive. */
export function sanitizeToutiaoBody(content: string, canonicalUrl: string): { body: string; text: string } {
  const { document } = parseHTML(`<html><head></head><body>${content}</body></html>`)
  for (const node of [...document.body.querySelectorAll('*')]) {
    const tag = node.localName.toLowerCase()
    if (dropTags.has(tag)) {
      node.remove()
      continue
    }
    if (!allowedTags.has(tag)) {
      node.replaceWith(...node.childNodes)
      continue
    }
    for (const attribute of node.getAttributeNames()) {
      const name = attribute.toLowerCase()
      const value = node.getAttribute(attribute) || ''
      if ((tag === 'a' && name === 'href') || (tag === 'img' && name === 'src')) {
        try {
          node.setAttribute(name, publicTarget(new URL(value, canonicalUrl)).href)
        } catch {
          node.removeAttribute(attribute)
        }
      } else if ((name === 'title' && tag === 'a') || (tag === 'img' && name === 'alt')) {
        // Plain text attributes are serialized by the DOM.
      } else if (tag === 'img' && (name === 'width' || name === 'height') && /^\d{1,5}$/.test(value)) {
        // Preserve bounded image dimensions.
      } else {
        node.removeAttribute(attribute)
      }
    }
  }
  return { body: document.body.innerHTML, text: document.body.innerText.trim() }
}

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
