import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server'
import type { AuthenticationResponseJSON, PasskeyLoginRequest, PasskeyRegistrationInput, RegistrationResponseJSON } from '@slax-reader/contracts/passkey'
import { ErrorParam, PasskeyVerificationError } from '@/const/err'
import { PASSKEY_CONFIG } from '@/const/passkey'

export function passkeyConfiguration(env: Pick<Env, 'FRONT_END_URL' | 'PASSKEY_ANDROID_ORIGINS'>) {
  const site = new URL(env.FRONT_END_URL)
  const androidOrigins =
    env.PASSKEY_ANDROID_ORIGINS?.split(',')
      .map(value => value.trim())
      .filter(Boolean) ?? []
  if (androidOrigins.some(origin => !/^android:apk-key-hash:[A-Za-z0-9_-]{43}$/.test(origin))) throw new Error('Invalid PASSKEY_ANDROID_ORIGINS signing origin')
  return {
    rpId: site.hostname,
    origins: [site.origin, ...androidOrigins]
  }
}

export function parsePasskeyEmail(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw ErrorParam()
  return value.trim()
}

export function parsePasskeyProof(value: unknown, purpose: 'register'): PasskeyRegistrationInput
export function parsePasskeyProof(value: unknown, purpose: 'login'): PasskeyLoginRequest
export function parsePasskeyProof(value: unknown, purpose: 'register' | 'login'): PasskeyRegistrationInput | PasskeyLoginRequest {
  if (!value || typeof value !== 'object') throw ErrorParam()
  const input = value as Record<string, unknown>
  if (input.type !== 'passkey' || typeof input.request_id !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(input.request_id)) throw ErrorParam()
  const credential = input.credential as RegistrationResponseJSON | AuthenticationResponseJSON | undefined
  if (!credential || typeof credential !== 'object' || credential.type !== 'public-key' || typeof credential.id !== 'string' || credential.id.length > 4096 || !credential.response)
    throw ErrorParam()
  if (purpose === 'register') {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > PASSKEY_CONFIG.MAX_NAME_LENGTH) throw ErrorParam()
    return { type: 'passkey', request_id: input.request_id, credential: credential as RegistrationResponseJSON, name: input.name.trim() }
  }
  return { type: 'passkey', request_id: input.request_id, credential: credential as AuthenticationResponseJSON, email: parsePasskeyEmail(input.email) }
}

export async function verifyPasskeyRegistration(response: RegistrationResponseJSON, challenge: string, rpId: string, origins: string[]) {
  try {
    const result = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: origins, expectedRPID: rpId, requireUserVerification: true })
    if (!result.verified) throw PasskeyVerificationError()
    const { credential } = result.registrationInfo
    return { credential_id: credential.id, public_key: credential.publicKey, counter: BigInt(credential.counter), transports: credential.transports ?? [] }
  } catch {
    throw PasskeyVerificationError()
  }
}

export async function verifyPasskeyAuthentication(
  response: AuthenticationResponseJSON,
  challenge: string,
  rpId: string,
  origins: string[],
  credential: { credential_id: string; public_key: Uint8Array; counter: bigint; transports: string[] },
  userUuid: string
): Promise<bigint> {
  const expectedHandle = btoa(userUuid).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  if (response.response.userHandle && response.response.userHandle !== expectedHandle) throw PasskeyVerificationError()
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origins,
      expectedRPID: rpId,
      requireUserVerification: true,
      credential: { id: credential.credential_id, publicKey: new Uint8Array(credential.public_key), counter: Number(credential.counter), transports: credential.transports }
    })
    if (!result.verified) throw PasskeyVerificationError()
    return BigInt(result.authenticationInfo.newCounter)
  } catch {
    throw PasskeyVerificationError()
  }
}
