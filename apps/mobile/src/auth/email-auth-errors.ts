import type {AppMessageKey} from '../i18n';

export function emailAuthError(error: unknown): AppMessageKey | undefined {
  if (!(error instanceof Error)) return undefined;
  switch ('data' in error && error.data) {
    case 'EMAIL_VERIFY_CODE_ERROR': return 'email_auth_invalid_code';
    case 'EMAIL_VERIFY_CODE_RATE_LIMIT': return 'email_auth_attempts';
    case 'TOO_MANY_REQUESTS': return 'email_auth_rate_limit';
    case 'EMAIL_AUTH_USE_EXISTING_LOGIN': return 'email_auth_existing_account';
    case 'EMAIL_AUTH_IDENTITY_CONFLICT': return 'email_auth_conflict';
    case 'EMAIL_AUTH_UNAVAILABLE': return 'email_auth_unavailable';
    case 'OAUTH2_STATE_EXPIRED': return 'email_auth_link_expired';
  }
  if ('status' in error && error.status === 429) return 'email_auth_rate_limit';
}
