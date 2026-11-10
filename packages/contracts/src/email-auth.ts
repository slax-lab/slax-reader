export const EMAIL_AUTH_PATH = {
  status: '/v1/user/login/email/status',
  send: '/v1/user/login/email/send',
  verify: '/v1/user/login/email/verify',
  identities: '/v1/user/auth/identities',
  bindSend: '/v1/user/auth/email/send',
  bindVerify: '/v1/user/auth/email/verify',
  providerStart: '/v1/user/auth/provider/start',
  providerFinish: '/v1/user/auth/provider/finish'
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

export interface EmailAuthStatus {
  enabled: boolean
}

export interface EmailAuthProviderChallenge {
  state: string
  nonce: string
}
