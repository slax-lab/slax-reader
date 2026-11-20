import { parseHTML } from 'linkedom'
import { extractYoutubeVideoId } from './platformDetector'

function timestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return
  const date = new Date(value)
  const day = new Date(value.slice(0, 10))
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return
  return date.toISOString()
}

export function youtubePublicationTime(html: string, videoId: string): string | undefined {
  const { document } = parseHTML(html)
  if (!document.documentElement) return
  const head = document.head
  const canonical = head?.querySelector('link[rel="canonical"]')?.getAttribute('href')
  if (!canonical || extractYoutubeVideoId(canonical) !== videoId) return
  return (
    timestamp(head.querySelector('meta[itemprop="datePublished"]')?.getAttribute('content')) ??
    timestamp(head.querySelector('meta[itemprop="uploadDate"]')?.getAttribute('content'))
  )
}

export function substackPublicationTime(url: URL, source: string | Document): string | undefined {
  if (!url.pathname.startsWith('/p/')) return
  const substackHost = url.hostname === 'substack.com' || url.hostname.endsWith('.substack.com')
  if (typeof source === 'string' && !substackHost && !source.includes('https://substackcdn.com')) return
  const document = typeof source === 'string' ? parseHTML(source).document : source
  if (!document.documentElement) return
  if (!substackHost && !document.head?.querySelector('link[href="https://substackcdn.com"], link[href^="https://substackcdn.com/"]')) return
  const canonical = document.head?.querySelector('link[rel="canonical"]')?.getAttribute('href')
  if (canonical && !URL.canParse(canonical, url.href)) return
  const page = new URL(canonical || url.href, url)
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    let json
    try {
      json = JSON.parse(script.textContent || '')
    } catch {
      continue
    }
    const nodes = Array.isArray(json) ? json : (json?.['@graph'] ?? [json])
    if (!Array.isArray(nodes)) continue
    for (const node of nodes) {
      if (!['Article', 'NewsArticle', 'BlogPosting'].includes(node?.['@type'])) continue
      const identity = node.url ?? node.mainEntityOfPage?.['@id'] ?? node.mainEntityOfPage
      if (typeof identity !== 'string' || !URL.canParse(identity, url.href)) continue
      const article = new URL(identity, url)
      if (article.origin !== page.origin || article.pathname !== page.pathname) continue
      const date = timestamp(node.datePublished)
      if (date) return date
    }
  }
  return timestamp(document.head?.querySelector('meta[property="article:published_time"]')?.getAttribute('content'))
}
