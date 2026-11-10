import { describe, expect, test, vi } from 'vitest'
import { EmailCodeService } from '@/domain/emailCode'
import type { RedisEmailChallenge } from '@/infra/repository/redisEmailChallenge'

const env = {
  RUN_TYPE: 'dev',
  RESEND_API_KEY: 'test-resend-key'
} as Env

const input = {
  purpose: 'login' as const,
  emailKey: 'person+test@example.com',
  deliveryEmail: 'Person+Test@example.com',
  clientIp: '192.0.2.1',
  deviceId: 'device-fixture'
}

function captureMail(deliver = () => new Response(null, { status: 200 })) {
  return vi.fn<typeof fetch>(async (_url, _options) => deliver())
}

function readMail(sender: ReturnType<typeof captureMail>) {
  const [url, options] = sender.mock.lastCall!
  const body = JSON.parse(String(options?.body))
  return { url, options, body, code: String(body.text).match(/\b\d{6}\b/)![0] }
}

function mockStore() {
  const count = vi.fn<RedisEmailChallenge['countEmailSend']>().mockResolvedValue(1)
  const save = vi.fn<RedisEmailChallenge['saveEmail']>().mockResolvedValue(undefined)
  const remove = vi.fn<RedisEmailChallenge['removeEmail']>().mockResolvedValue(true)
  const store = { countEmailSend: count, takeEmailCooldown: vi.fn().mockResolvedValue(true), saveEmail: save, removeEmail: remove }
  return { store: store as unknown as RedisEmailChallenge, count, save, remove }
}

describe('email code delivery', () => {
  test('posts a localized code to the exact recipient with the challenge as the idempotency key', async () => {
    const { store, count, save, remove } = mockStore()
    const sender = captureMail()
    const service = new EmailCodeService(store)
    const result = await service.sendCode(env, { ...input, locale: 'zh-CN' }, sender)
    const { url, options, body } = readMail(sender)
    expect(result).toMatchObject({ expires_in: 300, resend_after: 60 })
    expect(url).toBe('https://api.resend.com/emails')
    expect(options?.method).toBe('POST')
    expect(new Headers(options?.headers).get('Idempotency-Key')).toBe(result.request_id)
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-resend-key')
    expect(body).toMatchObject({
      from: 'Slax Reader <noreply@reader.slax.com>',
      to: [input.deliveryEmail],
      subject: '你的 Slax Reader 验证码'
    })
    expect(JSON.stringify(count.mock.calls)).not.toContain(input.emailKey)
    expect(JSON.stringify(count.mock.calls)).not.toContain(input.clientIp)
    expect(JSON.stringify(count.mock.calls)).not.toContain(input.deviceId)
    expect(save.mock.calls[0][1]).toMatchObject({ requestId: result.request_id, digest: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(save.mock.calls[0][1]).not.toHaveProperty('code')
    expect(remove).not.toHaveBeenCalled()
  })

  test('fails before touching Redis or Resend when delivery configuration is missing', async () => {
    const { store, count } = mockStore()
    const sender = captureMail()
    const service = new EmailCodeService(store)
    await expect(service.sendCode({ ...env, RESEND_API_KEY: undefined }, input, sender)).rejects.toMatchObject({ name: 'EMAIL_AUTH_UNAVAILABLE' })
    expect(count).not.toHaveBeenCalled()
    expect(sender).not.toHaveBeenCalled()
  })

  test('a definite rejection clears only the challenge generation that Resend received', async () => {
    const { store, save, remove } = mockStore()
    const sender = captureMail(() => new Response(null, { status: 403 }))
    const service = new EmailCodeService(store)
    await expect(service.sendCode(env, input, sender)).rejects.toMatchObject({ name: 'EMAIL_AUTH_UNAVAILABLE' })
    expect(remove).toHaveBeenCalledExactlyOnceWith(...save.mock.calls[0].slice(0, 2))
    expect(remove.mock.calls[0][1].requestId).toBe(new Headers(readMail(sender).options?.headers).get('Idempotency-Key'))
  })

  test.each([408, 409, 503, 'timeout'])('an ambiguous delivery (%s) returns its challenge without deleting it', async status => {
    const { store, save, remove } = mockStore()
    const sender = captureMail(() => {
      if (typeof status === 'string') throw new DOMException('Timed out', 'TimeoutError')
      return new Response(null, { status })
    })
    const service = new EmailCodeService(store)
    const challenge = await service.sendCode(env, input, sender)
    expect(save).toHaveBeenCalledOnce()
    expect(remove).not.toHaveBeenCalled()
    expect(challenge.request_id).toBe(new Headers(readMail(sender).options?.headers).get('Idempotency-Key'))
  })
})
