import DOMPurify from 'dompurify'

export function isRssImageUrl(raw: string, development = false): boolean {
  try {
    const url = new URL(raw)
    const transport = url.protocol === 'https:' || (development && url.protocol === 'http:')
    return transport && !url.username && !url.password && url.searchParams.get('m') === 'rss' && !!url.searchParams.get('d')
  } catch {
    return false
  }
}

/** Feed images must remain on the signed cache route, including local Wrangler in dev. */
export function sanitizeRssPreview(html: string, development = false): string {
  const cleaned = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['iframe', 'video', 'audio', 'style', 'form'],
    FORBID_ATTR: ['style', 'srcset']
  })
  const doc = new DOMParser().parseFromString(cleaned, 'text/html')
  for (const img of doc.querySelectorAll('img')) {
    if (!isRssImageUrl(img.getAttribute('src') || '', development)) img.remove()
  }
  for (const link of doc.querySelectorAll('a')) {
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  }
  return doc.body.innerHTML
}
