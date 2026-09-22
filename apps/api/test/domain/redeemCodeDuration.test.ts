import { describe, expect, test } from 'vitest'
import { SubscriptionService } from '@/domain/subscription'
import { subscriptionInterval, subscriptionPeriod, subscriptionType } from '@/infra/repository/dbSubscription'

const NOW = new Date('2026-08-28T00:00:00.000Z')

const redeemPeriod = (createdAt: Date): subscriptionPeriod => ({
  user_id: 1,
  type: subscriptionType.REDEEM_CODE,
  source: '',
  interval: subscriptionInterval.MONTH,
  interval_count: 6,
  created_at: createdAt
})

describe('兑换码时长计算', () => {
  test('单个兑换码发放6个自然月', () => {
    const endTime = SubscriptionService.calculationExpiredTimeByEntity([redeemPeriod(NOW)])

    expect(endTime.toISOString()).toBe('2027-02-28T00:00:00.000Z')
  })

  test('多个兑换码时长叠加而非覆盖', () => {
    const endTime = SubscriptionService.calculationExpiredTimeByEntity([redeemPeriod(NOW), redeemPeriod(NOW)])

    expect(endTime.toISOString()).toBe('2027-08-28T00:00:00.000Z')
  })

  test('在已有订阅到期后继续累加', () => {
    const stripePeriod: subscriptionPeriod = {
      user_id: 1,
      type: subscriptionType.STRIPE,
      source: '',
      interval: subscriptionInterval.MONTH,
      interval_count: 1,
      created_at: NOW
    }

    const endTime = SubscriptionService.calculationExpiredTimeByEntity([stripePeriod, redeemPeriod(new Date('2026-09-10T00:00:00.000Z'))])

    // Stripe订阅到2026-09-28, 兑换码从该时间点起再加6个月
    expect(endTime.toISOString()).toBe('2027-03-28T00:00:00.000Z')
  })
})
