import { configuredCookieName, readStringCookie, setAuthCookie } from '~/utils/authCookie'
import { createOAuthNonce, oauthAttemptCookie, oauthAttemptMaxAge, oauthStateDigest } from '~/utils/oauthAttempt'
import { writeWebSession } from '~/utils/webSession'

import type { FetchOptions } from '@commons/frontend-utils/request'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import { type AcquisitionAuthAttribution, isAcquisitionAuthAttribution, type WebAuthAttribution } from '@slax-reader/contracts/events'
import { useCookies } from '@vueuse/integrations/useCookies'
import { useUserStore } from '~/stores/user'

const cookies = useCookies()
const { get, set, remove } = cookies
const attemptOptions = () => ({ path: '/', secure: location.protocol === 'https:', sameSite: 'lax' as const })

const bindOAuthState = async (fields: Record<string, unknown>) => {
  const state = JSON.stringify({ nonce: createOAuthNonce(), ...fields })
  const options = attemptOptions()
  set(oauthAttemptCookie(options.secure), await oauthStateDigest(state), { ...options, maxAge: oauthAttemptMaxAge })
  return state
}

const useAuth = {
  async requestAuth(options: { redirect: string; affCode: string; authAttribution?: WebAuthAttribution }) {
    const { redirect, affCode, authAttribution } = options
    const $config = useRuntimeConfig().public
    const url = `https://accounts.google.com/o/oauth2/v2/auth`
    const params = {
      client_id: $config.GOOGLE_OAUTH_CLIENT_ID as string,
      redirect_uri: `${$config.AUTH_BASE_URL}/auth`,
      scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
      response_type: 'code',
      state: await bindOAuthState({
        redirectUrl: `${$config.AUTH_BASE_URL}/auth`,
        target: redirect,
        affCode: affCode,
        platform: 'google',
        auth_attribution: authAttribution
      })
    }

    location.href = url + '?' + new URLSearchParams(params)
  },
  async requestAppleAuth(options: { redirect: string; affCode: string; authAttribution?: AcquisitionAuthAttribution }) {
    const { redirect, affCode, authAttribution } = options
    const $config = useRuntimeConfig().public
    const url = `https://appleid.apple.com/auth/authorize`
    const params = {
      client_id: $config.APPLE_OAUTH_CLIENT_ID as string,
      redirect_uri: `${$config.AUTH_BASE_URL}/auth`,
      response_type: 'code',
      response_mode: 'query',
      state: await bindOAuthState({
        redirectUrl: `${$config.AUTH_BASE_URL}/auth`,
        target: redirect,
        affCode: affCode,
        platform: 'apple',
        auth_attribution: authAttribution
      })
    }

    location.href = url + '?' + new URLSearchParams(params)
  },
  async grantAuth(
    code: string,
    redirectUri: string,
    affCode: string,
    platformType: 'google' | 'apple',
    authAttribution: WebAuthAttribution | undefined,
    options: Pick<FetchOptions, 'signal' | 'errorInterceptors'> & { state: string }
  ): Promise<string> {
    const $config = useRuntimeConfig().public
    const clientIdRef = {
      apple: `${$config.APPLE_OAUTH_CLIENT_ID}`,
      google: `${$config.GOOGLE_OAUTH_CLIENT_ID}`
    }

    const { state, ...requestOptions } = options
    const cookieOptions = attemptOptions()
    const attempt = oauthAttemptCookie(cookieOptions.secure)
    const binding = await oauthStateDigest(state)
    if (redirectUri !== `${$config.AUTH_BASE_URL}/auth` || get(attempt, { doNotParse: true }) !== binding) {
      throw new Error('Invalid OAuth attempt')
    }

    const startingSession = readStringCookie($config.COOKIE_TOKEN_NAME, cookies)
    try {
      options.signal?.throwIfAborted()
      const resp = await request().post<{ token: string }>({
        ...requestOptions,
        url: RESTMethodPath.LOGIN,
        body: {
          code,
          aff_code: affCode,
          redirect_uri: redirectUri,
          type: platformType,
          client_id: clientIdRef[platformType],
          ...(authAttribution && (platformType === 'google' || isAcquisitionAuthAttribution(authAttribution)) ? { auth_attribution: authAttribution } : {})
        }
      })

      options.signal?.throwIfAborted()
      if (typeof resp?.token !== 'string' || !resp.token.trim()) throw new Error('login failed')

      if ((await writeWebSession({ action: 'login', state, token: resp.token }, options.signal)) === 'unavailable') {
        options.signal?.throwIfAborted()
        const current = readStringCookie($config.COOKIE_TOKEN_NAME, cookies)
        if (current !== resp.token) {
          if (current !== startingSession || get(attempt, { doNotParse: true }) !== binding) throw new Error('OAuth attempt is no longer current')
          setAuthCookie(cookies, $config.COOKIE_TOKEN_NAME, $config.COOKIE_DOMAIN, resp.token)
        }
      }
      return resp.token
    } finally {
      if (get(attempt, { doNotParse: true }) === binding) remove(attempt, cookieOptions)
    }
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
