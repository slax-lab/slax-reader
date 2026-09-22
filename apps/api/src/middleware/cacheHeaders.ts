import { matchCacheableRequest } from './cacheableRoutes'

export const applyCacheHeaders = (response: Response, request: Request): Response => {
  if (!(response instanceof Response) || response.status !== 200) return response

  if ((response.headers.get('Cache-Control') || '').includes('no-store')) return response

  const url = new URL(request.url)
  const route = matchCacheableRequest(url, request.method)
  if (!route) return response

  const headers = new Headers(response.headers)
  headers.set('Cache-Control', `public, max-age=${route.maxAge}, immutable`)

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
