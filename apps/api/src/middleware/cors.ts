import { ContextManager } from '@/utils/context'
import { deploymentOrigin } from '@/utils/deploymentOrigin'

export const corsHeader = {
  server: 'slax-reader',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Device-ID, X-CLIENT-TYPE, X-CLIENT-VERSION, X-CLIENT-LOCALE',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE, PUT',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Max-Age': '86400'
}

export const corsCacheHeader = {
  server: 'slax-reader',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Max-Age': '31536000',
  'Cache-Control': 'public, max-age=31536000',
  'HIT-SLAX-CACHE': '1'
}

export const corsNotCacheHeader = {
  server: 'slax-reader',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Max-Age': '31536000',
  'Cache-Control': 'no-store',
  'HIT-SLAX-CACHE': '0',
  'SLAX-PROXY-IMAGE': '1'
}

const refererWhiteList = [
  'http://localhost:3000',
  'https://r.slax.app',
  'https://reader.slax.app',
  'https://reader-api.slax.com',
  'https://reader.slax.com',
  'https://r.slax.com',
  'https://r.slax.dev',
  'https://r-beta.slax.com',
  'https://www.qiaoqiaodaka.com',
  ''
]

export const requestCorsHeaders = (request: Request, frontEndUrl?: string): Record<string, string> => {
  const origin = request.headers.get('Origin')
  // Cookie identity is supported only for our exact web origins, never arbitrary websites.
  const webOrigins = [
    'http://localhost:3000',
    'https://r.slax.app',
    'https://reader.slax.app',
    'https://reader.slax.com',
    'https://r.slax.com',
    'https://r.slax.dev',
    'https://r-beta.slax.com'
  ]
  const configured = deploymentOrigin(frontEndUrl)
  if (configured) webOrigins.push(configured)
  if (new URL(request.url).pathname === '/events' && origin && webOrigins.includes(origin)) {
    return { ...corsHeader, 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' }
  }
  return { ...corsHeader }
}

export const applyApiResponseHeaders = (response: Response, request: Request, frontEndUrl?: string): Response => {
  const path = new URL(request.url).pathname
  if (path !== '/events' && path !== '/v1/bookmark/export') return response
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'private, no-store')
  if (path === '/events') {
    for (const [key, value] of Object.entries(requestCorsHeaders(request, frontEndUrl))) {
      if (key === 'Vary') continue
      headers.set(key, value)
    }
    const vary = new Set(
      (headers.get('Vary') ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    )
    vary.add('Origin')
    headers.set('Vary', [...vary].join(', '))
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export const cors = async (request: Request, ctx: ContextManager) => {
  if (request.method === 'OPTIONS') {
    const headers: Record<string, string> = {
      'Cache-Control': 'public, max-age=86400',
      ...requestCorsHeaders(request, ctx.env?.FRONT_END_URL)
    }
    if (request.url.includes('/m')) {
      headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, X-Device-ID, X-CLIENT-TYPE, X-ACTION-TYPE, X-CLIENT-VERSION, X-CLIENT-LOCALE'
    }
    return new Response(null, {
      status: 204,
      headers: headers
    })
  }
}

export const isValidReferer = (referer: string, frontEndUrl?: string): boolean => {
  if (referer === '') return true
  try {
    const origin = new URL(referer).origin
    return origin === deploymentOrigin(frontEndUrl) || refererWhiteList.includes(origin)
  } catch {
    return false
  }
}
