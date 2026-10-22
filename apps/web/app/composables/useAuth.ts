import { configuredCookieName, requireConfiguredCookieName } from '~/utils/authCookie'

import { RESTMethodPath } from '@slax-reader/contracts/const'
import { useCookies } from '@vueuse/integrations/useCookies'
import { useUserStore } from '~/stores/user'

const { set, remove } = useCookies()

const useAuth = {
  async requestAuth(options: { redirect: string; affCode: string }) {
    const { redirect, affCode } = options
    const $config = useRuntimeConfig().public
    const url = `https://accounts.google.com/o/oauth2/v2/auth`
    const params = {
      client_id: $config.GOOGLE_OAUTH_CLIENT_ID as string,
      redirect_uri: `${$config.AUTH_BASE_URL}/auth`,
      scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
      response_type: 'code',
      state: JSON.stringify({
        nonce: 'random',
        redirectUrl: `${$config.AUTH_BASE_URL}/auth`,
        target: redirect,
        affCode: affCode,
        platform: 'google'
      })
    }

    location.href = url + '?' + new URLSearchParams(params)
  },
  async requestAppleAuth(options: { redirect: string; affCode: string }) {
    const { redirect, affCode } = options
    const $config = useRuntimeConfig().public
    const url = `https://appleid.apple.com/auth/authorize`
    const params = {
      client_id: $config.APPLE_OAUTH_CLIENT_ID as string,
      redirect_uri: `${$config.AUTH_BASE_URL}/auth`,
      response_type: 'code',
      response_mode: 'query',
      state: JSON.stringify({
        nonce: 'random',
        redirectUrl: `${$config.AUTH_BASE_URL}/auth`,
        target: redirect,
        affCode: affCode,
        platform: 'apple'
      })
    }

    location.href = url + '?' + new URLSearchParams(params)
  },
  async grantAuth(code: string, redirectUri: string, affCode: string, platformType: 'google' | 'apple' = 'google'): Promise<string> {
    const $config = useRuntimeConfig().public
    const clientIdRef = {
      apple: `${$config.APPLE_OAUTH_CLIENT_ID}`,
      google: `${$config.GOOGLE_OAUTH_CLIENT_ID}`
    }

    const resp = await request().post<{ token: string }>({
      url: RESTMethodPath.LOGIN,
      body: {
        code,
        aff_code: affCode,
        redirect_uri: redirectUri,
        type: platformType,
        client_id: clientIdRef[platformType]
      }
    })

    if (!resp) {
      throw new Error('login failed')
    }

    const cookieName = requireConfiguredCookieName($config.COOKIE_TOKEN_NAME)
    const cookieDomain = typeof $config.COOKIE_DOMAIN === 'string' ? $config.COOKIE_DOMAIN : ''
    set(cookieName, resp.token, {
      path: '/',
      expires: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      ...(cookieDomain ? { domain: cookieDomain } : {})
    })
    return resp.token
  },
  async clearAuth(): Promise<void> {
    const $config = useRuntimeConfig().public
    const cookieName = configuredCookieName($config.COOKIE_TOKEN_NAME)
    const configuredDomain = (typeof $config.COOKIE_DOMAIN === 'string' ? $config.COOKIE_DOMAIN : '').replace(/^\.+/, '').toLowerCase()
    const hostname = typeof window === 'undefined' ? '' : window.location.hostname
    const domains = new Set([configuredDomain, hostname])
    const isIpAddress = (domain: string) => domain.includes(':') || /^\d+(\.\d+){3}$/.test(domain)
    const labels = configuredDomain.split('.')
    if (labels.length > 2 && !isIpAddress(configuredDomain)) domains.add(labels.slice(1).join('.'))

    if (cookieName) {
      remove(cookieName, { path: '/' })
      // Host-only deletion does not remove an explicit-domain cookie at the
      // same hostname. Expire every supported scope, even with duplicate names.
      for (const domain of domains) {
        if (!domain || isIpAddress(domain)) continue
        try {
          remove(cookieName, { path: '/', domain })
        } catch {
          // An inapplicable legacy domain must not prevent the other scopes
          // from being cleared (for example on a local development host).
        }
      }
    }
    await useUserStore().clearUserInfo()
  }
}

export default () => useAuth
