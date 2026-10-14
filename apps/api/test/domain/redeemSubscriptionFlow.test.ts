import { describe, expect, test, vi } from 'vitest'
import { SubscriptionServiceMain } from '@/domain/subscriptionMain'
import { subscriptionInterval } from '@/infra/repository/dbSubscription'

function harness(credit = false) {
  const repo = {
    claimReward: vi.fn().mockResolvedValue({ credit, endTime: '2027-02-28T00:00:00.000Z' }),
    getPaymentJob: vi.fn().mockResolvedValue({
      status: 'pending',
      kind: 'stripe_credit',
      created_at: new Date(),
      payload: { customerId: 'cus_123', amount: -3594, currency: 'usd', description: 'Subscription reward' }
    }),
    claimPaymentJob: vi.fn().mockResolvedValue('lease'),
    finishPaymentJob: vi.fn().mockResolvedValue(undefined)
  }
  const create = vi.fn().mockResolvedValue({ id: 'credit' })
  const push = vi.fn()
  const service = new SubscriptionServiceMain(
    (() => ({ customers: { createBalanceTransaction: create } })) as never,
    {} as never,
    {} as never,
    repo as never,
    { stripe: { pushMessage: push } } as never,
    {} as never,
    {} as never
  )
  return { service, repo, create, push, ctx: { getUserId: () => 1, env: { STRIPE_LIVE_MODE: 'false' } } as never }
}

describe('redeemSubscription transactional reward flow', () => {
  test('delegates code consumption and six-month grant to the same transaction', async () => {
    const h = harness()
    await h.service.redeemSubscription(h.ctx, 'abc')
    expect(h.repo.claimReward).toHaveBeenCalledWith({
      key: 'reward:redeem:1:abc',
      userId: 1,
      code: 'abc',
      interval: subscriptionInterval.MONTH,
      count: 6,
      credit: 3594,
      liveMode: false
    })
    expect(h.create).not.toHaveBeenCalled()
    expect(h.push).not.toHaveBeenCalled()
  })

  test('maps only already-claimed codes to the public error', async () => {
    const h = harness()
    h.repo.claimReward.mockRejectedValue(new Error('REWARD_ALREADY_CLAIMED'))
    await expect(h.service.redeemSubscription(h.ctx, 'used')).rejects.toMatchObject({ name: 'REDEEM_CODE_NOT_FOUND_OR_USED' })
    expect(h.create).not.toHaveBeenCalled()
  })

  test('database failures remain retryable instead of being called duplicate', async () => {
    const h = harness()
    h.repo.claimReward.mockRejectedValue(new Error('database offline'))
    await expect(h.service.redeemSubscription(h.ctx, 'abc')).rejects.toThrow('database offline')
  })

  test('credit executes persisted parameters with a stable idempotency key', async () => {
    const h = harness(true)
    await h.service.redeemSubscription(h.ctx, 'abc')
    expect(h.create).toHaveBeenCalledWith(
      'cus_123',
      { amount: -3594, currency: 'usd', description: 'Subscription reward' },
      { idempotencyKey: 'stripe:false::credit:reward:redeem:1:abc' }
    )
    expect(h.repo.finishPaymentJob).toHaveBeenCalledWith('stripe:false::credit:reward:redeem:1:abc', 'lease')
  })

  test('credit delivery failure remains pending for recovery', async () => {
    const h = harness(true)
    h.create.mockRejectedValue(new Error('Stripe timeout'))
    await expect(h.service.redeemSubscription(h.ctx, 'abc')).rejects.toThrow('Stripe timeout')
    expect(h.repo.finishPaymentJob).toHaveBeenCalledWith('stripe:false::credit:reward:redeem:1:abc', 'lease', 'Error: Stripe timeout')
  })
})
