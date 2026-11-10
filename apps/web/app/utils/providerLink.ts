import type { AccountEmailAuthRequest } from '~/utils/accountEmailAuthRequest'

import type { FetchOptions } from '@commons/frontend-utils/request'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import { BIND_LOGIN_IDENTITY_SETTING, type BindLinkRequest, type EmailAuthProvider, type EmailAuthProviderChallenge } from '@slax-reader/contracts/email-auth'

const pendingLinkKey = 'slax:pending-provider-link'

export const isProviderLinkState = (state: unknown): state is string => typeof state === 'string' && state.startsWith('link.')

const providerConfig = (provider: EmailAuthProvider) => {
  const config = useRuntimeConfig().public
  return {
    clientId: provider === 'google' ? String(config.GOOGLE_OAUTH_CLIENT_ID) : String(config.APPLE_OAUTH_CLIENT_ID),
    redirectUri: `${config.AUTH_BASE_URL}/auth`
  }
}

export const canLinkProvidersHere = () => {
  if (!import.meta.client) return false
  try {
    return new URL(providerConfig('google').redirectUri).origin === location.origin
  } catch {
    return false
  }
}

export const startProviderLink = async (type: EmailAuthProvider, signal: AbortSignal, account: AccountEmailAuthRequest) => {
  const { clientId, redirectUri } = providerConfig(type)
  if (new URL(redirectUri).origin !== location.origin) throw new Error('Provider callback must use the settings origin')

  const response = await account.api.post<EmailAuthProviderChallenge>({
    url: RESTMethodPath.GET_BIND_LINK,
    body: { platform: type, client_platform: 'web' } satisfies BindLinkRequest,
    signal,
    errorInterceptors: () => {}
  })
  signal.throwIfAborted()
  if (response?.type !== type) throw new Error('Provider linking did not start')

  account.assertCurrentAccount()
  const { state, nonce } = response
  sessionStorage.setItem(pendingLinkKey, `${type}:${state}`)
  const url = new URL(type === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://appleid.apple.com/auth/authorize')
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    nonce,
    ...(type === 'google' ? { scope: 'openid email profile' } : { response_mode: 'query' })
  }).toString()
  location.href = url.href
}

export const takePendingProviderLink = (state: string): EmailAuthProvider | undefined => {
  const stored = sessionStorage.getItem(pendingLinkKey)
  const type = stored === `google:${state}` ? 'google' : stored === `apple:${state}` ? 'apple' : undefined
  if (type) sessionStorage.removeItem(pendingLinkKey)
  return type
}

export const finishProviderLink = async (state: string, type: EmailAuthProvider, code: string, options: Pick<FetchOptions, 'signal' | 'errorInterceptors'>) => {
  const { clientId, redirectUri } = providerConfig(type)
  const response = await request().post<{ linked: true }>({
    ...options,
    url: RESTMethodPath.USER_INFO_SETTING,
    body: { key: BIND_LOGIN_IDENTITY_SETTING, value: { state, type, platform: 'web', code, redirect_uri: redirectUri, client_id: clientId } }
  })
  if (!response?.linked) throw new Error('Provider linking failed')
}
