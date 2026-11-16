import { describe, expect, test, vi } from 'vitest'
import { UserService } from '@/domain/user'

function fixture() {
  const passkeys = { remove: vi.fn().mockResolvedValue({ deleted: true }) }
  const service = Object.create(UserService.prototype) as UserService
  Object.assign(service, { passkeys })
  const ctx = { env: { FRONT_END_URL: 'https://r.slax.dev' }, getUserId: () => 7 } as never
  return { service, passkeys, ctx }
}

describe('UserService Passkey deletion setting', () => {
  test('passes a numeric credential ID and the authenticated owner to the existing service', async () => {
    const { service, passkeys, ctx } = fixture()
    expect(await service.saveUserSetting(ctx, { key: 'delete_passkey', value: { id: 42 } })).toEqual({ deleted: true })
    expect(passkeys.remove).toHaveBeenCalledWith({ FRONT_END_URL: 'https://r.slax.dev' }, 7, 42)
  })

  test.each([null, {}, { uuid: 'old-uuid' }, { id: '42' }, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: 2147483648 }, { id: Number.MAX_SAFE_INTEGER + 1 }])(
    'rejects an invalid deletion ID at the setting boundary: %j',
    async value => {
      const { service, passkeys, ctx } = fixture()
      await expect(service.saveUserSetting(ctx, { key: 'delete_passkey', value })).rejects.toMatchObject({ name: 'ERROR_PARAM' })
      expect(passkeys.remove).not.toHaveBeenCalled()
    }
  )
})
