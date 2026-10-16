import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'

const keys = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock('jose', async importOriginal => ({
  ...(await importOriginal<typeof import('jose')>()),
  createRemoteJWKSet: () => keys.resolve
}))

import { AppleAuth } from '@/utils/authLogin/authApple'

const baseEnv = {
  APPLE_WEB_CLIENT_ID: 'reader.web',
  APPLE_NATIVE_CLIENT_IDS: 'app.slax.reader',
  APPLE_SIGN_KEY_ID: 'synthetic-key-id',
  APPLE_SIGN_TEAM_ID: 'synthetic-team-id',
  APPLE_SIGN_AUTH_KEY: 'private-key-do-not-log'
}
const code = 'authorization-code-do-not-log'
const clientSecret = 'client-secret-do-not-log'
const clientToken = 'identity-token-do-not-log'
const sensitiveMessage = 'user@example.test provider-message-do-not-log'

type FailureLog = { stage: string; reason: string; missingConfig: string[]; [key: string]: unknown }
type SigningAccess = { getClientSecret(clientId: string): Promise<string> }

function service(overrides: Partial<typeof baseEnv> = {}, platform = 'ios') {
  return new AppleAuth({ ...baseEnv, ...overrides } as Env, platform)
}

function stubSigning(auth: AppleAuth) {
  return vi.spyOn(auth as unknown as SigningAccess, 'getClientSecret').mockResolvedValue(clientSecret)
}

function failures(): FailureLog[] {
  return vi.mocked(console.error).mock.calls.map(([message]) => JSON.parse(String(message).replace('[login] apple failed ', '')))
}

function expectPrivateLogs(extra: string[] = []) {
  const logs = JSON.stringify(vi.mocked(console.error).mock.calls)
  for (const value of [baseEnv.APPLE_SIGN_AUTH_KEY, baseEnv.APPLE_SIGN_KEY_ID, baseEnv.APPLE_SIGN_TEAM_ID, code, clientSecret, clientToken, sensitiveMessage, ...extra]) {
    expect(logs).not.toContain(value)
  }
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => vi.restoreAllMocks())

describe('Apple login configuration diagnostics', () => {
  test.each([
    { overrides: { APPLE_WEB_CLIENT_ID: '' }, reason: 'missing_web_client_id', missing: 'APPLE_WEB_CLIENT_ID' },
    { overrides: { APPLE_NATIVE_CLIENT_IDS: '' }, reason: 'missing_client_id', missing: 'APPLE_NATIVE_CLIENT_IDS' },
    { overrides: { APPLE_NATIVE_CLIENT_IDS: ' , , ' }, reason: 'missing_client_id', missing: 'APPLE_NATIVE_CLIENT_IDS' }
  ])('reports $missing without changing the rejection', ({ overrides, reason, missing }) => {
    expect(() => service(overrides)).toThrow('Apple login failed')
    expect(failures()).toEqual([expect.objectContaining({ stage: 'configuration', reason, missingConfig: [missing] })])
    expectPrivateLogs()
  })

  test('identifies overlapping web and native clients', () => {
    expect(() => service({ APPLE_WEB_CLIENT_ID: 'app.slax.reader' })).toThrow('Apple login failed')
    expect(failures()[0]).toMatchObject({ stage: 'configuration', reason: 'web_native_client_id_overlap', missingConfig: [] })
  })

  test('reports an absent private key and preserves the original constructor error', () => {
    expect(() => service({ APPLE_SIGN_AUTH_KEY: undefined })).toThrow(TypeError)
    expect(failures()[0]).toMatchObject({ stage: 'configuration', reason: 'private_key_normalization_failed', missingConfig: ['APPLE_SIGN_AUTH_KEY'], errorCode: 'TypeError' })
    expectPrivateLogs()
  })

  test('does not print untrusted platform or client identifiers', async () => {
    const untrusted = 'untrusted-input-do-not-log'
    expect(() => service({}, untrusted)).toThrow('Apple login failed')
    expect(failures()[0]).toMatchObject({ reason: 'unsupported_platform', platform: 'unsupported' })
    const auth = service()
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(auth.loginWithApple(code, clientToken, untrusted)).rejects.toMatchObject({ name: 'REUQEST_APPLE_AUTH_FAIL' })
    expect(fetch).not.toHaveBeenCalled()
    expect(failures()[1]).toMatchObject({ stage: 'configuration', reason: 'unconfigured_client_id' })
    expectPrivateLogs([untrusted])
  })
})

describe('Apple signing and token exchange diagnostics', () => {
  test('identifies a private key import failure before any network request', async () => {
    const auth = service()
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(auth.loginWithApple(code, clientToken, '')).rejects.toMatchObject({ name: 'REUQEST_APPLE_AUTH_FAIL' })
    expect(fetch).not.toHaveBeenCalled()
    expect(failures()[0]).toMatchObject({ stage: 'client_secret', missingConfig: [] })
    expectPrivateLogs()
  })

  test.each(['APPLE_SIGN_KEY_ID', 'APPLE_SIGN_TEAM_ID'] as const)('names missing %s when Apple rejects the credentials', async name => {
    const auth = service({ [name]: '' })
    stubSigning(auth)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'invalid_client' }, { status: 400 }))
    await expect(auth.loginWithApple(code, clientToken, '')).rejects.toMatchObject({ name: 'REUQEST_APPLE_AUTH_FAIL' })
    expect(failures()[0]).toMatchObject({ stage: 'token_exchange', appleError: 'invalid_client', missingConfig: [name] })
    expectPrivateLogs()
  })

  test.each(['invalid_client', 'invalid_grant', 'invalid_request'])('records Apple %s and status without response contents', async appleError => {
    const auth = service()
    stubSigning(auth)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: appleError, error_description: sensitiveMessage, code, id_token: clientToken }, { status: 400 }))
    await expect(auth.loginWithApple(code, clientToken, '')).rejects.toMatchObject({ name: 'REUQEST_APPLE_AUTH_FAIL', errCode: 500 })
    expect(failures()[0]).toMatchObject({ stage: 'token_exchange', reason: 'apple_rejected_request', status: 400, appleError, clientId: 'app.slax.reader', hasRedirectUri: false })
    expectPrivateLogs()
  })

  test.each(['unknown_error', sensitiveMessage])('redacts unrecognized provider error %s', async appleError => {
    const auth = service()
    stubSigning(auth)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: appleError }, { status: 400 }))
    await expect(auth.loginWithApple(code, clientToken, '')).rejects.toBeDefined()
    expect(failures()[0]).toMatchObject({ status: 400, appleError: 'unrecognized' })
    expectPrivateLogs([appleError])
  })

  test('retains the provider HTTP status when the error response is not JSON', async () => {
    const auth = service()
    stubSigning(auth)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(sensitiveMessage, { status: 502 }))
    await expect(auth.loginWithApple(code, clientToken, '')).rejects.toMatchObject({ name: 'REUQEST_APPLE_AUTH_FAIL' })
    expect(failures()[0]).toMatchObject({ stage: 'token_exchange', status: 502, appleError: 'unrecognized' })
    expectPrivateLogs()
  })

  test('reports transport failures without exception messages', async () => {
    const auth = service()
    stubSigning(auth)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError(sensitiveMessage))
    await expect(auth.loginWithApple(code, clientToken, '')).rejects.toMatchObject({ name: 'REUQEST_APPLE_AUTH_FAIL' })
    expect(failures()[0]).toMatchObject({ stage: 'token_exchange', errorCode: 'TypeError' })
    expectPrivateLogs()
  })
})

describe('Apple identity verification diagnostics', () => {
  async function build() {
    const pair = await generateKeyPair('RS256')
    keys.resolve.mockImplementation(createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'test' }] }))
    const sign = (audience = 'app.slax.reader', subject = 'synthetic-user', expiration: string | number = '1h') =>
      new SignJWT({ email: 'identity-email-do-not-log@example.test', email_verified: true })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer('https://appleid.apple.com')
        .setSubject(subject)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(expiration)
        .sign(pair.privateKey)
    const auth = service({ APPLE_NATIVE_CLIENT_IDS: 'another.native,app.slax.reader' })
    stubSigning(auth)
    return { auth, sign }
  }

  test.each(['exchanged_id_token', 'client_id_token'])('identifies a wrong audience in %s', async stage => {
    const { auth, sign } = await build()
    const valid = await sign()
    const wrongAudience = await sign('wrong.audience')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id_token: stage === 'exchanged_id_token' ? wrongAudience : valid }))
    await expect(auth.loginWithApple(code, stage === 'client_id_token' ? wrongAudience : valid, 'app.slax.reader')).rejects.toMatchObject({ name: 'REUQEST_APPLE_AUTH_FAIL' })
    expect(failures()[0]).toMatchObject({ stage, errorCode: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud', defaultClientId: 'another.native', clientId: 'app.slax.reader' })
    expectPrivateLogs([valid, wrongAudience, 'identity-email-do-not-log@example.test', 'synthetic-user'])
  })

  test('identifies expired identities', async () => {
    const { auth, sign } = await build()
    const expired = await sign('app.slax.reader', 'synthetic-user', Math.floor(Date.now() / 1000) - 60)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id_token: expired }))
    await expect(auth.loginWithApple(code, clientToken, 'app.slax.reader')).rejects.toBeDefined()
    expect(failures()[0]).toMatchObject({ stage: 'exchanged_id_token', errorCode: 'ERR_JWT_EXPIRED' })
    expectPrivateLogs([expired])
  })

  test('identifies a subject mismatch without logging either subject', async () => {
    const { auth, sign } = await build()
    const exchanged = await sign()
    const client = await sign('app.slax.reader', 'different-user-do-not-log')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id_token: exchanged }))
    await expect(auth.loginWithApple(code, client, 'app.slax.reader')).rejects.toBeDefined()
    expect(failures()[0]).toMatchObject({ stage: 'subject_match' })
    expectPrivateLogs([exchanged, client, 'synthetic-user', 'different-user-do-not-log'])
  })

  test('preserves successful verification and emits no failure log', async () => {
    const { auth, sign } = await build()
    const token = await sign()
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id_token: token }))
    await expect(auth.loginWithApple(code, token, 'app.slax.reader')).resolves.toMatchObject({ sub: 'synthetic-user', aud: 'app.slax.reader' })
    const params = fetch.mock.calls[0][1]?.body as URLSearchParams
    expect(params.get('client_id')).toBe('app.slax.reader')
    expect(params.get('code')).toBe(code)
    expect(params.get('client_secret')).toBe(clientSecret)
    expect(params.has('redirect_uri')).toBe(false)
    expect(console.error).not.toHaveBeenCalled()
  })
})
