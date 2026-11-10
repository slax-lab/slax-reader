import type { EmailCodeChallenge } from '@slax-reader/contracts/email-auth'
import { EmailAuthUnavailableError, EmailVerifyCodeError, EmailVerifyCodeRateLimitError, ErrorParam, ServerError, TooManyRequestsError } from '../const/err'
import type { RedisClient } from '../infra/repository/redisClient'

const CHALLENGE_TTL = 300
const RESEND_COOLDOWN = 60
const MAX_ATTEMPTS = 5
const ADDRESS_SEND_LIMIT = 5
const IP_SEND_LIMIT = 30
const ENVIRONMENT_SEND_LIMIT = 500
const HOUR = 60 * 60
const DAY = 24 * HOUR
const RESEND_TIMEOUT_MS = 5000
const DEFAULT_FROM = 'Slax Reader <noreply@reader.slax.com>'

const ISSUE_CODE = `
local challenge, cooldown, addressQuota, ipQuota, environmentQuota = unpack(KEYS)
local id, email, digest, owner, ttl, cooldownTtl, addressLimit, ipLimit, environmentLimit, hour, day = unpack(ARGV)

local function count(key)
  return tonumber(redis.call('GET', key) or '0')
end

local function charge(key, window)
  if redis.call('INCR', key) == 1 then redis.call('EXPIRE', key, window) end
end

if redis.call('EXISTS', cooldown) == 1 or
   count(addressQuota) >= tonumber(addressLimit) or
   count(ipQuota) >= tonumber(ipLimit) or
   count(environmentQuota) >= tonumber(environmentLimit) then
  return 0
end

charge(addressQuota, hour)
charge(ipQuota, hour)
charge(environmentQuota, day)
redis.call('SET', cooldown, '1', 'EX', cooldownTtl)
redis.call('HSET', challenge, 'request_id', id, 'recipient', email, 'digest', digest, 'owner', owner, 'attempts', '0')
redis.call('EXPIRE', challenge, ttl)
return 1
`

const VERIFY_CODE = `
local id, owner, digest, limit = unpack(ARGV)
local challenge = KEYS[1]
local stored = redis.call('HMGET', challenge, 'request_id', 'owner', 'digest', 'attempts', 'recipient')
if stored[1] ~= id or stored[2] ~= owner then return {'invalid'} end
if tonumber(stored[4]) >= tonumber(limit) then return {'exhausted'} end

local difference = 0
for i = 1, #digest do
  difference = bit.bor(difference, bit.bxor(stored[3]:byte(i), digest:byte(i)))
end
if difference ~= 0 then
  if redis.call('HINCRBY', challenge, 'attempts', 1) >= tonumber(limit) then return {'exhausted'} end
  return {'invalid'}
end

redis.call('DEL', challenge)
return {'verified', stored[5]}
`

const REMOVE_REJECTED_CODE = `
if redis.call('HGET', KEYS[1], 'request_id') == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

type Scope = { purpose: 'login' | 'bind'; emailKey: string; userId?: number }
type SendInput = Scope & { deliveryEmail: string; clientIp: string; locale?: string }
type VerifyInput = Scope & { requestId: string; code: string }
type VerifyResult = ['invalid' | 'exhausted'] | ['verified', string]

const encoder = new TextEncoder()

function newCode(): string {
  const range = 1_000_000
  const limit = Math.floor(2 ** 32 / range) * range
  const random = new Uint32Array(1)
  do {
    crypto.getRandomValues(random)
  } while (random[0] >= limit)
  return String(random[0] % range).padStart(6, '0')
}

async function digest(key: CryptoKey, ...parts: string[]): Promise<string> {
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(parts)))
  return Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, '0')).join('')
}

function emailContent(code: string, locale?: string) {
  if (locale?.toLowerCase().split(/[-_]/)[0] === 'zh') {
    return {
      subject: '你的 Slax Reader 验证码',
      text: `你的 Slax Reader 验证码是 ${code}。验证码在 5 分钟内有效。如果你没有发起此请求，可以忽略这封邮件。`
    }
  }
  return {
    subject: 'Your Slax Reader verification code',
    text: `Your Slax Reader verification code is ${code}. It expires in 5 minutes. If you did not request a code, you can ignore this email.`
  }
}

export class EmailCodeService {
  // Keep all keys in one Redis hash slot so admission can update them atomically.
  private readonly namespace: string

  constructor(
    private readonly env: Env,
    private readonly redis: RedisClient,
    private readonly send: typeof fetch = (...args) => fetch(...args)
  ) {
    this.namespace = `{email-otp:${env.RUN_TYPE}}`
  }

  async sendCode(input: SendInput): Promise<EmailCodeChallenge> {
    if (input.purpose === 'bind' && input.userId === undefined) throw ErrorParam()
    const apiKey = this.env.RESEND_API_KEY?.trim()
    if (!apiKey) throw EmailAuthUnavailableError()
    const key = await this.hmacKey()
    const code = newCode()
    const requestId = crypto.randomUUID()
    const owner = String(input.userId ?? '')
    const [addressHash, ipHash, codeDigest] = await Promise.all([
      digest(key, 'address', input.emailKey),
      digest(key, 'ip', input.clientIp),
      digest(key, 'code', input.purpose, input.emailKey, requestId, code)
    ])
    const challenge = `${this.namespace}:challenge:${input.purpose}:${addressHash}`
    const admitted = await this.runScript<number>(
      ISSUE_CODE,
      [
        challenge,
        `${this.namespace}:cooldown:${input.purpose}:${addressHash}`,
        `${this.namespace}:quota:address:${addressHash}`,
        `${this.namespace}:quota:ip:${ipHash}`,
        `${this.namespace}:quota:environment`
      ],
      [
        requestId,
        input.deliveryEmail,
        codeDigest,
        owner,
        String(CHALLENGE_TTL),
        String(RESEND_COOLDOWN),
        String(ADDRESS_SEND_LIMIT),
        String(IP_SEND_LIMIT),
        String(ENVIRONMENT_SEND_LIMIT),
        String(HOUR),
        String(DAY)
      ]
    )
    if (!admitted) throw TooManyRequestsError()

    if (await this.deliveryRejected(apiKey, requestId, input, code)) {
      await this.runScript(REMOVE_REJECTED_CODE, [challenge], [requestId])
      throw EmailAuthUnavailableError()
    }

    return { request_id: requestId, expires_in: CHALLENGE_TTL, resend_after: RESEND_COOLDOWN }
  }

  async verifyCode(input: VerifyInput): Promise<string> {
    if (input.purpose === 'bind' && input.userId === undefined) throw EmailVerifyCodeError()
    const key = await this.hmacKey()
    const [addressHash, codeDigest] = await Promise.all([digest(key, 'address', input.emailKey), digest(key, 'code', input.purpose, input.emailKey, input.requestId, input.code)])
    const result = await this.runScript<VerifyResult>(
      VERIFY_CODE,
      [`${this.namespace}:challenge:${input.purpose}:${addressHash}`],
      [input.requestId, String(input.userId ?? ''), codeDigest, String(MAX_ATTEMPTS)]
    )
    if (result[0] === 'verified') return result[1]
    if (result[0] === 'exhausted') throw EmailVerifyCodeRateLimitError()
    throw EmailVerifyCodeError()
  }

  private hmacKey(): Promise<CryptoKey> {
    const secret = this.env.EMAIL_AUTH_HMAC_SECRET
    if (!secret?.trim()) throw EmailAuthUnavailableError()
    return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  }

  private async runScript<T>(script: string, keys: string[], args: string[]): Promise<T> {
    try {
      return await this.redis.eval<T>(script, keys, args)
    } catch {
      // An Upstash transport error can include the script arguments, including the recipient.
      throw ServerError()
    }
  }

  private async deliveryRejected(apiKey: string, requestId: string, input: SendInput, code: string): Promise<boolean> {
    const request: RequestInit = {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': requestId
      },
      body: JSON.stringify({
        from: this.env.EMAIL_AUTH_FROM?.trim() || DEFAULT_FROM,
        to: [input.deliveryEmail],
        ...emailContent(code, input.locale)
      })
    }
    try {
      const response = await this.send('https://api.resend.com/emails', request)
      // A timeout, idempotency conflict, or upstream error can follow acceptance.
      return !response.ok && response.status < 500 && response.status !== 408 && response.status !== 409
    } catch {
      return false
    }
  }
}
