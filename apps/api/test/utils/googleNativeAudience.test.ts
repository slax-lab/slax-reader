import { beforeEach, describe, expect, test, vi } from 'vitest'

const verify = vi.fn()
vi.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: (...args: unknown[]) => verify(...args) }))

import { GoogleAuth } from '@/utils/authLogin/authGoogle'

const env = {
  GOOGLE_CLIENT_ID_TEXT: 'web-client',
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

  test('accepts a native token whose audience is the server client and whose authorized party is the app client', async () => {
    verify.mockResolvedValue({ payload: payload('server-client', 'android-app-client') })

    await expect(new GoogleAuth(env, 'android').verifyGoogleToken('token')).resolves.toMatchObject({ aud: 'server-client' })

    verify.mockResolvedValue({ payload: payload('server-client', 'ios-app-client') })

    await expect(new GoogleAuth(env, 'ios').verifyGoogleToken('token')).resolves.toMatchObject({ aud: 'server-client' })
  })

  test('rejects a native token whose audience is another client', async () => {
    verify.mockResolvedValue({ payload: payload('another-client', 'android-app-client') })

    await expect(new GoogleAuth(env, 'android').verifyGoogleToken('token')).rejects.toBeDefined()
  })

  test('still rejects a web token whose authorized party differs from the audience', async () => {
    verify.mockResolvedValue({ payload: payload('web-client', 'another-client') })

    await expect(new GoogleAuth(env, 'web').verifyGoogleToken('token')).rejects.toBeDefined()
  })
})
