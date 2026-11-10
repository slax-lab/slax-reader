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

export interface EmailAuthIdentities {
  enabled: boolean
  show_email_binding: boolean
  email: string | null
  google: boolean
  apple: boolean
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
