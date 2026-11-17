import { AccountEmailAuthStaleError } from '~/utils/accountEmailAuthRequest'

import { RequestError } from '@commons/frontend-utils/request'
import { sendSignal } from '@simplewebauthn/browser'
import { ErrorName } from '@slax-reader/contracts/errors'
import type { PasskeyCredentialState } from '@slax-reader/contracts/passkey'

export const passkeyAuthErrorKey = (error: unknown): string => {
  if (error instanceof AccountEmailAuthStaleError) return 'email_auth.stale_session'
  if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError' || (error.cause instanceof Error && error.cause.name === 'NotAllowedError') || ('code' in error && error.code === 'ERROR_CEREMONY_ABORTED'))) {
    return 'passkey_auth.canceled'
  }
  return 'passkey_auth.failed'
}

export interface PasskeyAuthenticationMode {
  useBrowserAutofill?: boolean
  onCredential?: () => void
}

export const signalAcceptedPasskeys = async (state: PasskeyCredentialState): Promise<void> => {
  try {
    await sendSignal({ signalName: 'allAcceptedCredentials', rpID: state.rp_id, userID: state.user_handle, allAcceptedCredentialIDs: state.credential_ids })
  } catch {
    // Browser credential-manager synchronization is best effort; server deletion already succeeded.
  }
}

export const signalUnknownPasskey = async (error: unknown, rpId: string, credentialId: string): Promise<void> => {
  if (!(error instanceof RequestError) || error.name !== ErrorName.PASSKEY_CREDENTIAL_UNKNOWN) return
  try {
    await sendSignal({ signalName: 'unknownCredential', rpID: rpId, credentialID: credentialId })
  } catch {
    // Keep the original authentication result when credential-manager synchronization is unavailable.
  }
}
