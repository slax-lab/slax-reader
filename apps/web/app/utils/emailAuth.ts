import { AccountEmailAuthStaleError } from '~/utils/accountEmailAuthRequest'

import { RequestError } from '@commons/frontend-utils/request'
import { ErrorName } from '@slax-reader/contracts/errors'

export const authReturnTarget = (target: string, origin: string): string => {
  try {
    const url = new URL(target, origin)
    if (target && url.origin === origin && !url.username && !url.password && !/^\/(?:login|auth)\/?$/.test(url.pathname)) {
      return url.href
    }
  } catch {
    // The login continuation is supplied by the caller or the URL.
  }
  return '/bookmarks'
}

const emailAuthErrors: Record<string, string> = {
  [ErrorName.EMAIL_VERIFY_CODE_ERROR]: 'invalid_code',
  [ErrorName.EMAIL_VERIFY_CODE_RATE_LIMIT]: 'too_many_attempts',
  [ErrorName.EMAIL_VERIFY_CODE_EXISTS]: 'resend_wait',
  [ErrorName.EMAIL_AUTH_USE_EXISTING_LOGIN]: 'use_existing_login',
  [ErrorName.EMAIL_AUTH_IDENTITY_CONFLICT]: 'identity_conflict',
  [ErrorName.EMAIL_AUTH_UNAVAILABLE]: 'unavailable',
  [ErrorName.TOO_MANY_REQUESTS]: 'too_many_requests'
}

export const emailAuthErrorKey = (error: unknown, fallback: string) => {
  if (error instanceof AccountEmailAuthStaleError) return 'email_auth.stale_session'
  return `email_auth.${(error instanceof RequestError && emailAuthErrors[error.name]) || fallback}`
}
