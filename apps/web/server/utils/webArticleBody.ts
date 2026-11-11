// This projection is for Web delivery only; canonical snapshots retain their manifest.
export async function projectWebArticleBody(html: string, apiBaseUrl: string): Promise<string> {
  if (typeof HTMLRewriter === 'undefined' || !html) return html
  const proxy = new URL('/static/image', apiBaseUrl)
  const parseProxy = (value: string): URL | null => {
    if (!URL.canParse(value)) return null
    const url = new URL(value)
    const params = url.searchParams
    if (url.origin !== proxy.origin || url.pathname !== proxy.pathname || url.username || url.password) return null
    if (!params.get('u') || params.get('r') === null || !params.get('d')) return null
    if (params.has('m') && params.get('m') !== 'rss') return null
    return url
  }
  return new HTMLRewriter()
    .on('script#slax-private-snapshot[type="application/json"]', { element(element) { element.remove() } })
    .on('img[src]', {
      element(element) {
        // HTMLRewriter exposes attribute source text, including serialized ampersands.
        const source = element.getAttribute('src')!.replace(/&(?:amp|#0*38|#x0*26);/gi, '&')
        const outer = parseProxy(source)
        if (!outer) return
        let innerSource: string
        try {
          innerSource = decodeURIComponent(outer.searchParams.get('u')!)
        } catch {
          return
        }
        const inner = parseProxy(innerSource)
        if (!inner || outer.searchParams.get('m') !== inner.searchParams.get('m')) return
        let target: string
        try {
          target = decodeURIComponent(inner.searchParams.get('u')!)
        } catch {
          return
        }
        if (parseProxy(target)) return
        element.setAttribute('src', innerSource.replaceAll('&', '&amp;'))
      }
    })
    .transform(new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    .text()
}
