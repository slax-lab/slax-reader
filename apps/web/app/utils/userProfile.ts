import type { UserInfo } from '@slax-reader/contracts/interface'

interface ProfileTarget {
  user: UserInfo | null
  locale: string
  changeLocalLocale: (locale: string) => Promise<void>
}
const reads = new WeakMap<ProfileTarget, { next: number; committed: number }>()

/** Share commit ordering across server reads and their optional offline fallback. */
export async function readUserProfile(target: ProfileTarget, read: () => Promise<UserInfo>): Promise<UserInfo> {
  let order = reads.get(target)
  if (!order) {
    order = { next: 0, committed: 0 }
    reads.set(target, order)
  }
  const sequence = ++order.next
  const token = getUserToken()
  const profile = await read()
  if (token !== getUserToken() || reads.get(target) !== order) throw new Error('Session changed')
  if (sequence >= order.committed) {
    order.committed = sequence
    target.user = profile
    if (target.locale !== profile.lang) void target.changeLocalLocale(profile.lang)
  }
  return profile
}

export function invalidateUserProfile(target: ProfileTarget) {
  reads.delete(target)
}
