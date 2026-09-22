const IMG_SRC_RE = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/')
}

export function extractImageUrls(html: string, limit = 20): string[] {
  if (!html) return []
  const seen = new Set<string>()
  const urls: string[] = []

  for (const match of html.matchAll(IMG_SRC_RE)) {
    const raw = match[1] ?? match[2] ?? ''
    const src = decodeHtmlEntities(raw.trim())
    if (!src || src.startsWith('data:')) continue
    if (seen.has(src)) continue
    seen.add(src)
    urls.push(src)
    if (urls.length >= limit) break
  }

  return urls
}
