import { describe, expect, test, vi } from 'vitest'
import { EmailCodeService } from '@/domain/emailCode'
import type { EmailChallengeRepo } from '@/infra/repository/redisEmailChallenge'

const env = {
  RUN_TYPE: 'dev',
  RESEND_API_KEY: 'test-resend-key',
  FRONT_END_URL: 'https://r.slax.dev'
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
  const count = vi.fn<EmailChallengeRepo['countEmailSend']>().mockResolvedValue(1)
  const save = vi.fn<EmailChallengeRepo['saveEmail']>().mockResolvedValue(undefined)
  const remove = vi.fn<EmailChallengeRepo['removeEmail']>().mockResolvedValue(true)
  const store = { countEmailSend: count, takeEmailCooldown: vi.fn().mockResolvedValue(true), saveEmail: save, removeEmail: remove }
  return { store: store as unknown as EmailChallengeRepo, count, save, remove }
}

describe('email code delivery', () => {
  test.each([
    ['zh-CN', '你的 Slax Reader 验证码'],
    ['zh_HK', '你的 Slax Reader 验证码'],
    ['en', 'Your Slax Reader verification code'],
    ['ja', 'Your Slax Reader verification code']
  ])('posts a localized code for %s with the challenge as the idempotency key', async (locale, subject) => {
    const { store, count, save, remove } = mockStore()
    const sender = captureMail()
    const service = new EmailCodeService(store)
    const result = await service.sendCode(env, { ...input, locale }, sender)
    const { url, options, body, code } = readMail(sender)
    expect(result).toMatchObject({ expires_in: 300, resend_after: 60 })
    expect(url).toBe('https://api.resend.com/emails')
    expect(options?.method).toBe('POST')
    expect(new Headers(options?.headers).get('Idempotency-Key')).toBe(result.request_id)
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-resend-key')
    expect(body).toMatchObject({
      from: 'Slax Reader <noreply@reader.slax.com>',
      to: [input.deliveryEmail],
      subject,
      text: expect.stringContaining(
        locale.startsWith('zh')
          ? `你的 Slax Reader 验证码是 ${code}。验证码在 5 分钟内有效。如果你没有发起此请求，可以忽略这封邮件。`
          : `Your Slax Reader verification code is ${code}. It expires in 5 minutes. If you did not request a code, you can ignore this email.`
      )
    })
    expect(JSON.stringify(count.mock.calls)).not.toContain(input.emailKey)
    expect(JSON.stringify(count.mock.calls)).not.toContain(input.clientIp)
    expect(JSON.stringify(count.mock.calls)).not.toContain(input.deviceId)
    expect(save.mock.calls[0][1]).toMatchObject({ requestId: result.request_id, digest: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(save.mock.calls[0][1]).not.toHaveProperty('code')
    expect(remove).not.toHaveBeenCalled()
  })

  test('delivers a login link only in the email and stores only its digest', async () => {
    const { store, save } = mockStore()
    const sender = captureMail()
    const result = await new EmailCodeService(store).sendCode(env, input, sender)
    const link = new URL(readMail(sender).body.text.match(/https:\/\/\S+/)![0])
    expect(link.origin + link.pathname).toBe('https://r.slax.dev/email-login')
    expect(link.search).toBe('')
    const proof = new URLSearchParams(link.hash.slice(1))
    expect(proof.get('email')).toBe(input.emailKey)
    expect(proof.get('request_id')).toBe(result.request_id)
    expect(proof.get('token')).toMatch(/^[a-zA-Z0-9_-]{43}$/)
    expect(save.mock.calls[0][1]).toHaveProperty('linkDigest', expect.stringMatching(/^[a-f0-9]{64}$/))
    expect(JSON.stringify(save.mock.calls)).not.toContain(proof.get('token'))
    expect(Object.keys(result).sort()).toEqual(['expires_in', 'request_id', 'resend_after'])
  })

  test('mailbox binding remains code-only and does not need a Web URL', async () => {
    const { store, save } = mockStore()
    const sender = captureMail()
    await new EmailCodeService(store).sendCode({ ...env, FRONT_END_URL: undefined } as unknown as Env, { ...input, purpose: 'bind', userId: 7 }, sender)
    expect(readMail(sender).body.text).not.toContain('/email-login')
    expect(save.mock.calls[0][1]).not.toHaveProperty('linkDigest')
  })

  test.each(['login', 'bind'] as const)('permits shared-IP %s sends through 50 and rejects request 51', async purpose => {
    const { store, count } = mockStore()
    const sender = captureMail()
    const service = new EmailCodeService(store)
    const context = { ...input, purpose, ...(purpose === 'bind' ? { userId: 42 } : {}) }
    for (const ipCount of [31, 50]) {
      count.mockImplementation(async (_environment, dimension) => (dimension === 'ip' ? ipCount : 1))
      await expect(service.sendCode(env, context, sender)).resolves.toMatchObject({ expires_in: 300, resend_after: 60 })
    }
    count.mockImplementation(async (_environment, dimension) => (dimension === 'ip' ? 51 : 1))
    await expect(service.sendCode(env, context, sender)).rejects.toMatchObject({ name: 'TOO_MANY_REQUESTS' })
    expect(sender).toHaveBeenCalledTimes(2)
    expect(count).toHaveBeenCalledWith('dev', 'ip', expect.any(String), 3600)
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
