import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getToken: vi.fn(), verifyGoogleToken: vi.fn() }))

vi.mock('@/utils/authLogin/authGoogle', () => ({
  GoogleAuth: class {
    constructor() {
      Object.assign(this, { getToken: mocks.getToken, verifyGoogleToken: mocks.verifyGoogleToken })
    }
  }
}))

import { SlaxAuth, type SlaxAuthResult } from '@/utils/auth'

const env = { GOOGLE_CLIENT_ID_TEXT: 'web-client', GOOGLE_IOS_CLIENT_ID_TEXT: 'ios-client', GOOGLE_ANDROID_CLIENT_ID_TEXT: 'android-client' } as unknown as Env
const verified = {
  iss: 'https://accounts.google.com',
  sub: 'sub-1',
  aud: 'web-client',
  iat: '1',
  exp: '2',
  email: 'reader@example.test',
  email_verified: 'true',
  azp: 'web-client',
  picture: '',
  locale: 'en'
} satisfies SlaxAuthResult

beforeEach(() => {
  mocks.getToken.mockReset()
  mocks.verifyGoogleToken.mockReset()
})

describe('SlaxAuth.login', () => {
  test('网页授权码登录：用请求里的 redirect_uri 换取 id_token，不要求 state/verifier', async () => {
    mocks.getToken.mockResolvedValueOnce({ id_token: 'exchanged-id-token' })
    mocks.verifyGoogleToken.mockResolvedValueOnce(verified)

    const result = await new SlaxAuth(env).login({ code: 'authorization-code', redirect_uri: 'https://r.slax.test/auth', type: 'google' } as never)

    expect(mocks.getToken).toHaveBeenCalledWith('authorization-code', 'https://r.slax.test/auth')
    expect(mocks.verifyGoogleToken).toHaveBeenCalledWith('exchanged-id-token')
    expect(result.sub).toBe('sub-1')
  })

  test('原生登录：code 本身就是 id_token，不做换取', async () => {
    mocks.verifyGoogleToken.mockResolvedValueOnce(verified)

    await new SlaxAuth(env).login({ code: 'id-token', redirect_uri: 'unused', type: 'google', platform: 'ios' } as never)

    expect(mocks.getToken).not.toHaveBeenCalled()
    expect(mocks.verifyGoogleToken).toHaveBeenCalledWith('id-token')
  })

  test('空 type 按 google 处理（兼容旧客户端）', async () => {
    mocks.getToken.mockResolvedValueOnce({ id_token: 'exchanged-id-token' })
    mocks.verifyGoogleToken.mockResolvedValueOnce(verified)

    await new SlaxAuth(env).login({ code: 'authorization-code', redirect_uri: 'https://r.slax.test/auth', type: '' } as never)

    expect(mocks.getToken).toHaveBeenCalledWith('authorization-code', 'https://r.slax.test/auth')
  })

  test('拒绝不受支持的登录方式', async () => {
    await expect(new SlaxAuth(env).login({ code: 'x', redirect_uri: 'unused', type: 'facebook' } as never)).rejects.toMatchObject({ errCode: 500 })
    expect(mocks.getToken).not.toHaveBeenCalled()
    expect(mocks.verifyGoogleToken).not.toHaveBeenCalled()
  })
})
