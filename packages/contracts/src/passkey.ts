import type { WebAuthAttribution } from './events.js'

// JSON wire types intentionally contain no browser/runtime dependencies.
export interface RegistrationResponseJSON {
  id: string
  rawId: string
  type: 'public-key'
  response: { clientDataJSON: string; attestationObject: string; transports?: string[] }
  clientExtensionResults: { credProps?: { rk?: boolean }; appid?: boolean; hmacCreateSecret?: boolean }
  authenticatorAttachment?: 'platform' | 'cross-platform'
}

export interface AuthenticationResponseJSON {
  id: string
  rawId: string
  type: 'public-key'
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string }
  clientExtensionResults: { appid?: boolean; hmacCreateSecret?: boolean }
  authenticatorAttachment?: 'platform' | 'cross-platform'
}

interface CredentialDescriptorJSON {
  id: string
  type: string
  transports?: string[]
}

export interface PublicKeyCredentialCreationOptionsJSON {
  challenge: string
  rp: { id?: string; name: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: { type: 'public-key'; alg: number }[]
  timeout?: number
  excludeCredentials?: CredentialDescriptorJSON[]
  authenticatorSelection?: { residentKey?: 'required' | 'preferred' | 'discouraged'; userVerification?: 'required' | 'preferred' | 'discouraged'; authenticatorAttachment?: 'platform' | 'cross-platform' }
  attestation?: 'none' | 'indirect' | 'direct' | 'enterprise'
  extensions?: { credProps?: boolean }
}

export interface PublicKeyCredentialRequestOptionsJSON {
  challenge: string
  rpId?: string
  timeout?: number
  allowCredentials?: CredentialDescriptorJSON[]
  userVerification?: 'required' | 'preferred' | 'discouraged'
}

export const DELETE_PASSKEY_SETTING = 'delete_passkey'

export type PasskeyChallengeRequest = { purpose: 'register' } | { purpose: 'login'; email: string }

export interface PasskeyRegistrationChallenge {
  purpose: 'register'
  request_id: string
  options: PublicKeyCredentialCreationOptionsJSON
}

export interface PasskeyAuthenticationChallenge {
  purpose: 'login'
  request_id: string
  options: PublicKeyCredentialRequestOptionsJSON
}

export interface PasskeyRegistrationInput {
  type: 'passkey'
  request_id: string
  credential: RegistrationResponseJSON
  name: string
}

export interface PasskeyLoginRequest {
  type: 'passkey'
  email: string
  request_id: string
  credential: AuthenticationResponseJSON
  auth_attribution?: WebAuthAttribution
}

export interface PasskeyInfo {
  uuid: string
  name: string
  created_at: string
  last_used_at: string | null
}
