// utils/userRelative.ts 测试
// fork 实现（区别于 upstream 的 stub 永远返回 false）：按 subscription_end_at 到期时间 +
// subscription_type 判断真实订阅是否过期。
import { checkUserSubscribedIsExpired } from '~~/app/utils/userRelative'

import { SubscriptionType, type UserInfo } from '@slax-reader/contracts/interface'
import { describe, expect, it } from 'vitest'

const baseUser: UserInfo = {
  userId: 100,
  email: 'a@b.c',
  lang: 'en',
  name: 'X',
  picture: 'p',
  timezone: 'UTC'
}

describe('checkUserSubscribedIsExpired', () => {
  it('subscription_end_at 缺失 → 视为已过期', () => {
    expect(checkUserSubscribedIsExpired(baseUser)).toBe(true)
  })

  it('subscription_end_at 在未来 + PAID_SUBSCRIPTION → 未过期', () => {
    const user = { ...baseUser, subscription_end_at: new Date(Date.now() + 86400000).toISOString(), subscription_type: SubscriptionType.PAID_SUBSCRIPTION }
    expect(checkUserSubscribedIsExpired(user)).toBe(false)
  })

  it('subscription_end_at 已过去 → 已过期', () => {
    const user = { ...baseUser, subscription_end_at: new Date(Date.now() - 86400000).toISOString(), subscription_type: SubscriptionType.PAID_SUBSCRIPTION }
    expect(checkUserSubscribedIsExpired(user)).toBe(true)
  })

  it('subscription_end_at 在未来但 subscription_type=NO_SUBSCRIPTION → 视为已过期', () => {
    const user = { ...baseUser, subscription_end_at: new Date(Date.now() + 86400000).toISOString(), subscription_type: SubscriptionType.NO_SUBSCRIPTION }
    expect(checkUserSubscribedIsExpired(user)).toBe(true)
  })
})
