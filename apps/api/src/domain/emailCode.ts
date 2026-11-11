import { timingSafeEqual } from 'node:crypto'
import type { EmailCodeChallenge, EmailCodeInput } from '@slax-reader/contracts/email-auth'
import { EmailAuthUnavailableError, EmailVerifyCodeError, EmailVerifyCodeRateLimitError, ErrorParam, TooManyRequestsError } from '@/const/err'
import { inject, injectable } from '@/decorators/di'
import { sendResendEmail } from '@/infra/external/resend'
import { EmailChallengeRepo, type EmailChallenge, type EmailChallengeKey } from '@/infra/repository/redisEmailChallenge'
import { hashSHA256 } from '@/utils/strings'
import { EMAIL_CODE_CONFIG } from '@/const/emailCode'
import { createEmailCodeMessage, generateEmailVerificationCode } from '@/utils/emailCode'

type Scope = { purpose: 'login' | 'bind'; userId?: number }
export type EmailCodeSendContext = Scope & { clientIp: string; deviceId: string; locale?: string }
type SendInput = EmailCodeSendContext & { emailKey: string; deliveryEmail: string }
type VerifyInput = Scope & EmailCodeInput

@injectable()
export class EmailCodeService {
  constructor(@inject(EmailChallengeRepo) private readonly challenges: EmailChallengeRepo) {}

  async sendCode(env: Env, input: SendInput, send?: typeof fetch): Promise<EmailCodeChallenge> {
    if (input.purpose === 'bind' && input.userId === undefined) throw ErrorParam()
    const apiKey = env.RESEND_API_KEY?.trim()
    if (!apiKey) throw EmailAuthUnavailableError()
    const code = generateEmailVerificationCode()
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
      this.challenges.countEmailSend(environment, 'ip', ipHash, EMAIL_CODE_CONFIG.sendWindowSeconds),
      this.challenges.countEmailSend(environment, 'device', deviceHash, EMAIL_CODE_CONFIG.sendWindowSeconds)
    ])
    if (ipCount > EMAIL_CODE_CONFIG.ipSendLimit || deviceCount > EMAIL_CODE_CONFIG.deviceSendLimit) throw TooManyRequestsError()
    if (!(await this.challenges.takeEmailCooldown(scope, EMAIL_CODE_CONFIG.resendCooldownSeconds))) throw TooManyRequestsError()
    if ((await this.challenges.countEmailSend(environment, 'address', addressHash, EMAIL_CODE_CONFIG.sendWindowSeconds)) > EMAIL_CODE_CONFIG.addressSendLimit)
      throw TooManyRequestsError()
    if ((await this.challenges.countEmailSend(environment, 'environment', 'all', EMAIL_CODE_CONFIG.dailySendWindowSeconds)) > EMAIL_CODE_CONFIG.environmentSendLimit)
      throw TooManyRequestsError()

    const challenge: EmailChallenge = { requestId, recipient: input.deliveryEmail, digest: codeDigest, userId: input.userId }
    await this.challenges.saveEmail(scope, challenge, EMAIL_CODE_CONFIG.ttlSeconds)

    const email = {
      from: env.EMAIL_AUTH_FROM?.trim() || EMAIL_CODE_CONFIG.defaultFrom,
      to: [input.deliveryEmail],
      ...createEmailCodeMessage(code, input.locale)
    }
    const outcome = await sendResendEmail(apiKey, requestId, email, send)
    // A timeout, idempotency conflict, or upstream error can follow acceptance.
    if (outcome && !outcome.ok && outcome.status < 500 && outcome.status !== 408 && outcome.status !== 409) {
      await this.challenges.removeEmail(scope, challenge)
      throw EmailAuthUnavailableError()
    }

    return { request_id: requestId, expires_in: EMAIL_CODE_CONFIG.ttlSeconds, resend_after: EMAIL_CODE_CONFIG.resendCooldownSeconds }
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

    const attempt = await this.challenges.countEmailAttempt(environment, requestId, EMAIL_CODE_CONFIG.ttlSeconds)
    if (attempt > EMAIL_CODE_CONFIG.maxAttempts) throw EmailVerifyCodeRateLimitError()
    const codeDigest = await hashSHA256(`${requestId}:${code}`)
    if (!timingSafeEqual(Buffer.from(challenge.digest, 'hex'), Buffer.from(codeDigest, 'hex'))) {
      if (attempt === EMAIL_CODE_CONFIG.maxAttempts) throw EmailVerifyCodeRateLimitError()
      throw EmailVerifyCodeError()
    }
    if (!(await this.challenges.removeEmail(scope, challenge))) throw EmailVerifyCodeError()
    return { key, delivery: challenge.recipient }
  }
}
