export const EMAIL_AUTH_PATH = {
  send: '/v1/user/login/email/send',
  bind: '/v1/user/bind'
} as const

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

export interface EmailAuthProviderChallenge {
  state: string
  nonce: string
}
