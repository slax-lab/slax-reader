import { timingSafeEqual } from 'node:crypto'
import type { EmailCodeChallenge, EmailCodeInput, EmailLinkInput } from '@slax-reader/contracts/email-auth'
import { EmailAuthUnavailableError, EmailVerifyCodeError, EmailVerifyCodeRateLimitError, ErrorParam, TooManyRequestsError } from '@/const/err'
import { inject, injectable } from '@/decorators/di'
import { sendResendEmail } from '@/infra/external/resend'
import { EmailChallengeRepo, type EmailChallenge, type EmailChallengeKey } from '@/infra/repository/redisEmailChallenge'
import { hashSHA256 } from '@/utils/strings'
import { EMAIL_CODE_CONFIG } from '@/const/emailCode'
import { createEmailCodeMessage, createEmailLoginLink, generateEmailLoginToken, generateEmailVerificationCode } from '@/utils/emailCode'

type Scope = { purpose: 'login' | 'bind'; userId?: number }
export type EmailCodeSendContext = Scope & { clientIp: string; deviceId: string; locale?: string }
type SendInput = EmailCodeSendContext & { emailKey: string; deliveryEmail: string }
type VerifyInput = Scope & EmailCodeInput

@injectable()
export class EmailCodeService {
  constructor(@inject(EmailChallengeRepo) private readonly challenges: EmailChallengeRepo) {}

  async sendCode(env: Env, input: SendInput, send?: typeof fetch): Promise<EmailCodeChallenge> {
    if (input.purpose === 'bind' && input.userId === undefined) throw ErrorParam()
    const logCode = input.purpose === 'login' && input.emailKey.endsWith(EMAIL_CODE_CONFIG.internalEmailSuffix)
    const apiKey = env.RESEND_API_KEY?.trim() || ''
    if (!logCode && !apiKey) throw EmailAuthUnavailableError()
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

    const token = input.purpose === 'login' ? generateEmailLoginToken() : undefined
    const link = token ? createEmailLoginLink(env.FRONT_END_URL, { email: input.emailKey, request_id: requestId, token }) : undefined
    const challenge: EmailChallenge = { requestId, recipient: input.deliveryEmail, digest: codeDigest, userId: input.userId }
    if (token) challenge.linkDigest = await hashSHA256(`${requestId}:${token}`)
    await this.challenges.saveEmail(scope, challenge, EMAIL_CODE_CONFIG.ttlSeconds)

    if (logCode) {
      console.log(`[Email login] email=${input.deliveryEmail} code=${code}`)
    } else {
      const email = {
        from: env.EMAIL_AUTH_FROM?.trim() || EMAIL_CODE_CONFIG.defaultFrom,
        to: [input.deliveryEmail],
        ...createEmailCodeMessage(code, input.locale, link)
      }
      const outcome = await sendResendEmail(apiKey, requestId, email, send)
      // A timeout, idempotency conflict, or upstream error can follow acceptance.
      if (outcome && !outcome.ok && outcome.status < 500 && outcome.status !== 408 && outcome.status !== 409) {
        await this.challenges.removeEmail(scope, challenge)
        throw EmailAuthUnavailableError()
      }
    }

    return { request_id: requestId, expires_in: EMAIL_CODE_CONFIG.ttlSeconds, resend_after: EMAIL_CODE_CONFIG.resendCooldownSeconds }
  }

  async verifyCode(env: Env, input: VerifyInput): Promise<{ key: string; delivery: string }> {
    return this.verify(env, input, input.code, 'digest')
  }

  async verifyLink(env: Env, input: EmailLinkInput): Promise<{ key: string; delivery: string }> {
    if (typeof input.token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(input.token)) throw ErrorParam()
    return this.verify(env, { ...input, purpose: 'login' }, input.token, 'linkDigest')
  }

  private async verify(env: Env, input: Scope & Pick<EmailCodeInput, 'email' | 'request_id'>, proof: string, field: 'digest' | 'linkDigest') {
    if (input.purpose === 'bind' && input.userId === undefined) throw EmailVerifyCodeError()
    const { email, request_id: requestId } = input
    if (typeof email !== 'string' || typeof requestId !== 'string' || typeof proof !== 'string') throw ErrorParam()
    const key = email.trim().toLowerCase()
    const addressHash = await hashSHA256(key)
    const environment = env.RUN_TYPE
    const scope: EmailChallengeKey = { environment, purpose: input.purpose, addressHash }
    const challenge = await this.challenges.readEmail(scope)
    if (!challenge || challenge.requestId !== requestId || challenge.userId !== input.userId || !challenge[field]) throw EmailVerifyCodeError()

    const attempt = await this.challenges.countEmailAttempt(environment, requestId, EMAIL_CODE_CONFIG.ttlSeconds)
    if (attempt > EMAIL_CODE_CONFIG.maxAttempts) throw EmailVerifyCodeRateLimitError()
    const codeDigest = await hashSHA256(`${requestId}:${proof}`)
    if (!timingSafeEqual(Buffer.from(challenge[field], 'hex'), Buffer.from(codeDigest, 'hex'))) {
      if (attempt === EMAIL_CODE_CONFIG.maxAttempts) throw EmailVerifyCodeRateLimitError()
      throw EmailVerifyCodeError()
    }
    if (!(await this.challenges.removeEmail(scope, challenge))) throw EmailVerifyCodeError()
    return { key, delivery: challenge.recipient }
  }
}
