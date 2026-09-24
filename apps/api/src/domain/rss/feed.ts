import { DOMParser } from 'linkedom'
import { publicFetch } from '@/utils/publicFetch'
import { publicTarget } from '@/utils/publicTargetPolicy'
import { hashSHA256 } from '@/utils/strings'
import { processTargetUrl } from '@/utils/urlPolicie'
import type { RssErrorCode } from '@slax-reader/contracts'
import { SlaxFetch } from '@/infra/external/remoteFetcher'

export const RSS_LIMITS = { subscriptions: 20, entries: 200, historyPages: 1000, retentionDays: 30, bytes: 5 * 1024 * 1024, intervalMs: 30 * 60_000, cooldownMs: 5 * 60_000 }
export class RssError extends Error {
  constructor(
    public code: RssErrorCode,
    public status = 400,
    public nextAllowedAt?: Date
  ) {
    super(code)
  }
}
export interface FeedItem {
  entry_key: string
  article_url: string | null
  title: string
  author: string | null
  summary: string
  content_html: string
  content_truncated: boolean
  image_url: string | null
  published_at: Date | null
}
export interface ParsedFeed {
  title: string
  site_url: string | null
  next_url?: string | null
  items: FeedItem[]
}
export type FeedResult = { unchanged: true } | { unchanged: false; feed: ParsedFeed; etag: string | null; lastModified: string | null }

export function normalizeFeedUrl(input: string): string {
  if (typeof input !== 'string' || input.length > 2048) throw new RssError('unsafe_url')
  try {
    const url = publicTarget(input.trim()).href
    if (url.length > 2048) throw new RssError('unsafe_url')
    return url
  } catch {
    throw new RssError('unsafe_url')
  }
}
export function safeFeedUrl(value: string | null | undefined, base: string): string | null {
  if (!value?.trim() || value.length > 8192) return null
  try {
    return publicTarget(new URL(value.trim(), base)).href
  } catch {
    return null
  }
}
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const name = (node: Element) => node.localName.toLowerCase().split(':').pop()!
const children = (node: Element, tag: string) => Array.from(node.children).filter(el => name(el) === tag)
const child = (node: Element, tag: string) => children(node, tag)[0]
const value = (node: Element, tag: string) => child(node, tag)?.textContent?.trim() || ''
const textOnly = (html: string) => new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').documentElement.textContent || ''

/** Rebuild markup from allowed nodes; no untrusted attribute or serialized source node is returned. */
export function sanitizeFeedHtml(html: string, base: string): { html: string; text: string; image: string | null; truncated: boolean } {
  const doc = new DOMParser().parseFromString(`<div>${html.slice(0, 512 * 1024)}</div>`, 'text/html')
  const allowed = new Set([
    'p',
    'div',
    'span',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'br',
    'hr',
    'figure',
    'figcaption',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td'
  ])
  const drop = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'form', 'input', 'button', 'link', 'meta', 'base', 'video', 'audio'])
  let nodes = 0,
    budget = 220 * 1024,
    image: string | null = null,
    truncated = html.length > 512 * 1024
  const render = (node: Node, depth: number): string => {
    if (++nodes > 4000 || depth > 32 || budget <= 0) {
      truncated = true
      return ''
    }
    if (node.nodeType === 3 || node.nodeType === 4) {
      const encoded = escape(node.textContent || '')
      if (encoded.length > budget) {
        truncated = true
        return ''
      }
      budget -= encoded.length
      return encoded
    }
    if (node.nodeType !== 1) return ''
    const element = node as Element,
      tag = name(element)
    if (drop.has(tag)) return ''
    if (tag === 'img') {
      const candidates = [
        element.getAttribute('data-src'),
        element.getAttribute('data-original'),
        element.getAttribute('src'),
        element.getAttribute('srcset')?.split(',')[0].trim().split(/\s/)[0],
        element.parentElement?.localName === 'picture' ? element.parentElement.querySelector('source')?.getAttribute('srcset')?.split(',')[0].trim().split(/\s/)[0] : null
      ]
      const candidate = candidates.find(candidate => safeFeedUrl(candidate, base))
      const src = safeFeedUrl(candidate, base)
      if (!src) return ''
      if (src.length + 400 > budget) {
        truncated = true
        return ''
      }
      if (!image) image = src
      budget -= src.length + 160
      return `<img src="${escape(src)}" alt="${escape((element.getAttribute('alt') || '').slice(0, 200))}">`
    }
    let attrs = ''
    if (tag === 'a') {
      const href = safeFeedUrl(element.getAttribute('href'), base)
      if (href) attrs = ` href="${escape(href)}" rel="noopener noreferrer"`
    }
    budget -= 100 + attrs.length
    const inner = Array.from(node.childNodes)
      .map(item => render(item, depth + 1))
      .join('')
    if (!allowed.has(tag)) return inner
    return tag === 'br' || tag === 'hr' ? `<${tag}>` : `<${tag}${attrs}>${inner}</${tag}>`
  }
  const result = render(doc.documentElement as unknown as Node, 0)
  return { html: result, text: textOnly(result).replace(/\s+/g, ' ').trim(), image, truncated }
}

export async function parseFeed(xml: string, base: string, now = new Date()): Promise<ParsedFeed> {
  if (new TextEncoder().encode(xml).byteLength > RSS_LIMITS.bytes || /<!\s*(DOCTYPE|ENTITY)/i.test(xml)) throw new RssError('invalid_feed')
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const root = doc.documentElement as unknown as Element
  if (!root || !['rss', 'rdf', 'feed'].includes(name(root))) throw new RssError('invalid_feed')
  const atom = name(root) === 'feed'
  const channel = atom ? root : child(root, 'channel')
  if (!channel) throw new RssError('invalid_feed')
  const baseFor = (element: Element, fallback: string) => safeFeedUrl(element.getAttribute('xml:base'), fallback) || fallback
  const feedBase = baseFor(channel, baseFor(root, base))
  const linkFor = (element: Element, itemBase: string) => {
    const links = children(element, 'link')
    const link = atom ? links.find(el => !el.getAttribute('rel') || el.getAttribute('rel') === 'alternate') : links[0]
    return safeFeedUrl(atom ? link?.getAttribute('href') : link?.textContent, itemBase)
  }
  const title = textOnly(value(channel, 'title')).slice(0, 500) || new URL(base).hostname
  const site_url = linkFor(channel, feedBase)
  // RFC 5005: only follow links explicitly declared by the feed, never guess page URLs.
  const historyLink = children(channel, 'link').find(el => el.getAttribute('rel') === 'next') || children(channel, 'link').find(el => el.getAttribute('rel') === 'prev-archive')
  const next_url = historyLink ? safeFeedUrl(historyLink.getAttribute('href'), baseFor(historyLink, feedBase)) : null
  const entries = atom ? children(root, 'entry') : name(root) === 'rdf' ? children(root, 'item') : children(channel, 'item')
  const items: FeedItem[] = []
  const seen = new Set<string>()
  let remaining = 2 * 1024 * 1024
  for (const entry of entries.slice(0, 1000)) {
    const itemBase = baseFor(entry, feedBase)
    const guid = child(entry, 'guid')
    const rawUrl =
      linkFor(entry, itemBase) ||
      (!atom && guid && guid.getAttribute('isPermaLink') !== 'false' && /^https?:\/\//i.test(guid.textContent?.trim() || '') ? safeFeedUrl(guid.textContent, itemBase) : null)
    const article_url = rawUrl ? processTargetUrl(new URL(rawUrl)) : null
    const rawContent = child(entry, 'encoded') || child(entry, 'content') || child(entry, 'description') || child(entry, 'summary')
    const contentType = rawContent?.getAttribute('type')
    let raw = rawContent?.textContent || ''
    if (atom && contentType === 'xhtml') raw = rawContent?.innerHTML || raw
    else if (atom && (!contentType || contentType === 'text')) raw = escape(raw)
    const sanitized = sanitizeFeedHtml(raw, baseFor(rawContent || entry, article_url || itemBase))
    const itemTitle = textOnly(value(entry, 'title')).slice(0, 500) || sanitized.text.slice(0, 100) || title
    const date = new Date(value(entry, 'published') || value(entry, 'pubdate') || value(entry, 'date') || value(entry, 'updated'))
    const published_at = Number.isFinite(date.valueOf()) && date.valueOf() > 0 && date.valueOf() <= now.valueOf() + 24 * 3600_000 ? date : null
    const key = value(entry, 'id') || value(entry, 'guid') || article_url || `${itemTitle}\n${published_at?.toISOString() || ''}`
    const entry_key = await hashSHA256(key)
    if (seen.has(entry_key)) continue
    seen.add(entry_key)
    // A large preview must not discard all subsequent article metadata.
    let content = sanitized.html
    if (new TextEncoder().encode(content).byteLength > remaining) {
      content = remaining >= 4096 ? `<p>${escape(sanitized.text.slice(0, 500))}</p>` : ''
      sanitized.truncated = true
    }
    remaining -= new TextEncoder().encode(content).byteLength
    const author = value(entry, 'creator') || (atom ? value(child(entry, 'author') || entry, 'name') : value(entry, 'author'))
    const thumbnail = child(entry, 'thumbnail')?.getAttribute('url') || child(entry, 'enclosure')?.getAttribute('url')
    items.push({
      entry_key,
      article_url,
      title: itemTitle,
      author: author.slice(0, 300) || null,
      summary: sanitized.text.slice(0, 500),
      content_html: content,
      content_truncated: sanitized.truncated,
      image_url: sanitized.image || safeFeedUrl(thumbnail, itemBase),
      published_at
    })
    if (items.length === RSS_LIMITS.entries) break
  }
  return { title, site_url, next_url: next_url === base ? null : next_url, items }
}

export function retryAfter(value: string | null, now = new Date()): Date | undefined {
  if (!value) return undefined
  const date = /^\d+$/.test(value) ? new Date(now.valueOf() + Number(value) * 1000) : new Date(value)
  return Number.isFinite(date.valueOf()) && date > now ? date : undefined
}
const challengeHeaders = (response: Response) =>
  response.headers.get('cf-mitigated') === 'challenge' ||
  ([403, 503].includes(response.status) && (response.headers.has('cf-ray') || /cloudflare/i.test(response.headers.get('Server') || '')))
const challengeHtml = (xml: string) => /^\s*(?:<!doctype html[^>]*>\s*)?<html\b/i.test(xml) && /(?:\/cdn-cgi\/challenge-platform\/|\bcf-chl-|\b_cf_chl_opt\b)/i.test(xml)

export async function fetchFeed(url: string, validators: { etag?: string | null; last_modified?: string | null } = {}, timeoutMs = 30_000, env?: Env): Promise<FeedResult> {
  const headers = new Headers({ Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', 'User-Agent': 'SlaxReader RSS/1.0', 'Accept-Encoding': 'identity' })
  if (validators.etag) headers.set('If-None-Match', validators.etag)
  if (validators.last_modified) headers.set('If-Modified-Since', validators.last_modified)
  try {
    url = publicTarget(url).href
    const deadline = Date.now() + timeoutMs
    let response = await publicFetch(url, { headers }, { maxBytes: RSS_LIMITS.bytes, timeoutMs })
    let fallbackUsed = false
    const fallback = async () => {
      const retry = retryAfter(response.headers.get('Retry-After'))
      await response.body?.cancel().catch(() => {})
      const remaining = deadline - Date.now()
      if (fallbackUsed || response.status === 429 || retry || !env?.ZYTE_API_KEY?.trim() || remaining <= 0) throw new RssError('source_unavailable', 502, retry)
      fallbackUsed = true
      // Start at the original public URL so redirect and conditional-header rules are reapplied.
      return new SlaxFetch(env).zyteResponse(url, headers, { maxBytes: RSS_LIMITS.bytes, timeoutMs: remaining })
    }
    for (;;) {
      if (challengeHeaders(response)) response = await fallback()
      if (challengeHeaders(response)) {
        await response.body?.cancel()
        throw new RssError('source_unavailable', 502, retryAfter(response.headers.get('Retry-After')))
      }
      if (response.status === 304) return { unchanged: true }
      if (!response.ok) {
        await response.body?.cancel()
        throw new RssError('source_unavailable', 502, retryAfter(response.headers.get('Retry-After')))
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      const prefix = new TextDecoder().decode(bytes.slice(0, 200))
      const encoding =
        bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : prefix.match(/encoding=["']([^"']+)["']/i)?.[1] || 'utf-8'
      const xml = new TextDecoder(encoding, { fatal: true, ignoreBOM: false }).decode(bytes)
      if (challengeHtml(xml)) {
        response = await fallback()
        continue
      }
      return { unchanged: false, feed: await parseFeed(xml, response.url || url), etag: response.headers.get('ETag'), lastModified: response.headers.get('Last-Modified') }
    }
  } catch (error) {
    if (error instanceof RssError) throw error
    throw new RssError('source_unavailable', 502)
  }
}
