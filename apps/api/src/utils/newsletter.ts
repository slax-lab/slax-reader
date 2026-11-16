export { NEWSLETTER_LIMITS, NewsletterError } from './newsletterMime'

export interface NewsletterConfig {
  NEWSLETTER_DOMAIN?: string
}
export const NEWSLETTER_LOCAL_PREFIX = 'feed+'
// Reserve five SMTP local-part octets for feed+ when validating the initial account token.
export const newsletterLocalPart = (value: string): string | null =>
  value.length > 0 && value.length <= 64 - NEWSLETTER_LOCAL_PREFIX.length && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value) && !value.includes('..')
    ? value.toLowerCase()
    : null
export const newsletterRecipientPart = (value: string): string | null =>
  value.toLowerCase().startsWith(NEWSLETTER_LOCAL_PREFIX) ? newsletterLocalPart(value.slice(NEWSLETTER_LOCAL_PREFIX.length)) : null
export const newsletterDomain = (value: string): string | null =>
  value.length <= 253 && /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(value) ? value.toLowerCase() : null
export const configuredNewsletterDomain = (env: NewsletterConfig): string | null => newsletterDomain(env.NEWSLETTER_DOMAIN || '')
