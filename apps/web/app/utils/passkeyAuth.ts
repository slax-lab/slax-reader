import { AccountEmailAuthStaleError } from '~/utils/accountEmailAuthRequest'

export const passkeyAuthErrorKey = (error: unknown): string => {
  if (error instanceof AccountEmailAuthStaleError) return 'email_auth.stale_session'
  if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError' || (error.cause instanceof Error && error.cause.name === 'NotAllowedError') || ('code' in error && error.code === 'ERROR_CEREMONY_ABORTED'))) {
    return 'passkey_auth.canceled'
  }
  return 'passkey_auth.failed'
}
