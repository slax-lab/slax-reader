import { timingSafeEqual } from 'node:crypto'
import type { EmailCodeChallenge, EmailCodeInput } from '@slax-reader/contracts/email-auth'
import { EmailAuthUnavailableError, EmailVerifyCodeError, EmailVerifyCodeRateLimitError, ErrorParam, TooManyRequestsError } from '@/const/err'
import { inject, injectable } from '@/decorators/di'
import { sendResendEmail } from '@/infra/external/resend'
import { RedisEmailChallenge, type EmailChallenge, type EmailChallengeKey } from '@/infra/repository/redisEmailChallenge'
import { hashSHA256 } from '@/utils/strings'

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

type Scope = { purpose: 'login' | 'bind'; userId?: number }
export type EmailCodeSendContext = Scope & { clientIp: string; deviceId: string; locale?: string }
type SendInput = EmailCodeSendContext & { emailKey: string; deliveryEmail: string }
type VerifyInput = Scope & EmailCodeInput

function newCode(): string {
  const range = 1_000_000
  const limit = Math.floor(2 ** 32 / range) * range
  const random = new Uint32Array(1)
  do {
    crypto.getRandomValues(random)
  } while (random[0] >= limit)
  return String(random[0] % range).padStart(6, '0')
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

@injectable()
export class EmailCodeService {
  constructor(@inject(RedisEmailChallenge) private readonly challenges: RedisEmailChallenge) {}

  async sendCode(env: Env, input: SendInput, send?: typeof fetch): Promise<EmailCodeChallenge> {
    if (input.purpose === 'bind' && input.userId === undefined) throw ErrorParam()
    const apiKey = env.RESEND_API_KEY?.trim()
    if (!apiKey) throw EmailAuthUnavailableError()
    const code = newCode()
    const requestId = crypto.randomUUID()
    const [addressHash, ipHash, deviceHash, codeDigest] = await Promise.all([
      hashSHA256(input.emailKey),
      hashSHA256(input.clientIp),
      hashSHA256(input.deviceId),
      hashSHA256(`${requestId}:${code}`)
    ])
    const environment = env.RUN_TYPE
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
      from: env.EMAIL_AUTH_FROM?.trim() || DEFAULT_FROM,
      to: [input.deliveryEmail],
      ...emailContent(code, input.locale)
    }
    const outcome = await sendResendEmail(apiKey, requestId, email, send)
    // A timeout, idempotency conflict, or upstream error can follow acceptance.
    if (outcome && !outcome.ok && outcome.status < 500 && outcome.status !== 408 && outcome.status !== 409) {
      await this.challenges.removeEmail(scope, challenge)
      throw EmailAuthUnavailableError()
    }

    return { request_id: requestId, expires_in: CHALLENGE_TTL, resend_after: RESEND_COOLDOWN }
  }

  async verifyCode(env: Env, input: VerifyInput): Promise<{ key: string; delivery: string }> {
    if (input.purpose === 'bind' && input.userId === undefined) throw EmailVerifyCodeError()
    const { email, request_id: requestId, code } = input
    if (typeof email !== 'string' || typeof requestId !== 'string' || typeof code !== 'string') throw ErrorParam()
    const key = email.trim().toLowerCase()
    const addressHash = await hashSHA256(key)
    const environment = env.RUN_TYPE
    const scope: EmailChallengeKey = { environment, purpose: input.purpose, addressHash }
    const challenge = await this.challenges.readEmail(scope)
    if (!challenge || challenge.requestId !== requestId || challenge.userId !== input.userId) throw EmailVerifyCodeError()

    const attempt = await this.challenges.countEmailAttempt(environment, requestId, CHALLENGE_TTL)
    if (attempt > MAX_ATTEMPTS) throw EmailVerifyCodeRateLimitError()
    const codeDigest = await hashSHA256(`${requestId}:${code}`)
    if (!timingSafeEqual(Buffer.from(challenge.digest, 'hex'), Buffer.from(codeDigest, 'hex'))) {
      if (attempt === MAX_ATTEMPTS) throw EmailVerifyCodeRateLimitError()
      throw EmailVerifyCodeError()
    }
    if (!(await this.challenges.removeEmail(scope, challenge))) throw EmailVerifyCodeError()
    return { key, delivery: challenge.recipient }
  }
}
