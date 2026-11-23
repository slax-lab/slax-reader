import type { WebAuthAttribution } from './events.js'

export const BIND_LOGIN_IDENTITY_SETTING = 'bind_login_identity'

export interface EmailCodeSendInput {
  email: string
  locale?: string
  purpose?: 'login' | 'bind'
}

export interface EmailCodeChallenge {
  request_id: string
  expires_in: number
  resend_after: number
}

export interface EmailCodeInput {
  email: string
  request_id: string
  code: string
}

export interface EmailLoginRequest extends EmailCodeInput {
  type: 'email'
  auth_attribution?: WebAuthAttribution
}

export interface EmailLinkInput {
  email: string
  request_id: string
  token: string
}

export interface EmailLinkLoginRequest extends EmailLinkInput {
  type: 'email_link'
  auth_attribution?: WebAuthAttribution
}

export type EmailAuthProvider = 'google' | 'apple'
export type EmailAuthClientPlatform = 'web' | 'ios' | 'android'

export type BindLinkRequest =
  | { platform: 'telegram' | 'twitter' }
  | { platform: EmailAuthProvider; client_platform: EmailAuthClientPlatform }

export interface EmailAuthProviderChallenge {
  type: EmailAuthProvider
  state: string
  nonce: string
}

export const EMAIL_LOGIN_PATH = '/email-login'
export const EMAIL_LOGIN_WEB_PATH = '/email-login-web'
export const EMAIL_LOGIN_WEB_ORIGINS = ['https://r.slax.dev', 'https://r-beta.slax.com', 'https://r.slax.com'] as const

export function parseEmailLinkProof(params: { get(name: string): string | null }): EmailLinkInput | null {
  const email = params.get('email'), request_id = params.get('request_id'), token = params.get('token')
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !request_id || !/^[a-zA-Z0-9_-]{16,128}$/.test(request_id)
    || !token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null
  return { email, request_id, token }
}
