import { RESTMethodPath } from '@slax-reader/contracts/const'
import { deleteCookie, getHeader, type H3Event, setCookie } from 'h3'

export const webSessionConfig = (event: H3Event) => useRuntimeConfig(event).public

function sessionCookieName(event: H3Event) {
  const name = webSessionConfig(event).COOKIE_TOKEN_NAME
  if (typeof name !== 'string' || !name.trim()) throw new Error('Invalid COOKIE_TOKEN_NAME')
  return name.trim()
}

export function setWebSession(event: H3Event, token: string) {
  const config = webSessionConfig(event)
  const domain = typeof config.COOKIE_DOMAIN === 'string' ? config.COOKIE_DOMAIN.replace(/^\.+/, '').toLowerCase() : ''
  const name = sessionCookieName(event)
  const { hostname, protocol } = new URL(String(config.PUBLIC_BASE_URL))
  const scope = { path: '/', secure: protocol === 'https:' }
  if (domain) {
    deleteCookie(event, name, scope)
    if (hostname.endsWith('.' + domain)) deleteCookie(event, name, { ...scope, domain: hostname })
    const labels = domain.split('.')
    if (labels.length > 2 && !/^\d+(\.\d+){3}$/.test(domain)) {
      deleteCookie(event, name, { ...scope, domain: labels.slice(1).join('.') })
    }
  }
  setCookie(event, name, token, {
    ...scope,
    expires: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    ...(domain ? { domain } : {})
  })
}

export async function requestWebLogin(event: H3Event, init: RequestInit) {
  const config = webSessionConfig(event)
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  for (const name of ['user-agent', 'accept-language', 'x-device-id', 'x-client-version', 'x-client-locale']) {
    const value = getHeader(event, name)
    if (value && !headers.has(name)) headers.set(name, value)
  }
  headers.set('X-Client-Type', 'web')
  const response = await fetch(String(config.DWEB_API_BASE_URL) + RESTMethodPath.LOGIN, { ...init, method: 'POST', headers, redirect: 'manual' })
  if (response.status >= 300 && response.status < 400) throw new Error('Auth API redirected')
  return response
}

export function isIssuedWebToken(token: unknown): token is string {
  if (typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some(part => part.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(part))) return false
  try {
    const decode = (part: string) => JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
    const header = decode(parts[0]!)
    const claims = decode(parts[1]!)
    return ['HS256', 'HS384', 'HS512'].includes(header?.alg) && typeof claims?.id === 'string' && Boolean(claims.id) && Number.isFinite(claims.exp) && claims.exp * 1000 > Date.now()
  } catch {
    return false
  }
}
