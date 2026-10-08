import { publicTarget } from './publicTargetPolicy'
import { publicFetch } from './publicFetch'

const articleHosts = new Set(['toutiao.com', 'www.toutiao.com', 'm.toutiao.com'])
const shareHosts = new Set(['t.toutiao.com', 'toutiaolink.com', 'www.toutiaolink.com'])
const redirectStatuses = new Set([301, 302, 303, 307, 308])

export class ToutiaoCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToutiaoCaptureError'
  }
}

function checkedUrl(input: string): URL | null {
  try {
    return publicTarget(input)
  } catch {
    return null
  }
}

export function parseToutiaoArticleUrl(input: string): { articleId: string; canonicalUrl: string } | null {
  const url = checkedUrl(input)
  if (!url || !articleHosts.has(url.hostname)) return null
  const articleId = url.pathname.match(/^\/(?:article\/|group\/|a|i)([0-9]+)\/?$/)?.[1]
  return articleId ? { articleId, canonicalUrl: `https://www.toutiao.com/article/${articleId}/` } : null
}

export function isToutiaoShareUrl(input: string): boolean {
  const url = checkedUrl(input)
  return !!url && (shareHosts.has(url.hostname) || (url.hostname === 'm.toutiao.com' && /^\/is\/[^/]+\/?$/.test(url.pathname)))
}

/** Resolve HTTP redirects only; challenge pages never supply a guessed article ID. */
export async function resolveToutiaoUrl(input: string): Promise<{ articleId: string; canonicalUrl: string }> {
  let current = input
  const visited = new Set<string>()
  for (let hop = 0; hop <= 5; hop++) {
    const article = parseToutiaoArticleUrl(current)
    if (article) return article
    if (!isToutiaoShareUrl(current)) throw new ToutiaoCaptureError('Unsupported Toutiao URL or redirect destination')
    const target = publicTarget(current)
    if (visited.has(target.href)) throw new ToutiaoCaptureError('Toutiao share link redirect loop')
    visited.add(target.href)
    if (hop === 5) throw new ToutiaoCaptureError('Toutiao share link exceeded five redirects')
    let response: Response
    try {
      response = await publicFetch(target, { method: 'GET' }, { followRedirects: false, timeoutMs: 10_000, maxBytes: 64 * 1024 })
    } catch {
      throw new ToutiaoCaptureError('Toutiao share link request failed or timed out')
    }
    await response.body?.cancel()
    const location = response.headers.get('Location')
    if (!redirectStatuses.has(response.status) || !location) throw new ToutiaoCaptureError('Toutiao share link expired or returned a challenge without an article redirect')
    try {
      current = new URL(location, target).href
    } catch {
      throw new ToutiaoCaptureError('Invalid Toutiao redirect destination')
    }
  }
  throw new ToutiaoCaptureError('Toutiao share link could not be resolved')
}
