import { configuredCookieName, persistSessionCookie, readStringCookie } from '~/utils/authCookie'
import { clearPendingEmailLogins } from '~/utils/pendingEmailLogin'
import { beginSignInLanguage, completeSignInLanguage } from '~/utils/signInLanguage'

import type { FetchOptions } from '@commons/frontend-utils/request'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { EmailCodeInput, EmailLinkInput } from '@slax-reader/contracts/email-auth'
import { type AcquisitionAuthAttribution, isAcquisitionAuthAttribution, isSnapshotAuthAttribution, type WebAuthAttribution } from '@slax-reader/contracts/events'
import type { PasskeyLoginRequest } from '@slax-reader/contracts/passkey'
import { useCookies } from '@vueuse/integrations/useCookies'
import { hasInterruptedUpload, interruptedUploadKey } from '~/local-first/interrupted-upload'
import { useUserStore } from '~/stores/user'

const cookies = useCookies()
const { remove } = cookies

const completeAuth = async (response: { token: string } | undefined, method: 'google' | 'apple' | 'email', cookieDomain: string, signal?: AbortSignal) => {
  signal?.throwIfAborted()
  if (!response?.token) throw new Error('login failed')
  const persisted = await persistSessionCookie(response.token, signal)
  signal?.throwIfAborted()
  if (!persisted) throw new Error('login failed')
  completeSignInLanguage(method, response.token, cookieDomain)
  clearPendingEmailLogins()
  return response.token
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
      state: JSON.stringify({
        nonce: 'random',
        redirectUrl: `${$config.AUTH_BASE_URL}/auth`,
        target: redirect,
        affCode: affCode,
        platform: 'google',
        auth_attribution: authAttribution
      })
    }

    beginSignInLanguage('google', useNuxtApp().$i18n.locale.value, $config.COOKIE_DOMAIN)
    location.href = url + '?' + new URLSearchParams(params)
  },
  async requestAppleAuth(options: { redirect: string; affCode: string; authAttribution?: WebAuthAttribution }) {
    const { redirect, affCode, authAttribution } = options
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
        platform: 'apple',
        auth_attribution: authAttribution
      })
    }

    beginSignInLanguage('apple', useNuxtApp().$i18n.locale.value, $config.COOKIE_DOMAIN)
    location.href = url + '?' + new URLSearchParams(params)
  },
  async grantAuth(
    code: string,
    redirectUri: string,
    affCode: string,
    platformType: 'google' | 'apple' = 'google',
    authAttribution?: WebAuthAttribution,
    options: Pick<FetchOptions, 'signal' | 'errorInterceptors'> = {}
  ): Promise<string> {
    const $config = useRuntimeConfig().public
    const clientIdRef = {
      apple: `${$config.APPLE_OAUTH_CLIENT_ID}`,
      google: `${$config.GOOGLE_OAUTH_CLIENT_ID}`
    }

    const resp = await request().post<{ token: string }>({
      ...options,
      url: RESTMethodPath.LOGIN,
      body: {
        code,
        aff_code: affCode,
        redirect_uri: redirectUri,
        type: platformType,
        client_id: clientIdRef[platformType],
        ...(authAttribution && (platformType === 'google' || isAcquisitionAuthAttribution(authAttribution) || isSnapshotAuthAttribution(authAttribution)) ? { auth_attribution: authAttribution } : {})
      }
    })

    return completeAuth(resp, platformType, $config.COOKIE_DOMAIN, options.signal)
  },
  async verifyEmailAuth(
    input: EmailCodeInput & { aff_code?: string; auth_attribution?: WebAuthAttribution },
    options: Pick<FetchOptions, 'signal' | 'errorInterceptors'> = {}
  ): Promise<string> {
    const config = useRuntimeConfig().public
    const cookieName = configuredCookieName(config.COOKIE_TOKEN_NAME)
    if (!cookieName) throw new Error('Missing valid COOKIE_TOKEN_NAME')
    if (readStringCookie(cookieName, cookies)) throw new Error('A session is already active')
    const response = await request().post<{ token: string }>({
      ...options,
      url: RESTMethodPath.LOGIN,
      body: { ...input, type: 'email' }
    })
    options.signal?.throwIfAborted()
    if (readStringCookie(cookieName, cookies)) throw new Error('A session is already active')
    return completeAuth(response, 'email', config.COOKIE_DOMAIN, options.signal)
  },
  async verifyEmailLinkAuth(input: EmailLinkInput, options: Pick<FetchOptions, 'signal' | 'errorInterceptors'> = {}): Promise<string> {
    const config = useRuntimeConfig().public
    const cookieName = configuredCookieName(config.COOKIE_TOKEN_NAME)
    if (!cookieName) throw new Error('Missing valid COOKIE_TOKEN_NAME')
    if (readStringCookie(cookieName, cookies)) throw new Error('A session is already active')
    const response = await request().post<{ token: string }>({ ...options, url: RESTMethodPath.LOGIN, body: { ...input, type: 'email_link' } })
    options.signal?.throwIfAborted()
    if (readStringCookie(cookieName, cookies)) throw new Error('A session is already active')
    return completeAuth(response, 'email', config.COOKIE_DOMAIN, options.signal)
  },
  async verifyPasskeyAuth(
    input: PasskeyLoginRequest,
    options: Pick<FetchOptions, 'signal' | 'errorInterceptors'> = {}
  ): Promise<string> {
    const config = useRuntimeConfig().public
    const cookieName = configuredCookieName(config.COOKIE_TOKEN_NAME)
    if (!cookieName) throw new Error('Missing valid COOKIE_TOKEN_NAME')
    if (readStringCookie(cookieName, cookies)) throw new Error('A session is already active')
    const response = await request().post<{ token: string }>({ ...options, url: RESTMethodPath.LOGIN, body: input })
    options.signal?.throwIfAborted()
    if (readStringCookie(cookieName, cookies)) throw new Error('A session is already active')
    return completeAuth(response, 'email', config.COOKIE_DOMAIN, options.signal)
  },
  async clearAuth(intent?: 'sign-out'): Promise<void> {
    // Anonymous startup may have bypassed the database. Its next owner guard must still discard the queue.
    if (intent === 'sign-out' && hasInterruptedUpload()) localStorage.setItem(interruptedUploadKey, 'discard')
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
