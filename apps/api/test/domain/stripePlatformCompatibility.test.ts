import { describe, expect, test, vi } from 'vitest'
import Stripe from 'stripe'
import { SubscriptionService } from '@/domain/subscription'
import { SubscriptionPaymentService } from '@/domain/subscriptionPayment'

const invoice = (metadata: Record<string, string> = { user_id: '7' }, livemode = true) => ({
  id: 'in_legacy',
  livemode,
  billing_reason: 'subscription_cycle',
  subscription: 'sub_legacy',
  customer: 'cus_bound',
  amount_paid: 599,
  currency: 'usd',
  subscription_details: { metadata },
  lines: { has_more: false, data: [{ type: 'subscription', price: { recurring: { interval: 'month', interval_count: 1 } }, period: { start: 1793095569, end: 1795773969 } }] }
})

function setup() {
  const repo = {
    reconcilePayment: vi.fn(),
    createSubscriptionEvent: vi.fn().mockResolvedValue({ id: 1 }),
    applyPaymentGrant: vi.fn(),
    applyPaymentRefund: vi.fn(),
    getPaymentJob: vi.fn().mockResolvedValue(null),
    getUserSubscriptionInfo: vi.fn().mockResolvedValue({ stripe_customer_id: 'cus_bound' }),
    writePaymentState: vi.fn(),
    createPaymentCommand: vi.fn().mockResolvedValue('cancel-command')
  }
  const pushStripeEvent = vi.fn()
  const stripe = new Stripe('sk_test_local_only')
  const ingress = new SubscriptionService((() => stripe) as never, repo as never, (() => ({ pushStripeEvent })) as never)
  const client = {
    subscriptions: { retrieve: vi.fn() },
    prices: { retrieve: vi.fn().mockResolvedValue({ metadata: { duration_type: 'month', duration: '1' } }) },
    invoices: { retrieve: vi.fn() },
    refunds: {
      list: () =>
        (async function* () {
          yield { id: 're_1', amount: 599, status: 'succeeded' }
        })()
    }
  }
  const payments = new SubscriptionPaymentService((() => client) as never, repo as never)
  const callback = async (object = invoice(), options: { livemode?: boolean; account?: string; signature?: string } = {}) => {
    const body = JSON.stringify({
      id: 'evt_legacy',
      type: 'invoice.payment_succeeded',
      created: 1793099277,
      livemode: options.livemode ?? true,
      account: options.account,
      data: { object }
    })
    const signature = options.signature ?? stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_test_only' })
    await ingress.decryptCallbackEvent({ env: { STRIPE_CALLBACK_SECRET: 'whsec_test_only' } } as never, body, signature)
  }
  return { repo, client, payments, callback, pushStripeEvent }
}

describe('Stripe platform metadata compatibility', () => {
  test.each([undefined, 'legacy', 'reader'])('signed renewal with platform %s reaches the grant path', async platform => {
    const h = setup()
    const data = invoice({ user_id: '7', ...(platform ? { platform } : {}) })
    await h.callback(data)
    expect(h.repo.createSubscriptionEvent).toHaveBeenCalledOnce()
    expect(h.pushStripeEvent).toHaveBeenCalledWith(1)
    await h.payments.handle('invoice.payment_succeeded', data)
    expect(h.repo.applyPaymentGrant).toHaveBeenCalledWith(expect.objectContaining({ key: 'stripe:true::invoice:in_legacy', userId: 7, customerId: 'cus_bound' }))
    expect(h.repo.reconcilePayment).not.toHaveBeenCalled()
  })

  test.each(['collection_id', 'owner_id'])('retains %s exclusion at both boundaries', async field => {
    const h = setup()
    const data = invoice({ user_id: '7', [field]: 'other-product' })
    await h.callback(data)
    await h.payments.handle('invoice.payment_succeeded', data)
    expect(h.repo.reconcilePayment).toHaveBeenCalledTimes(2)
    expect(h.repo.createSubscriptionEvent).not.toHaveBeenCalled()
    expect(h.repo.applyPaymentGrant).not.toHaveBeenCalled()
  })

  test.each([{}, { user_id: '0' }, { user_id: 'not-a-user' }])('does not grant without a valid user: %j', async metadata => {
    const h = setup()
    await h.payments.handle('invoice.paid', invoice(metadata))
    expect(h.repo.reconcilePayment).toHaveBeenCalledOnce()
    expect(h.repo.applyPaymentGrant).not.toHaveBeenCalled()
  })

  test.each([true, false])('signed %s-mode callback is persisted for queue handling', async livemode => {
    const h = setup()
    await h.callback(invoice(), { livemode })
    expect(h.repo.createSubscriptionEvent).toHaveBeenCalledOnce()
    expect(h.pushStripeEvent).toHaveBeenCalledWith(1)
  })

  test.each([{ account: 'acct_other' }, { signature: 'invalid' }])('retains webhook authenticity checks: %j', async options => {
    const h = setup()
    await expect(h.callback(invoice(), options)).rejects.toBeDefined()
    expect(h.repo.createSubscriptionEvent).not.toHaveBeenCalled()
  })

  test.each(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'])('legacy %s retains customer validation', async type => {
    const h = setup()
    const subscription = { id: 'sub_legacy', customer: 'cus_bound', metadata: { user_id: '7' }, livemode: true, status: 'active', cancel_at_period_end: false }
    h.client.subscriptions.retrieve.mockResolvedValue(subscription)
    await h.payments.handle(type, subscription)
    expect(h.repo.writePaymentState).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, source: 'sub_legacy' }))
    h.repo.writePaymentState.mockClear()
    h.repo.getUserSubscriptionInfo.mockResolvedValue({ stripe_customer_id: 'cus_different' })
    await h.payments.handle(type, subscription)
    expect(h.repo.writePaymentState).not.toHaveBeenCalled()
    expect(h.repo.reconcilePayment).toHaveBeenCalledOnce()
  })

  test('legacy one-time payment reaches grant validation', async () => {
    const h = setup()
    await h.payments.handle('payment_intent.succeeded', {
      id: 'pi_legacy',
      metadata: { user_id: '7', price_id: 'price_1' },
      customer: 'cus_bound',
      amount_received: 599,
      currency: 'usd',
      created: 1793095569,
      livemode: true
    })
    expect(h.repo.applyPaymentGrant).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, key: 'stripe:true::pi:pi_legacy' }))
  })

  test.each([true, false])('%s-mode invoice grant carries its mode-specific idempotency scope', async livemode => {
    const h = setup()
    const data = invoice({ user_id: '7' }, livemode)
    await h.payments.handle('invoice.payment_succeeded', data)
    expect(h.repo.applyPaymentGrant).toHaveBeenCalledWith(expect.objectContaining({
      key: `stripe:${livemode}::invoice:in_legacy`, scope: `stripe:${livemode}:`, userId: 7
    }))
  })

  test('legacy invoice refund reaches refund validation', async () => {
    const h = setup()
    h.client.invoices.retrieve.mockResolvedValue({ ...invoice(), charge: 'ch_1' })
    await h.payments.handle('charge.refunded', { id: 'ch_1', invoice: 'in_legacy', customer: 'cus_bound', amount: 599, livemode: true })
    expect(h.repo.applyPaymentRefund).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, key: 'stripe:true::invoice:in_legacy', cumulative: 599 }))
  })

  test.each([true, false])('legacy cancellation accepts %s-mode subscriptions and retains customer checks', async livemode => {
    const h = setup()
    h.client.subscriptions.retrieve.mockResolvedValue({ id: 'sub_legacy', metadata: { user_id: '7' }, customer: 'cus_bound', livemode })
    h.repo.getPaymentJob.mockResolvedValue({ status: 'done' } as never)
    await h.payments.cancel('sub_legacy', 'owner request', 'cus_bound')
    expect(h.repo.createPaymentCommand).toHaveBeenCalledOnce()
    await expect(h.payments.cancel('sub_legacy', 'owner request', 'cus_other')).rejects.toThrow()
    expect(h.repo.createPaymentCommand).toHaveBeenCalledOnce()
  })
})
