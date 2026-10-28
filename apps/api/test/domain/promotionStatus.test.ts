import { describe, expect, test, vi } from 'vitest'
import { SubscriptionServiceMain } from '@/domain/subscriptionMain'
import { PromotionController } from '@/handler/http/promotionController'
import { receiveActivityType } from '@/infra/repository/dbSubscription'

function setup(sub: unknown = null, received = false) {
  const repo = {
    getUserSubscriptionInfo: vi.fn().mockResolvedValue(sub),
    findReceiveActivityRecord: vi.fn().mockResolvedValue(received ? {} : null),
    claimReward: vi.fn().mockResolvedValue({ credit: false, endTime: '2027-01-01T00:00:00Z' })
  }
  const service = new SubscriptionServiceMain((() => ({ liveMode: false })) as never, {} as never, {} as never, repo as never, {} as never, {} as never, {} as never)
  const ctx = { getUserId: () => 7, getlang: () => 'en', env: {} } as never
  return { repo, service, ctx }
}
const active = (source_type: string, stripe_customer_id = '') => ({ source_type, stripe_customer_id, subscription_end_time: new Date(Date.now() + 86400000) })

describe('promotion status and grant compatibility', () => {
  test.each([
    [null, { kind: 'trial', days: 60 }],
    [active('stripe', 'cus_1'), { kind: 'credit', amount: 1198, currency: 'usd' }],
    [active('stripe'), { kind: 'trial', days: 60 }]
  ])('describes the actual reward for %j', async (sub, reward) => {
    const h = setup(sub)
    const response = await new PromotionController(h.service).checkReceiveStatus(
      h.ctx,
      new Request('https://test/v1/promotion/check_receive', { method: 'POST', body: JSON.stringify({ activity_type: 'blogger' }) })
    )
    expect(((await response.json()) as any).data).toEqual({ status: false, reason: 'eligible', reward })
  })
  test('prior receipt takes precedence over temporary Apple exclusion', async () => {
    for (const received of [false, true]) {
      const h = setup(active('apple'), received)
      expect(await h.service.getReceiveStatus(h.ctx, 'blogger')).toEqual({ status: true, reason: received ? 'already_received' : 'active_apple_subscription' })
    }
  })
  test('legacy unsupported boolean is retained without new eligibility reason', async () => {
    const h = setup()
    expect(await h.service.getReceiveStatus(h.ctx, 'unknown')).toEqual({ status: false })
    expect(await h.service.checkReceiveStatus(h.ctx, 'unknown')).toBe(false)
  })
  test.each([
    [receiveActivityType.BLOGGER, 60, 1198],
    [receiveActivityType.PLATFORM_0527, 30, 599]
  ])('retains %s transaction inputs', async (activity, days, credit) => {
    const h = setup()
    await h.service.receiveSubscription(h.ctx, activity, activity === 'blogger' ? 'daguang' : undefined)
    expect(h.repo.claimReward).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, key: `reward:activity:7:${activity}`, count: days, credit }))
    expect(await h.service.getReceiveStatus(h.ctx, activity)).toEqual({ status: false, reason: 'eligible', reward: { kind: 'trial', days } })
  })
})
