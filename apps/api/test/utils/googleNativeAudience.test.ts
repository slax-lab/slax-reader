import { beforeEach, describe, expect, test, vi } from 'vitest'

const verify = vi.fn()
vi.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: (...args: unknown[]) => verify(...args) }))

import { GoogleAuth } from '@/utils/authLogin/authGoogle'

// Production topology: native ID tokens are issued for the Web OAuth client (aud) and presented by an app client (azp).
const env = {
  GOOGLE_CLIENT_ID_TEXT: 'server-client',
  GOOGLE_IOS_CLIENT_ID_TEXT: 'ios-app-client',
  GOOGLE_ANDROID_CLIENT_ID_TEXT: 'android-debug-client, android-release-client,android-play-client'
} as unknown as Env

const withEnv = (overrides: Record<string, string>) => ({ ...env, ...overrides }) as unknown as Env

const payload = (aud: string, azp?: string) => ({
  iss: 'https://accounts.google.com',
  sub: 'sub-1',
  aud,
  azp,
  iat: 1,
  exp: 2,
  email: 'reader@example.test',
  email_verified: 'true'
})

describe('Google native audience', () => {
  beforeEach(() => verify.mockReset())

  test.each([
    ['ios', 'ios-app-client'],
    ['android', 'android-debug-client'],
    ['android', 'android-release-client'],
    ['android', 'android-play-client']
  ])('accepts a %s token for the server client presented by %s', async (platform, azp) => {
    verify.mockResolvedValue({ payload: payload('server-client', azp) })

    await expect(new GoogleAuth(env, platform).verifyGoogleToken('token')).resolves.toMatchObject({ aud: 'server-client', azp })
    expect(verify).toHaveBeenCalledWith('token', expect.anything(), expect.objectContaining({ audience: 'server-client' }))
  })

  test.each([
    ['ios', undefined],
    ['ios', 'android-play-client'],
    ['ios', 'server-client'],
    ['android', 'ios-app-client'],
    ['android', 'unknown-client']
  ])('rejects a %s token whose authorized party is %s', async (platform, azp) => {
    verify.mockResolvedValue({ payload: payload('server-client', azp) })

    await expect(new GoogleAuth(env, platform).verifyGoogleToken('token')).rejects.toBeDefined()
  })

  test('rejects a native token whose audience is another client', async () => {
    verify.mockResolvedValue({ payload: payload('ios-app-client', 'ios-app-client') })

    await expect(new GoogleAuth(env, 'ios').verifyGoogleToken('token')).rejects.toBeDefined()
  })

  test.each([
    ['ios', { GOOGLE_IOS_CLIENT_ID_TEXT: '' }],
    ['android', { GOOGLE_ANDROID_CLIENT_ID_TEXT: ' , ' }],
    ['ios', { GOOGLE_IOS_CLIENT_ID_TEXT: 'server-client' }],
    ['android', { GOOGLE_ANDROID_CLIENT_ID_TEXT: 'android-play-client,server-client' }],
    ['ios', { GOOGLE_CLIENT_ID_TEXT: '' }]
  ])('rejects %s sign-in before verification when configured with %j', (platform, overrides) => {
    expect(() => new GoogleAuth(withEnv(overrides), platform)).toThrow()
    expect(verify).not.toHaveBeenCalled()
  })

  test('accepts a web token whose authorized party is the web client or absent', async () => {
    verify.mockResolvedValue({ payload: payload('server-client', 'server-client') })
    await expect(new GoogleAuth(env, 'web').verifyGoogleToken('token')).resolves.toMatchObject({ aud: 'server-client' })

    verify.mockResolvedValue({ payload: payload('server-client') })
    await expect(new GoogleAuth(env, 'web').verifyGoogleToken('token')).resolves.toMatchObject({ aud: 'server-client' })
  })

  test('still rejects a web token whose authorized party differs from the audience', async () => {
    verify.mockResolvedValue({ payload: payload('server-client', 'ios-app-client') })

    await expect(new GoogleAuth(env, 'web').verifyGoogleToken('token')).rejects.toBeDefined()
  })
})
