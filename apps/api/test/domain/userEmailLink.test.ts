import { describe, expect, test, vi } from 'vitest'
import { UserService } from '@/domain/user'

const proof = { type: 'email_link', email: 'reader@example.com', request_id: '550e8400-e29b-41d4-a716-446655440000', token: 'a'.repeat(43) }
function fixture() {
  const emailCodes = { verifyLink: vi.fn().mockResolvedValue({ key: proof.email, delivery: 'Reader@example.com' }) }
  const loginIdentities = { signInWithEmail: vi.fn().mockResolvedValue({ user: { id: 7 }, isNew: false }) }
  const completeLogin = vi.fn().mockResolvedValue({ token: 'session', user_id: '7', login_type: 'email' })
  const service = Object.create(UserService.prototype) as UserService
  Object.assign(service, { emailCodes, loginIdentities, completeLogin, trackLogin: (_ctx: unknown, _request: unknown, result: unknown) => result })
  const ctx = { env: { RUN_TYPE: 'dev' } } as never
  const request = () => new Request('https://api.test/v1/user/login', { method: 'POST', body: JSON.stringify(proof) })
  return { service, ctx, request, emailCodes, loginIdentities, completeLogin }
}

describe('email link login orchestration', () => {
  test('reuses verified-email ownership and existing session completion', async () => {
    const { service, ctx, request, emailCodes, loginIdentities, completeLogin } = fixture()
    expect(await service.userLogin(ctx, request())).toMatchObject({ token: 'session', login_type: 'email' })
    expect(emailCodes.verifyLink).toHaveBeenCalledWith({ RUN_TYPE: 'dev' }, proof)
    expect(loginIdentities.signInWithEmail).toHaveBeenCalledWith(proof.email, 'Reader@example.com', expect.objectContaining({ email: 'Reader@example.com' }))
    expect(completeLogin).toHaveBeenCalledWith(ctx, expect.any(Request), { id: 7 }, false, 'email')
  })
  test('a rejected proof cannot enter account lookup or create a session', async () => {
    const { service, ctx, request, emailCodes, loginIdentities, completeLogin } = fixture()
    emailCodes.verifyLink.mockRejectedValue(new Error('expired'))
    await expect(service.userLogin(ctx, request())).rejects.toThrow('expired')
    expect(loginIdentities.signInWithEmail).not.toHaveBeenCalled()
    expect(completeLogin).not.toHaveBeenCalled()
  })
  test('a historical ownership refusal is preserved without another account path', async () => {
    const { service, ctx, request, loginIdentities, completeLogin } = fixture()
    loginIdentities.signInWithEmail.mockRejectedValue(new Error('existing-method-required'))
    await expect(service.userLogin(ctx, request())).rejects.toThrow('existing-method-required')
    expect(completeLogin).not.toHaveBeenCalled()
  })
})
