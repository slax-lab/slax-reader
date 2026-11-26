import { appearancePath, denied, evictPublicReader, publicReaderCache, type ReaderAppearance,readerPath } from './public-reader'

function articleText(html: string): string {
  // Template content stays inert. Only text crosses into persistent storage.
  const template = document.createElement('template')
  template.innerHTML = html
  const content = template.content
  content.querySelectorAll('script,style,template,noscript,iframe,svg,canvas,object,embed,head,[hidden],[aria-hidden="true"]').forEach(node => node.remove())
  content.querySelectorAll('p,div,section,article,blockquote,pre,li,dd,dt,h1,h2,h3,h4,h5,h6,tr,br,hr').forEach(node => {
    node.before('\n')
    node.after('\n')
  })
  content.querySelectorAll('td,th').forEach(node => node.after('\t'))
  return (content.textContent || '').replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, '\n\n').trim()
}

export async function savePublicReader(path: string, appearance: ReaderAppearance, redirectCode?: string) {
  const match = readerPath.exec(path)
  if (!match) return
  const cache = await caches.open(publicReaderCache)
  await cache.put(appearancePath, Response.json(appearance))
  let id = match[2]!
  let alias = redirectCode && /^[a-zA-Z0-9_-]+$/.test(redirectCode) ? '/s/' + redirectCode : undefined
  const anonymous = { credentials: 'omit', cache: 'no-store' } as const
  if (match[1] === 's') {
    alias = '/s/' + id
    const resolved = await fetch(alias, { ...anonymous, headers: { Accept: 'application/json' } })
    if (denied(resolved.status)) await evictPublicReader(cache, alias)
    if (!resolved.ok) return
    const target = await resolved.json()
    if (!target || typeof target !== 'object' || !('uuid' in target) || typeof target.uuid !== 'string') return
    id = target.uuid
  }
  const canonical = '/b/' + encodeURIComponent(id)
  const response = await fetch('/api/content/' + encodeURIComponent(id), anonymous)
  if (denied(response.status)) {
    await cache.delete(canonical)
    if (alias) await cache.delete(alias)
    return
  }
  if (!response.ok) return
  const result = await response.json() as { metadata?: { role?: unknown; type?: unknown; pdf?: unknown; title?: unknown; alias_title?: unknown }; body?: unknown }
  const { metadata, body } = result
  if (metadata?.role !== 'visitor' || metadata.type !== 'article' || metadata.pdf) {
    await cache.delete(canonical)
    if (alias) await cache.delete(alias)
    return
  }
  if (typeof body !== 'string') return
  const text = articleText(body)
  if (!text) return
  const title = typeof metadata.alias_title === 'string' && metadata.alias_title.trim() ? metadata.alias_title : metadata.title
  if (typeof title !== 'string') return
  await cache.put(canonical, Response.json({ title, text }))
  if (alias) await cache.put(alias, Response.json(canonical))
}
