import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { EmailCodeService } from '@/domain/emailCode'
import { RedisClient } from '@/infra/repository/redisClient'

const env = {
  RUN_TYPE: 'dev',
  EMAIL_AUTH_HMAC_SECRET: 'a test-only HMAC secret',
  RESEND_API_KEY: 'test-resend-key',
  UPSTASH_REDIS_REST_URL: 'http://redis.test.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'test-redis-token'
} as Env

const input = {
  purpose: 'login' as const,
  emailKey: 'person+test@example.com',
  deliveryEmail: 'Person+Test@example.com',
  clientIp: '192.0.2.1'
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
  const redis = new RedisClient(env)
  return { redis, evalScript: vi.spyOn(redis, 'eval') }
}

describe('email code delivery', () => {
  test('posts a localized code to the exact recipient with the challenge as the idempotency key', async () => {
    const { redis, evalScript } = mockStore()
    evalScript.mockResolvedValue(1)
    const sender = captureMail()
    const service = new EmailCodeService(env, redis, sender)
    const result = await service.sendCode({ ...input, locale: 'zh-CN' })
    const { url, options, body, code } = readMail(sender)
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
    const [, keys, args] = evalScript.mock.calls[0]
    expect(keys.join()).not.toContain(input.emailKey)
    expect(keys.join()).not.toContain(input.clientIp)
    expect(args).not.toContain(code)
  })

  test('fails before touching Redis or Resend when delivery configuration is missing', async () => {
    const { redis, evalScript } = mockStore()
    const sender = captureMail()
    const service = new EmailCodeService({ ...env, RESEND_API_KEY: undefined }, redis, sender)
    await expect(service.sendCode(input)).rejects.toMatchObject({ name: 'EMAIL_AUTH_UNAVAILABLE' })
    expect(evalScript).not.toHaveBeenCalled()
    expect(sender).not.toHaveBeenCalled()
  })

  test('does not propagate a Redis HTTP error containing the command arguments', async () => {
    const { redis, evalScript } = mockStore()
    evalScript.mockRejectedValue(new Error(`Redis HTTP error for ${input.deliveryEmail}`))
    const sender = captureMail()
    const service = new EmailCodeService(env, redis, sender)
    await expect(service.sendCode(input)).rejects.toMatchObject({ name: 'SERVER_ERROR', message: 'Internal server error' })
    expect(sender).not.toHaveBeenCalled()
  })

  test('a definite rejection clears only the challenge generation that Resend received', async () => {
    const { redis, evalScript } = mockStore()
    evalScript.mockResolvedValue(1)
    const sender = captureMail(() => new Response(null, { status: 403 }))
    const service = new EmailCodeService(env, redis, sender)
    await expect(service.sendCode(input)).rejects.toMatchObject({ name: 'EMAIL_AUTH_UNAVAILABLE' })
    expect(evalScript).toHaveBeenCalledTimes(2)
    expect(evalScript.mock.calls[1][1]).toEqual([evalScript.mock.calls[0][1][0]])
    expect(evalScript.mock.calls[1][2]).toEqual([new Headers(readMail(sender).options?.headers).get('Idempotency-Key')])
  })

  test.each([408, 409, 503, 'timeout'])('an ambiguous delivery (%s) returns its challenge without deleting it', async status => {
    const { redis, evalScript } = mockStore()
    evalScript.mockResolvedValue(1)
    const sender = captureMail(() => {
      if (typeof status === 'string') throw new DOMException('Timed out', 'TimeoutError')
      return new Response(null, { status })
    })
    const service = new EmailCodeService(env, redis, sender)
    const challenge = await service.sendCode(input)
    expect(evalScript).toHaveBeenCalledOnce()
    expect(challenge.request_id).toBe(new Headers(readMail(sender).options?.headers).get('Idempotency-Key'))
  })
})

// Opt in with EMAIL_OTP_REDIS_TEST=1 and redis-server and redis-cli on PATH.
describe.skipIf(process.env.EMAIL_OTP_REDIS_TEST !== '1')('email code scripts in Redis', () => {
  const exec = promisify(execFile)
  let directory: string
  let socket: string
  let server: ChildProcess
  const redis = async (...command: string[]) => {
    const { stdout } = await exec('redis-cli', ['-s', socket, '--json', ...command])
    return JSON.parse(stdout)
  }

  function encode(result: unknown): unknown {
    if (Array.isArray(result)) return result.map(encode)
    return typeof result === 'string' ? Buffer.from(result).toString('base64') : result
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'slax-otp-'))
    socket = join(directory, 'redis.sock')
    server = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--dir', directory, '--save', '', '--appendonly', 'no'], { stdio: 'ignore' })
    await once(server, 'spawn')
    await vi.waitFor(async () => expect(await redis('PING')).toBe('PONG'), { timeout: 3000 })
  })

  afterAll(async () => {
    if (server?.kill()) await once(server, 'exit')
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await redis('FLUSHDB')
    // Translate the Upstash SDK's HTTP commands to the disposable Redis instance.
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (url, options) => {
        const command = JSON.parse(String(options?.body))
        if (String(url).endsWith('/pipeline')) {
          const results = await Promise.all(command.map(async (args: string[]) => ({ result: encode(await redis(...args.map(String))) })))
          return Response.json(results)
        }
        return Response.json({ result: encode(await redis(...command.map(String))) })
      })
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  function setup(send = captureMail(), runType = env.RUN_TYPE) {
    const config = { ...env, RUN_TYPE: runType }
    return new EmailCodeService(config, new RedisClient(config), send)
  }

  async function redisKey(pattern: string) {
    const [key] = await redis('KEYS', pattern)
    expect(key).toBeTypeOf('string')
    return key as string
  }

  test('only one concurrent submission redeems a code and returns the exact address', async () => {
    const sender = captureMail()
    const service = setup(sender)
    const { request_id: requestId } = await service.sendCode(input)
    const { code } = readMail(sender)
    const submissions = await Promise.allSettled(Array.from({ length: 4 }, () => service.verifyCode({ ...input, requestId, code })))
    expect(submissions.filter(item => item.status === 'fulfilled')).toEqual([{ status: 'fulfilled', value: input.deliveryEmail }])
    expect(submissions.filter(item => item.status === 'rejected')).toHaveLength(3)
  })

  test('wrong submissions preserve TTL and the fifth exhausts the challenge', async () => {
    const sender = captureMail()
    const service = setup(sender)
    const { request_id: requestId } = await service.sendCode(input)
    const { code } = readMail(sender)
    const wrong = code === '999999' ? '000000' : '999999'
    const key = await redisKey('*:challenge:*')
    expect(await redis('TTL', key)).toBeGreaterThan(295)
    await redis('EXPIRE', key, '180')
    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(service.verifyCode({ ...input, requestId, code: wrong })).rejects.toMatchObject({ name: 'EMAIL_VERIFY_CODE_ERROR' })
    }
    await expect(service.verifyCode({ ...input, requestId, code: wrong })).rejects.toMatchObject({ name: 'EMAIL_VERIFY_CODE_RATE_LIMIT' })
    expect(await redis('TTL', key)).toBeLessThanOrEqual(180)
    await expect(service.verifyCode({ ...input, requestId, code })).rejects.toMatchObject({ name: 'EMAIL_VERIFY_CODE_RATE_LIMIT' })
  })

  test('blocks resends during cooldown, invalidates replaced generations and rejects expired challenges', async () => {
    const sender = captureMail()
    const service = setup(sender)
    const first = await service.sendCode(input)
    const original = readMail(sender).code
    await expect(service.sendCode(input)).rejects.toMatchObject({ name: 'TOO_MANY_REQUESTS' })
    const cooldown = await redisKey('*:cooldown:*')
    expect(await redis('TTL', cooldown)).toBeGreaterThan(55)
    await redis('DEL', cooldown)
    const second = await service.sendCode(input)
    await expect(service.verifyCode({ ...input, requestId: first.request_id, code: original })).rejects.toMatchObject({ name: 'EMAIL_VERIFY_CODE_ERROR' })
    await redis('PEXPIREAT', await redisKey('*:challenge:*'), '1')
    await expect(service.verifyCode({ ...input, requestId: second.request_id, code: readMail(sender).code })).rejects.toMatchObject({ name: 'EMAIL_VERIFY_CODE_ERROR' })
  })

  test('isolates purpose, environment and binding owner', async () => {
    const sender = captureMail()
    const service = setup(sender)
    const login = await service.sendCode(input)
    const loginCode = readMail(sender).code
    const bind = { ...input, purpose: 'bind' as const, userId: 42 }
    const { request_id: requestId } = await service.sendCode(bind)
    const { code } = readMail(sender)
    await expect(service.verifyCode({ ...input, requestId, code })).rejects.toMatchObject({ name: 'EMAIL_VERIFY_CODE_ERROR' })
    await expect(setup(sender, 'prod').verifyCode({ ...bind, requestId, code })).rejects.toMatchObject({ name: 'EMAIL_VERIFY_CODE_ERROR' })
    await expect(service.verifyCode({ ...bind, userId: 12, requestId, code })).rejects.toMatchObject({ name: 'EMAIL_VERIFY_CODE_ERROR' })
    await expect(service.verifyCode({ ...bind, requestId, code })).resolves.toBe(input.deliveryEmail)
    await expect(service.verifyCode({ ...input, requestId: login.request_id, code: loginCode })).resolves.toBe(input.deliveryEmail)
  })

  test.each([
    ['address', 5],
    ['ip', 30],
    ['environment', 500]
  ])('denies sends at the %s quota', async (scope, limit) => {
    const sender = captureMail()
    const service = setup(sender)
    await service.sendCode(input)
    await redis('DEL', await redisKey('*:cooldown:*'))
    await redis('SET', await redisKey(`*:quota:${scope}*`), String(limit), 'EX', '3600')
    await expect(service.sendCode(input)).rejects.toMatchObject({ name: 'TOO_MANY_REQUESTS' })
    expect(sender).toHaveBeenCalledTimes(1)
  })

  test('explicit rejection removes its challenge', async () => {
    const service = setup(captureMail(() => new Response('rejected', { status: 403 })))
    await expect(service.sendCode(input)).rejects.toMatchObject({ name: 'EMAIL_AUTH_UNAVAILABLE' })
    expect(await redis('KEYS', '*:challenge:*')).toEqual([])
  })

  test('a delayed rejection does not remove a newer generation', async () => {
    let completeDelivery!: (response: Response) => void
    const deferred = new Promise<Response>(resolve => {
      completeDelivery = resolve
    })
    const rejectLater = vi.fn<typeof fetch>(() => deferred)
    const original = setup(rejectLater).sendCode(input)
    const rejection = expect(original).rejects.toMatchObject({ name: 'EMAIL_AUTH_UNAVAILABLE' })
    await vi.waitFor(() => expect(rejectLater).toHaveBeenCalledOnce())
    await redis('DEL', await redisKey('*:cooldown:*'))
    const sender = captureMail()
    const service = setup(sender)
    const { request_id: requestId } = await service.sendCode(input)
    completeDelivery(new Response(null, { status: 403 }))
    await rejection
    await expect(service.verifyCode({ ...input, requestId, code: readMail(sender).code })).resolves.toBe(input.deliveryEmail)
  })

  test('an ambiguous timeout leaves the code redeemable', async () => {
    const sender = captureMail(() => {
      throw new DOMException('Timed out', 'TimeoutError')
    })
    const service = setup(sender)
    const { request_id: requestId } = await service.sendCode(input)
    await expect(service.verifyCode({ ...input, requestId, code: readMail(sender).code })).resolves.toBe(input.deliveryEmail)
  })
})
