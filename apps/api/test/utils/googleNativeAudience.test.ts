import { beforeEach, describe, expect, test, vi } from 'vitest'

const verify = vi.fn()
vi.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: (...args: unknown[]) => verify(...args) }))

import { GoogleAuth } from '@/utils/authLogin/authGoogle'

// Production topology: the Web OAuth client is also the native server client.
const env = {
  GOOGLE_CLIENT_ID_TEXT: 'server-client',
  GOOGLE_IOS_CLIENT_ID_TEXT: 'server-client',
  GOOGLE_ANDROID_CLIENT_ID_TEXT: 'server-client'
} as unknown as Env

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

  test.each(['ios', 'android'])('accepts a %s token for the server client shared with Web', async platform => {
    verify.mockResolvedValue({ payload: payload('server-client', `${platform}-app-client`) })

    await expect(new GoogleAuth(env, platform).verifyGoogleToken('token')).resolves.toMatchObject({ aud: 'server-client' })
    expect(verify).toHaveBeenCalledWith('token', expect.anything(), expect.objectContaining({ audience: 'server-client' }))
  })

  test('accepts a native client distinct from the Web client', async () => {
    verify.mockResolvedValue({ payload: payload('native-client', 'ios-app-client') })
    const separate = { ...env, GOOGLE_CLIENT_ID_TEXT: 'web-client', GOOGLE_IOS_CLIENT_ID_TEXT: 'native-client' } as unknown as Env

    await expect(new GoogleAuth(separate, 'ios').verifyGoogleToken('token')).resolves.toMatchObject({ aud: 'native-client' })
  })

  test.each(['ios', 'android'])('rejects %s sign-in when its client is not configured', platform => {
    const missing = { GOOGLE_CLIENT_ID_TEXT: 'server-client', GOOGLE_IOS_CLIENT_ID_TEXT: '', GOOGLE_ANDROID_CLIENT_ID_TEXT: '' } as unknown as Env

    expect(() => new GoogleAuth(missing, platform)).toThrow()
  })

  test('rejects a native token whose audience is another client', async () => {
    verify.mockResolvedValue({ payload: payload('another-client', 'android-app-client') })

    await expect(new GoogleAuth(env, 'android').verifyGoogleToken('token')).rejects.toBeDefined()
  })

  test('still rejects a web token whose authorized party differs from the audience', async () => {
    verify.mockResolvedValue({ payload: payload('server-client', 'another-client') })

    await expect(new GoogleAuth(env, 'web').verifyGoogleToken('token')).rejects.toBeDefined()
  })
})
