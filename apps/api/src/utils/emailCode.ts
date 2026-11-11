import { EMAIL_CODE_CONFIG } from '@/const/emailCode'
import { i18n } from '@/const/i18n'

export function generateEmailVerificationCode(): string {
  const range = 10 ** EMAIL_CODE_CONFIG.length
  const limit = Math.floor(2 ** 32 / range) * range
  const random = new Uint32Array(1)
  do {
    crypto.getRandomValues(random)
  } while (random[0] >= limit)
  return String(random[0] % range).padStart(EMAIL_CODE_CONFIG.length, '0')
}

export function createEmailCodeMessage(code: string, locale?: string) {
  const language = locale?.toLowerCase().split(/[-_]/)[0] === 'zh' ? 'zh' : 'en'
  const t = i18n(language)
  return {
    subject: t.emailVerificationCodeSubject({}),
    text: t.emailVerificationCodeText({ code, minutes: String(EMAIL_CODE_CONFIG.ttlSeconds / 60) })
  }
}
