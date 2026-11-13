import { describe, expect, test } from 'vitest'
import { passkeyConfiguration, parsePasskeyProof, verifyPasskeyAuthentication, verifyPasskeyRegistration } from '@/utils/passkey'
import { passkeyAuthenticator } from '../helpers/passkeyFixture'

const challenge = '8by02OWxq7MYK29eaVXl2yokukHrfSgbK_-E_CmLF0U'
const rpId = 'r.slax.dev'
const origins = ['https://r.slax.dev']

describe('Passkey protocol boundary', () => {
  test('verifies a real EC registration and assertion including a legitimate zero counter', async () => {
    const authenticator = passkeyAuthenticator()
    const credential = await verifyPasskeyRegistration(authenticator.registration(challenge), challenge, rpId, origins)
    expect(credential).toMatchObject({ credential_id: authenticator.id, counter: 0n, transports: ['internal'] })
    expect(await verifyPasskeyAuthentication(authenticator.assertion(challenge), challenge, rpId, origins, credential, 'opaque-account-uuid')).toBe(0n)
  })

  test.each(['challenge', 'origin', 'rp', 'uv'])('rejects registration with invalid %s', async invalid => {
    const authenticator = passkeyAuthenticator()
    const response = authenticator.registration(challenge, invalid === 'origin' ? 'https://attacker.example.test' : origins[0], invalid !== 'uv')
    await expect(
      verifyPasskeyRegistration(response, invalid === 'challenge' ? 'other-challenge' : challenge, invalid === 'rp' ? 'other.slax.dev' : rpId, origins)
    ).rejects.toMatchObject({ name: 'PASSKEY_VERIFICATION_FAILED' })
  })

  test.each(['challenge', 'origin', 'rp', 'uv', 'handle', 'signature', 'counter'])('rejects assertion with invalid %s', async invalid => {
    const authenticator = passkeyAuthenticator()
    const response = authenticator.assertion(challenge, invalid === 'origin' ? 'https://attacker.example.test' : origins[0], invalid === 'counter' ? 1 : 0, invalid !== 'uv')
    if (invalid === 'handle') response.response.userHandle = btoa('another-account')
    if (invalid === 'signature') response.response.signature = btoa('bad-signature')
    const credential = { credential_id: authenticator.id, public_key: authenticator.public_key, counter: invalid === 'counter' ? 2n : 0n, transports: [] }
    await expect(
      verifyPasskeyAuthentication(
        response,
        invalid === 'challenge' ? 'another-challenge' : challenge,
        invalid === 'rp' ? 'other.slax.dev' : rpId,
        origins,
        credential,
        'opaque-account-uuid'
      )
    ).rejects.toMatchObject({ name: 'PASSKEY_VERIFICATION_FAILED' })
  })

  test('uses only the configured Web origin and explicit Android signing origins', () => {
    const androidOrigin = `android:apk-key-hash:${'A'.repeat(43)}`
    expect(passkeyConfiguration({ FRONT_END_URL: origins[0] })).toEqual({ rpId, origins })
    expect(passkeyConfiguration({ FRONT_END_URL: origins[0], PASSKEY_ANDROID_ORIGINS: ` ${androidOrigin} ` })).toEqual({
      rpId,
      origins: [...origins, androidOrigin]
    })
  })

  test.each(['https://unrelated.example.test', 'android:apk-key-hash:bad', `android:apk-key-hash:${'A'.repeat(43)}=`])('rejects misconfigured Android origin %s', origin => {
    expect(() => passkeyConfiguration({ FRONT_END_URL: origins[0], PASSKEY_ANDROID_ORIGINS: origin })).toThrow()
  })

  test('validates the new proof once before passing it into the domain', async () => {
    const authenticator = passkeyAuthenticator()
    const response = authenticator.registration(challenge)
    expect(parsePasskeyProof({ type: 'passkey', request_id: crypto.randomUUID(), name: ' My phone ', credential: response }, 'register').name).toBe('My phone')
    expect(() => parsePasskeyProof({ type: 'passkey' }, 'login')).toThrow()
    expect(() => parsePasskeyProof({ type: 'passkey', request_id: crypto.randomUUID(), name: 'x'.repeat(65), credential: response }, 'register')).toThrow()
  })
})
