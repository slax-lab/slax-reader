// sitemap 源，失败降级空数组
export default defineSitemapEventHandler(async event => {
  try {
    // 窄化 BACKEND，绕递归类型
    const { BACKEND } = event.context.cloudflare.env as unknown as { BACKEND: { fetch: (input: string, init?: RequestInit) => Promise<Response> } }

    const res = await BACKEND.fetch('https://content.internal/content/collections_sitemap')
    if (!res.ok) return []

    const { collections } = (await res.json()) as { collections: Array<{ code: string; lastmod?: string }> }

    // 后端无 last_modified_at 时不造 lastmod
    return collections.map(c => ({
      loc: `/c/${c.code}`,
      ...(c.lastmod ? { lastmod: c.lastmod } : {}),
      changefreq: 'daily' as const,
      priority: 0.7
    }))
  } catch (error) {
    console.error('[sitemap] collections source failed:', error)
    return []
  }
})
