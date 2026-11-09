import { configuredCookieName } from '~/utils/authCookie'
import { getClientEventHeaders } from '~/utils/request'
import { postWebSession } from '~/utils/webSessionRequest'
import { createOAuthNonce, digestOAuthState, oauthCookieName, oauthCookieOptions, oauthRedirectUri } from '~~/shared/utils/oauthState'

import type { AcquisitionAuthAttribution, WebAuthAttribution } from '@slax-reader/contracts/events'
import { useCookies } from '@vueuse/integrations/useCookies'
import { useUserStore } from '~/stores/user'

const { set, remove } = useCookies()

async function createState(platform: 'google' | 'apple', options: { redirect: string; affCode: string; authAttribution?: WebAuthAttribution }) {
  const nonce = createOAuthNonce()
  const state = JSON.stringify({ nonce, target: options.redirect, affCode: options.affCode, platform, auth_attribution: options.authAttribution })
  const secure = location.protocol === 'https:'
  set(oauthCookieName(nonce, secure), await digestOAuthState(state), { ...oauthCookieOptions(secure), maxAge: 600 })
  return state
}

const useAuth = {
  async requestAuth(options: { redirect: string; affCode: string; authAttribution?: WebAuthAttribution }) {
    const $config = useRuntimeConfig().public
    const url = `https://accounts.google.com/o/oauth2/v2/auth`
    const params = {
      client_id: $config.GOOGLE_OAUTH_CLIENT_ID as string,
      redirect_uri: oauthRedirectUri(String($config.AUTH_BASE_URL)),
      scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
      response_type: 'code',
      state: await createState('google', options)
    }

    location.href = url + '?' + new URLSearchParams(params)
  },
  async requestAppleAuth(options: { redirect: string; affCode: string; authAttribution?: AcquisitionAuthAttribution }) {
    const $config = useRuntimeConfig().public
    const url = `https://appleid.apple.com/auth/authorize`
    const params = {
      client_id: $config.APPLE_OAUTH_CLIENT_ID as string,
      redirect_uri: oauthRedirectUri(String($config.AUTH_BASE_URL)),
      response_type: 'code',
      response_mode: 'query',
      state: await createState('apple', options)
    }

    location.href = url + '?' + new URLSearchParams(params)
  },
  async grantAuth(code: string, state: string, signal: AbortSignal): Promise<string> {
    const response = await postWebSession({ action: 'login', code, state }, getClientEventHeaders(), signal)
    if (signal.aborted) throw signal.reason
    if (response.status === 504) throw new DOMException('Login timed out', 'TimeoutError')
    if (!response.ok) throw new Error('Login exchange failed')
    const result = await response.json() as { target?: string } | null
    if (typeof result?.target !== 'string') throw new Error('Invalid login response')
    return result.target
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
