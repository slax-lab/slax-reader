import { ErrorParam } from '@/const/err'
/** Internal mail identities are bookmark keys, never acquisition URLs. */
export const isNewsletterTarget = (value: unknown): boolean => typeof value === 'string' && /^slax-newsletter:/i.test(value.trim())
export function assertExternalNewsletterTarget(value: unknown) {
  if (isNewsletterTarget(value)) throw ErrorParam()
}
