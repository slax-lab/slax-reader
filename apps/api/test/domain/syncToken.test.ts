import { afterEach, expect, test, vi } from 'vitest'
import { exportJWK, generateKeyPair, jwtVerify } from 'jose'
import { SyncOrchestrator } from '@/domain/orchestrator/sync'
import { createMockCtx } from '@test/helpers/mockFactory'

afterEach(() => vi.restoreAllMocks())

test('issues a signed PowerSync credential valid for 24 hours minus one second across a clock tick', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const ctx = createMockCtx()
  ctx.env.POWERSYNC_JWK_PRIVATE_KEY = JSON.stringify({ ...(await exportJWK(privateKey)), kid: 'sync-test-key' })
  ctx.env.POWERSYNC_SG_API_URL = 'https://sync.example.test'
  const orchestrator = Object.create(SyncOrchestrator.prototype) as SyncOrchestrator
  Object.assign(orchestrator, { userService: { getUserInfo: vi.fn().mockResolvedValue({ uuid: 'user-uuid' }) } })

  const now = Date.UTC(2026, 9, 16, 0, 0, 0)
  vi.spyOn(Date, 'now').mockReturnValueOnce(now).mockReturnValue(now + 1000)
  const { token, endpoint } = await orchestrator.signToken(ctx)
  const issuedAt = now / 1000
  const expiresAt = issuedAt + 86399
  const options = { audience: 'reader-sync', algorithms: ['RS256'], currentDate: new Date(now) }
  const verified = await jwtVerify(token, publicKey, options)

  expect(endpoint).toBe('https://sync.example.test')
  expect(verified.protectedHeader).toMatchObject({ alg: 'RS256', kid: 'sync-test-key' })
  expect(verified.payload).toMatchObject({ sub: 'user-uuid', aud: 'reader-sync', iat: issuedAt, exp: expiresAt })
  expect(verified.payload.exp! - verified.payload.iat!).toBe(86399)

  await expect(jwtVerify(token, publicKey, { ...options, currentDate: new Date((expiresAt - 1) * 1000) })).resolves.toBeDefined()
  await expect(jwtVerify(token, publicKey, { ...options, currentDate: new Date(expiresAt * 1000) })).rejects.toMatchObject({ code: 'ERR_JWT_EXPIRED' })
})
