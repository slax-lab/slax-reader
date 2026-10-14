export class SessionService {
  private readonly url = process.env.PUBLIC_BASE_URL || ''
  private readonly cookieName = process.env.COOKIE_TOKEN_NAME || ''

  async getToken(): Promise<string | null> {
    if (!this.url || !this.cookieName) return null
    const cookie = await browser.cookies.get({ url: this.url, name: this.cookieName })
    return cookie?.value || null
  }

  async hasSession(): Promise<boolean> {
    const token = await this.getToken()
    if (!token) return false
    try {
      const payload = token.split('.')[1]
      if (!payload) return true
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
      const claims = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))) as { exp?: number }
      return typeof claims.exp !== 'number' || claims.exp * 1000 > Date.now()
    } catch {
      return true
    }
  }

  async clearSession(expectedToken?: string): Promise<boolean> {
    if (!this.url || !this.cookieName) return true
    const origin = new URL(this.url)
    const cookies = await browser.cookies.getAll({ name: this.cookieName })
    const current = await browser.cookies.get({ url: this.url, name: this.cookieName })
    if (expectedToken && current && current.value !== expectedToken) return false
    const configuredDomain = String(process.env.COOKIE_DOMAIN || origin.hostname).replace(/^\./, '')
    const matching = cookies.filter(cookie => {
      const domain = cookie.domain.replace(/^\./, '')
      return domain === configuredDomain || origin.hostname === domain || origin.hostname.endsWith(`.${domain}`)
    })
    if (current && !matching.some(cookie => cookie.domain === current.domain && cookie.path === current.path && cookie.storeId === current.storeId)) matching.push(current)
    for (const cookie of matching) {
      const details = {
        url: `${cookie.secure ? 'https:' : origin.protocol}//${cookie.domain.replace(/^\./, '') === origin.hostname ? origin.host : cookie.domain.replace(/^\./, '')}${cookie.path}`,
        name: cookie.name,
        storeId: cookie.storeId
      }
      // Cookie writes from dweb are outside the background's transition queue.
      // Re-read after every async boundary; only delete the request's own token.
      const latest = await browser.cookies.get(details)
      if (expectedToken && latest && latest.value !== expectedToken) return false
      if (latest) await browser.cookies.remove(details)
    }
    return true
  }
}

export const getTokenIdentityKeys = (token: string | null): Set<string> => {
  if (!token) return new Set()
  try {
    const payload = token.split('.')[1]
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))) as Record<string, unknown>
    return new Set(
      [claims.id ?? claims.user_id ?? claims.uid ?? claims.sub, claims.email].filter(value => (typeof value === 'string' || typeof value === 'number') && String(value)).map(String)
    )
  } catch {
    return new Set()
  }
}
export const userInfoMatchesIdentity = (user: { userId: unknown; email?: string }, keys: ReadonlySet<string>) =>
  keys.has(String(user.userId)) || Boolean(user.email && keys.has(user.email))

export const getSessionAccountKey = async (token: string): Promise<string | null> => {
  const keys = [...getTokenIdentityKeys(token)]
  if (!keys.length) return null
  const key = keys[0]
  if (!key.includes('@')) return `id:${key}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return `email:${Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')}`
}
