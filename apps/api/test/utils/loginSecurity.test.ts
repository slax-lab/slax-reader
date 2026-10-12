import { afterEach, describe, expect, test, vi } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'

const keys = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock('jose', async importOriginal => ({
  ...(await importOriginal<typeof import('jose')>()),
  createRemoteJWKSet: () => keys.resolve
}))

import { AppleAuth } from '@/utils/authLogin/authApple'
import { GoogleAuth } from '@/utils/authLogin/authGoogle'
import { Auth } from '@/utils/jwt'

afterEach(() => vi.restoreAllMocks())

const env = { JWT_SECRET_TEXT: 'test-secret-32-bytes-minimum-long-string', JWT_ALGORITHMS: 'HS256', JWT_ISSUER: 'test', JWT_EXPIRES: '3600' } as unknown as Env

describe('product identity isolation', () => {
  test('Reader tokens have a mandatory fixed audience and reject other audiences', async () => {
    const reader = new Auth(env)
    const payload = { id: '123', email: 'user@example.com', lang: 'en' }
    const readerToken = await reader.sign({ ...payload, aud: 'untrusted' })
    await expect(reader.verify(readerToken)).resolves.toMatchObject({ ...payload, aud: 'reader' })
    const wrongAudience = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('test')
      .setAudience('other-product')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(env.JWT_SECRET_TEXT))
    await expect(reader.verify(wrongAudience)).rejects.toThrow()
  })

  test('legacy tokens without an audience require a new login', async () => {
    const token = await new SignJWT({ id: '123' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('test')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(env.JWT_SECRET_TEXT))
    await expect(new Auth(env).verify(token)).rejects.toThrow()
  })
})

describe('Apple verified identity', () => {
  const build = async () => {
    const pair = await generateKeyPair('RS256')
    keys.resolve.mockImplementation(createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'test' }] }))
    const sign = (email: string, audience = 'reader.client') =>
      new SignJWT({ email, email_verified: true })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setSubject('attacker')
        .setIssuer('https://appleid.apple.com')
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(pair.privateKey)
    const service = new AppleAuth({ APPLE_WEB_CLIENT_ID: 'reader.client', APPLE_SIGN_AUTH_KEY: '' } as unknown as Env)
    vi.spyOn(service as any, 'getClientSecret').mockResolvedValue('test-client-secret')
    vi.spyOn(service as any, 'getAuthorizationToken').mockResolvedValue({ id_token: await sign('attacker@example.com') })
    return { service, sign }
  }

  test('rejects forged client claims even when sub matches the exchanged token', async () => {
    const { service, sign } = await build()
    const parts = (await sign('attacker@example.com')).split('.')
    parts[1] = Buffer.from(JSON.stringify({ sub: 'attacker', email: 'victim@example.com' })).toString('base64url')
    await expect(service.loginWithApple('code', parts.join('.'), 'reader.client')).rejects.toBeDefined()
  })

  test('returns the exchanged identity, never client-supplied email', async () => {
    const { service, sign } = await build()
    await expect(service.loginWithApple('code', await sign('different@example.com'), 'reader.client')).resolves.toMatchObject({ email: 'attacker@example.com' })
  })

  test('rejects an unconfigured OAuth client before exchanging code', async () => {
    const { service } = await build()
    await expect(service.loginWithApple('code', '', 'another.client')).rejects.toBeDefined()
    expect((service as any).getAuthorizationToken).not.toHaveBeenCalled()
  })

  test('rejects a valid signature with the wrong audience', async () => {
    const { service, sign } = await build()
    await expect(service.loginWithApple('code', await sign('user@example.com', 'another.client'), 'reader.client')).rejects.toBeDefined()
  })
})

describe('Google verified email', () => {
  test.each([false, 'false', undefined])('rejects unverified email %s', async email_verified => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ aud: 'client', email: 'victim@example.com', email_verified, sub: 'sub', iss: 'https://accounts.google.com', exp: Date.now() / 1000 + 3600 })
    )
    const service = new GoogleAuth({ GOOGLE_CLIENT_ID_TEXT: 'client' } as unknown as Env, 'web')
    await expect(service.verifyGoogleToken('token')).rejects.toBeDefined()
  })
})
