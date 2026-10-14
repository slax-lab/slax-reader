export const CACHE_TTL = {
  IMMUTABLE: 60 * 60 * 24 * 30 // 30 天
} as const

export interface CacheableRoute {
  path: string
  method: string
  maxAge: number
}

export const CACHEABLE_ROUTES: CacheableRoute[] = [
  { path: '/static/image', method: 'GET', maxAge: CACHE_TTL.IMMUTABLE },
  { path: '/static/image/snippets', method: 'GET', maxAge: CACHE_TTL.IMMUTABLE }
]

const eq = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()

export const matchCacheableRoute = (pathname: string, method: string): CacheableRoute | undefined => CACHEABLE_ROUTES.find(r => r.path === pathname && eq(r.method, method))

export const matchCacheableRequest = (url: URL, method: string): CacheableRoute | undefined => matchCacheableRoute(url.pathname, method)
