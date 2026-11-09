import { configuredCookieName } from '~/utils/authCookie'
import { getClientLocale } from '~/utils/request'
import { createOAuthNonce, digestOAuthState, oauthCookieName, oauthCookieOptions, oauthRedirectUri } from '~~/shared/utils/oauthState'

import type { AcquisitionAuthAttribution, WebAuthAttribution } from '@slax-reader/contracts/events'
import { useCookies } from '@vueuse/integrations/useCookies'
import { useUserStore } from '~/stores/user'

const { set, remove } = useCookies()

async function createState(platform: 'google' | 'apple', redirectUrl: string, options: { redirect: string; affCode: string; authAttribution?: WebAuthAttribution }) {
  const nonce = createOAuthNonce()
  const state = JSON.stringify({
    nonce,
    redirectUrl,
    target: options.redirect,
    affCode: options.affCode,
    platform,
    clientLocale: getClientLocale(),
    auth_attribution: options.authAttribution
  })
  const secure = location.protocol === 'https:'
  set(oauthCookieName(nonce, secure), await digestOAuthState(state), { ...oauthCookieOptions(secure), maxAge: 600 })
  return state
}

const useAuth = {
  async requestAuth(options: { redirect: string; affCode: string; authAttribution?: WebAuthAttribution }) {
    const $config = useRuntimeConfig().public
    const redirectUrl = oauthRedirectUri(String($config.AUTH_BASE_URL))
    const url = `https://accounts.google.com/o/oauth2/v2/auth`
    const params = {
      client_id: $config.GOOGLE_OAUTH_CLIENT_ID as string,
      redirect_uri: redirectUrl,
      scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
      response_type: 'code',
      state: await createState('google', redirectUrl, options)
    }

    location.href = url + '?' + new URLSearchParams(params)
  },
  async requestAppleAuth(options: { redirect: string; affCode: string; authAttribution?: AcquisitionAuthAttribution }) {
    const $config = useRuntimeConfig().public
    const redirectUrl = oauthRedirectUri(String($config.AUTH_BASE_URL))
    const url = `https://appleid.apple.com/auth/authorize`
    const params = {
      client_id: $config.APPLE_OAUTH_CLIENT_ID as string,
      redirect_uri: redirectUrl,
      response_type: 'code',
      response_mode: 'query',
      state: await createState('apple', redirectUrl, options)
    }

    location.href = url + '?' + new URLSearchParams(params)
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
