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

  async clearSession(): Promise<void> {
    if (!this.url || !this.cookieName) return
    const origin = new URL(this.url)
    const current = await browser.cookies.get({ url: this.url, name: this.cookieName })
    if (current) {
      await browser.cookies.remove({ url: this.url, name: current.name, storeId: current.storeId })
    }
    const configuredDomain = String(process.env.COOKIE_DOMAIN || origin.hostname).replace(/^\./, '')
    const cookies = await browser.cookies.getAll({ name: this.cookieName })
    const matching = cookies.filter(cookie => {
      const domain = cookie.domain.replace(/^\./, '')
      return domain === configuredDomain || origin.hostname === domain || origin.hostname.endsWith(`.${domain}`)
    })
    await Promise.allSettled(
      matching.map(cookie =>
        browser.cookies.remove({
          url: `${cookie.secure ? 'https:' : origin.protocol}//${cookie.domain.replace(/^\./, '') === origin.hostname ? origin.host : cookie.domain.replace(/^\./, '')}${cookie.path}`,
          name: cookie.name,
          storeId: cookie.storeId
        })
      )
    )
  }
}
