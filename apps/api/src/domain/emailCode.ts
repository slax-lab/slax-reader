import { timingSafeEqual } from 'node:crypto'
import type { EmailCodeChallenge } from '@slax-reader/contracts/email-auth'
import { EmailAuthUnavailableError, EmailVerifyCodeError, EmailVerifyCodeRateLimitError, ErrorParam, TooManyRequestsError } from '../const/err'
import { resendDeliveryRejected } from '../infra/external/resend'
import type { AuthChallengeRepo, EmailChallenge, EmailChallengeKey } from '../infra/repository/authChallengeRepo'

const CHALLENGE_TTL = 300
const RESEND_COOLDOWN = 60
const MAX_ATTEMPTS = 5
const ADDRESS_SEND_LIMIT = 5
const IP_SEND_LIMIT = 30
const DEVICE_SEND_LIMIT = 10
const ENVIRONMENT_SEND_LIMIT = 500
const HOUR = 60 * 60
const DAY = 24 * HOUR
const DEFAULT_FROM = 'Slax Reader <noreply@reader.slax.com>'

type Scope = { purpose: 'login' | 'bind'; emailKey: string; userId?: number }
type SendInput = Scope & { deliveryEmail: string; clientIp: string; deviceId: string; locale?: string }
type VerifyInput = Scope & { requestId: string; code: string }

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
  constructor(
    private readonly env: Env,
    private readonly challenges: AuthChallengeRepo,
    private readonly send?: typeof fetch
  ) {}

  async sendCode(input: SendInput): Promise<EmailCodeChallenge> {
    if (input.purpose === 'bind' && input.userId === undefined) throw ErrorParam()
    const apiKey = this.env.RESEND_API_KEY?.trim()
    if (!apiKey) throw EmailAuthUnavailableError()
    const key = await this.hmacKey()
    const code = newCode()
    const requestId = crypto.randomUUID()
    const [addressHash, ipHash, deviceHash, codeDigest] = await Promise.all([
      digest(key, 'address', input.emailKey),
      digest(key, 'ip', input.clientIp),
      digest(key, 'device', input.deviceId),
      digest(key, 'code', input.purpose, input.emailKey, requestId, code)
    ])
    const environment = this.env.RUN_TYPE
    const scope: EmailChallengeKey = { environment, purpose: input.purpose, addressHash }

    const [ipCount, deviceCount] = await Promise.all([
      this.challenges.countEmailSend(environment, 'ip', ipHash, HOUR),
      this.challenges.countEmailSend(environment, 'device', deviceHash, HOUR)
    ])
    if (ipCount > IP_SEND_LIMIT || deviceCount > DEVICE_SEND_LIMIT) throw TooManyRequestsError()
    if (!(await this.challenges.takeEmailCooldown(scope, RESEND_COOLDOWN))) throw TooManyRequestsError()
    if ((await this.challenges.countEmailSend(environment, 'address', addressHash, HOUR)) > ADDRESS_SEND_LIMIT) throw TooManyRequestsError()
    if ((await this.challenges.countEmailSend(environment, 'environment', 'all', DAY)) > ENVIRONMENT_SEND_LIMIT) throw TooManyRequestsError()

    const challenge: EmailChallenge = { requestId, recipient: input.deliveryEmail, digest: codeDigest, userId: input.userId }
    await this.challenges.saveEmail(scope, challenge, CHALLENGE_TTL)

    const email = {
      from: this.env.EMAIL_AUTH_FROM?.trim() || DEFAULT_FROM,
      to: [input.deliveryEmail],
      ...emailContent(code, input.locale)
    }
    if (await resendDeliveryRejected(apiKey, requestId, email, this.send)) {
      await this.challenges.removeEmail(scope, challenge)
      throw EmailAuthUnavailableError()
    }

    return { request_id: requestId, expires_in: CHALLENGE_TTL, resend_after: RESEND_COOLDOWN }
  }

  async verifyCode(input: VerifyInput): Promise<string> {
    if (input.purpose === 'bind' && input.userId === undefined) throw EmailVerifyCodeError()
    const key = await this.hmacKey()
    const addressHash = await digest(key, 'address', input.emailKey)
    const environment = this.env.RUN_TYPE
    const scope: EmailChallengeKey = { environment, purpose: input.purpose, addressHash }
    const challenge = await this.challenges.readEmail(scope)
    if (!challenge || challenge.requestId !== input.requestId || challenge.userId !== input.userId) throw EmailVerifyCodeError()

    const attempt = await this.challenges.countEmailAttempt(environment, input.requestId, CHALLENGE_TTL)
    if (attempt > MAX_ATTEMPTS) throw EmailVerifyCodeRateLimitError()
    const codeDigest = await digest(key, 'code', input.purpose, input.emailKey, input.requestId, input.code)
    if (!timingSafeEqual(Buffer.from(challenge.digest, 'hex'), Buffer.from(codeDigest, 'hex'))) {
      if (attempt === MAX_ATTEMPTS) throw EmailVerifyCodeRateLimitError()
      throw EmailVerifyCodeError()
    }
    if (!(await this.challenges.removeEmail(scope, challenge))) throw EmailVerifyCodeError()
    return challenge.recipient
  }

  private hmacKey(): Promise<CryptoKey> {
    const secret = this.env.EMAIL_AUTH_HMAC_SECRET
    if (!secret?.trim()) throw EmailAuthUnavailableError()
    return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  }
}
