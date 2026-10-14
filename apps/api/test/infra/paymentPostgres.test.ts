import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import Stripe from 'stripe'
import { SubscriptionService } from '@/domain/subscription'
import { SubscriptionAppleService } from '@/domain/subscriptionApple'
import { SubscriptionTelemetryService } from '@/domain/subscriptionTelemetry'
import { SubscriptionPaymentService } from '@/domain/subscriptionPayment'
import { SubscriptionOrchestrator } from '@/domain/orchestrator/subscription'
import { PrismaClient } from '@prisma/hyperdrive-client'
import { PrismaPg } from '@prisma/adapter-pg'
import { SubscriptionRepo, subscriptionInterval } from '@/infra/repository/dbSubscription'

const enabled = process.env.PAYMENT_LOCAL_PG_TEST === '1'
const db = enabled ? new PrismaClient({ adapter: new PrismaPg({ connectionString: 'postgresql://postgres@127.0.0.1:6543/payment_reader_clean' }) }) : null
const repo = new SubscriptionRepo((() => db) as never)
const at = new Date('2030-01-01T00:00:00Z')
const grant = (key = 'stripe:false::invoice:in_1', userId = 7) => ({
  key,
  userId,
  provider: 'stripe' as const,
  source: 'sub_1',
  amount: 1000,
  interval: subscriptionInterval.DAY,
  count: 30,
  at,
  autoRenew: true
})
const refund = (cumulative: number, id: string, key = grant().key) => ({
  key,
  userId: 7,
  provider: 'stripe' as const,
  source: 'sub_1',
  total: 1000,
  cumulative,
  refundIds: [{ id, amount: cumulative }]
})

describe.skipIf(!enabled)('payment ledger against isolated PostgreSQL', () => {
  beforeAll(async () => {
    await db!.$connect()
  })
  beforeEach(async () => {
    await db!.$executeRawUnsafe(
      'TRUNCATE sr_payment_refund, sr_payment_grant, sr_payment_job, sr_user_subscription_period, sr_user_subscription, sr_apple_transaction_processed, sr_stripe_event, sr_user_receive_activity_record, sr_user_collection_subscriber_period, sr_user_collection_subscriber, sr_user_redeem_code RESTART IDENTITY'
    )
    await db!.sr_user.upsert({
      where: { id: 7 },
      create: { id: 7, email: 'payment-seven@test.invalid', last_login_at: new Date(), created_at: new Date() },
      update: { deleted_at: null }
    })
  })
  afterAll(async () => {
    await db!.$disconnect()
  })

  test('concurrent duplicate delivery persists one inbox and grants once', async () => {
    const events = await Promise.all(Array.from({ length: 12 }, () => repo.createSubscriptionEvent('evt_1', 'invoice.paid', '{}', '{}', false, '')))
    expect(new Set(events.map(item => item.id)).size).toBe(1)
    await Promise.all(Array.from({ length: 12 }, () => repo.applyPaymentGrant(grant())))
    expect(await db!.sr_user_subscription_period.count()).toBe(1)
    expect((await repo.getUserSubscriptionInfo(7))!.subscription_end_time.toISOString()).toBe('2030-01-31T00:00:00.000Z')
  })

  test('different concurrent invoices use the user aggregate lock', async () => {
    await Promise.all([repo.applyPaymentGrant(grant('invoice:a')), repo.applyPaymentGrant(grant('invoice:b'))])
    expect(await db!.sr_user_subscription_period.count()).toBe(2)
    expect((await repo.getUserSubscriptionInfo(7))!.subscription_end_time.toISOString()).toBe('2030-03-02T00:00:00.000Z')
  })

  test('partial refunds are cumulative, bounded, replay-safe and affect only one invoice', async () => {
    await repo.applyPaymentGrant(grant())
    await repo.applyPaymentGrant(grant('invoice:other'))
    await Promise.all([repo.applyPaymentRefund(refund(500, 're_1')), repo.applyPaymentRefund(refund(250, 're_old')), repo.applyPaymentRefund(refund(500, 're_1'))])
    expect((await db!.sr_user_subscription_period.findMany({ orderBy: { id: 'asc' } })).map(p => p.interval_count)).toEqual([21600, 43200])
    await repo.applyPaymentRefund(refund(9000, 're_2'))
    expect((await db!.sr_user_subscription_period.findMany({ orderBy: { id: 'asc' } })).map(p => p.interval_count)).toEqual([0, 43200])
    expect((await repo.getUserSubscriptionInfo(7))!.subscription_end_time.toISOString()).toBe('2030-01-31T00:00:00.000Z')
  })

  test('refund-before-payment leaves a tombstone and cannot revive access', async () => {
    await repo.applyPaymentRefund(refund(1000, 're_1'))
    await repo.applyPaymentGrant(grant())
    expect((await db!.sr_user_subscription_period.findFirst())!.interval_count).toBe(0)
    expect((await repo.getUserSubscriptionInfo(7))!.subscription_end_time.getTime()).toBe(0)
  })

  test('failure after Apple processed insert rolls back processed, period and grant then retries', async () => {
    await db!.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION payment_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected projection failure'; END $$`)
    await db!.$executeRawUnsafe('CREATE TRIGGER payment_test_failure BEFORE INSERT ON sr_user_subscription FOR EACH ROW EXECUTE FUNCTION payment_test_fail()')
    const apple = {
      ...grant('apple:Production:tx1'),
      provider: 'apple' as const,
      amount: 0,
      at: new Date(),
      nextInvoiceAt: new Date(Date.now() + 86400000),
      appleTransactionId: 'tx1'
    }
    try {
      await expect(repo.applyPaymentGrant(apple)).rejects.toThrow('injected projection failure')
      expect(await db!.sr_apple_transaction_processed.count()).toBe(0)
      expect(await db!.sr_payment_grant.count()).toBe(0)
      expect(await db!.sr_user_subscription_period.count()).toBe(0)
    } finally {
      await db!.$executeRawUnsafe('DROP TRIGGER payment_test_failure ON sr_user_subscription')
    }
    await repo.applyPaymentGrant(apple)
    expect(await db!.sr_apple_transaction_processed.count()).toBe(1)
    expect(await db!.sr_user_subscription.count()).toBe(1)
  })

  test('Apple delayed receipt, bonuses, older renewal, refund-first and failure retries are bounded', async () => {
    const now = Date.now(),
      day = 86400000
    await db!.sr_user_subscription_period.create({ data: { user_id: 7, type: 7, source: 'bonus', interval: 'day', interval_count: 10, created_at: new Date(now - 5 * day) } })
    const apple = {
      ...grant('apple:Production:a'),
      provider: 'apple' as const,
      amount: 0,
      at: new Date(now - 20 * day),
      nextInvoiceAt: new Date(now + 10 * day),
      appleTransactionId: 'a'
    }
    await repo.applyPaymentGrant(apple)
    const first = (await repo.getUserSubscriptionInfo(7))!
    expect(Math.abs(first.subscription_end_time.getTime() - (now + 15 * day))).toBeLessThanOrEqual(60000)
    await repo.applyPaymentGrant({ ...apple, key: 'apple:Production:older', appleTransactionId: 'older', nextInvoiceAt: new Date(now + 3 * day) })
    expect((await repo.getUserSubscriptionInfo(7))!.subscription_end_time).toEqual(first.subscription_end_time)
    await repo.applyPaymentRefund({
      key: 'apple:Production:b',
      userId: 7,
      provider: 'apple',
      source: 'sub_1',
      total: 0,
      cumulative: 0,
      refundIds: [{ id: 'b', amount: 0 }],
      revoked: true
    })
    await repo.applyPaymentGrant({ ...apple, key: 'apple:Production:b', appleTransactionId: 'b', nextInvoiceAt: new Date(now + 40 * day) })
    expect((await repo.getUserSubscriptionInfo(7))!.subscription_end_time).toEqual(first.subscription_end_time)
  })

  test('legacy eventId delivery, notification failure and retry do not repeat entitlements', async () => {
    await repo.upsertUserSubscription(7, 'cus_a')
    const invoice = {
      id: 'in_e2e',
      billing_reason: 'subscription_cycle',
      customer: 'cus_a',
      subscription: 'sub_a',
      amount_paid: 1000,
      currency: 'usd',
      subscription_details: { metadata: { user_id: '7', platform: 'reader' } },
      lines: {
        has_more: false,
        data: [
          { type: 'subscription', price: { recurring: { interval: 'day', interval_count: 30 } }, period: { start: at.getTime() / 1000, end: at.getTime() / 1000 + 30 * 86400 } }
        ]
      }
    }
    const event = await repo.createSubscriptionEvent('evt_e2e', 'invoice.payment_succeeded', JSON.stringify(invoice), '{}', false, '')
    const notice = vi.fn().mockRejectedValueOnce(new Error('notification down')).mockResolvedValue(undefined)
    const payments = new SubscriptionPaymentService((() => ({})) as never, repo)
    const orchestrator = new SubscriptionOrchestrator(
      { deliverPaymentNotice: notice, deliverPaymentTelemetry: vi.fn().mockResolvedValue(undefined) } as never,
      { getEventById: (id: number) => repo.getEventById(id) } as never,
      repo,
      payments,
      { deliver: vi.fn().mockResolvedValue(undefined) } as never
    )
    const ctx = { env: { STRIPE_LIVE_MODE: 'false' } } as never
    await orchestrator.processSubscription(ctx, { id: 'delivery', info: { eventId: event.id } })
    await orchestrator.recover(ctx)
    await orchestrator.recover(ctx)
    await orchestrator.processSubscription(ctx, { id: 'retry', info: { eventId: event.id } })
    expect(await db!.sr_user_subscription_period.count()).toBe(1)
    expect(notice).toHaveBeenCalledTimes(2)
    expect((await repo.getPaymentJob('stripe:false::evt_e2e'))!.status).toBe('done')
  })

  test('Stripe external success followed by lost acknowledgement reuses a stable idempotency key', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cbtxn_a' })
    const payments = new SubscriptionPaymentService((() => ({ customers: { createBalanceTransaction: create } })) as never, repo)
    await repo.enqueuePaymentJob('credit:retry', 'stripe_credit', { customerId: 'cus_a', amount: -599, currency: 'usd', description: 'reward' })
    const finish = vi.spyOn(repo, 'finishPaymentJob').mockRejectedValueOnce(new Error('lost commit acknowledgement'))
    await expect(payments.runOperation('credit:retry')).rejects.toThrow('lost commit acknowledgement')
    finish.mockRestore()
    await payments.runOperation('credit:retry')
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0][2]).toEqual({ idempotencyKey: 'credit:retry' })
    expect(create.mock.calls[1][2]).toEqual(create.mock.calls[0][2])
  })

  test('concurrent reward claims commit redemption, entitlement and outbox together', async () => {
    await db!.sr_user_redeem_code.create({ data: { code: 'reward-one' } })
    const input = { userId: 7, key: 'reward:redeem:7:reward-one', code: 'reward-one', interval: subscriptionInterval.DAY, count: 30, credit: 599 }
    await Promise.all([repo.claimReward(input), repo.claimReward(input)])
    expect(await db!.sr_user_subscription_period.count()).toBe(1)
    expect((await db!.sr_user_redeem_code.findFirst())!.user_id).toBe(7)
    expect((await repo.getPaymentJob(input.key))!.status).toBe('done')
  })

  test('review: deleted/missing users cannot regain entitlement and deletion row lock serializes', async () => {
    let unlock!: () => void, locked!: () => void
    const ready = new Promise<void>(r => {
      locked = r
    })
    const release = new Promise<void>(r => {
      unlock = r
    })
    const deleting = db!.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sr_user WHERE id=7 FOR UPDATE`
      locked()
      await release
      await tx.sr_user.update({ where: { id: 7 }, data: { deleted_at: new Date() } })
    })
    await ready
    let completed = false
    const granting = repo.applyPaymentGrant(grant()).then(() => {
      completed = true
    })
    await new Promise(r => setTimeout(r, 50))
    expect(completed).toBe(false)
    unlock()
    await deleting
    await granting
    expect(await db!.sr_user_subscription_period.count()).toBe(0)
    await repo.applyPaymentGrant(grant('missing', 999))
    expect(await db!.sr_user_subscription.count()).toBe(0)
    await repo.applyPaymentRefund(refund(500, 'deleted-audit'))
    expect(await db!.sr_payment_refund.count()).toBe(1)
  })

  test('review: integer refunds retain exactly 8640 minutes and state-before-grant survives', async () => {
    await repo.writePaymentState({ key: 'stripe:false::state:sub_1', provider: 'stripe', source: 'sub_1', userId: 7, autoRenew: false, version: 1, eventId: 'off' })
    await repo.applyPaymentGrant({ ...grant(), amount: 10, scope: 'stripe:false:' })
    expect((await repo.getUserSubscriptionInfo(7))!.auto_renew).toBe(false)
    await repo.applyPaymentRefund({ ...refund(8, 'partial'), total: 10 })
    expect((await db!.sr_user_subscription_period.findFirst())!.interval_count).toBe(8640)
    await repo.writePaymentState({ key: 'stripe:false::state:sub_1', provider: 'stripe', source: 'sub_1', userId: 7, autoRenew: true, version: 1, eventId: 'same-second-new' })
    expect((await repo.getUserSubscriptionInfo(7))!.auto_renew).toBe(true)
  })

  test('review: revoked future Apple B does not swallow valid C or override renewal OFF', async () => {
    const scope = 'apple:bundle:Production',
      now = Date.now(),
      day = 86400000
    const apple = (id: string, days: number) => ({
      ...grant(`${scope}:${id}`),
      scope,
      provider: 'apple' as const,
      amount: 0,
      at: new Date(now),
      nextInvoiceAt: new Date(now + days * day),
      appleTransactionId: id
    })
    await repo.writePaymentState({ key: `${scope}:state:sub_1`, provider: 'apple', source: 'sub_1', userId: 7, autoRenew: false, version: 1, eventId: 'off' })
    await repo.applyPaymentGrant(apple('a', 10))
    await repo.applyPaymentRefund({ ...refund(0, 'b', `${scope}:b`), provider: 'apple', total: 0, revoked: true })
    await repo.applyPaymentGrant(apple('b', 40))
    expect((await repo.getUserSubscriptionInfo(7))!.next_invoice_time.getTime()).toBe(now + 10 * day)
    await repo.applyPaymentGrant(apple('c', 30))
    expect((await repo.getUserSubscriptionInfo(7))!.next_invoice_time.getTime()).toBe(now + 30 * day)
    expect((await repo.getUserSubscriptionInfo(7))!.auto_renew).toBe(false)
    expect(await repo.hasActivePaymentGrant(`${scope}:b`, 7)).toBe(false)
    expect(await repo.hasActivePaymentGrant(`${scope}:c`, 7)).toBe(true)
    await repo.writePaymentState({ key: `${scope}:state:sub_1`, provider: 'apple', source: 'sub_1', userId: 7, autoRenew: true, version: 2, eventId: 'on' })
    const service = new SubscriptionAppleService({} as never, repo, {} as never, {} as never, {} as never)
    await (service as any).handleSubscriptionExpired(7, 'sub_1', { expiresDate: now + 10 * day })
    expect((await repo.getUserSubscriptionInfo(7))!.auto_renew).toBe(true)
  })

  test('review: bonus consumption cannot remove another paid grant when A is refunded', async () => {
    await repo.applyPaymentGrant(grant('paid:a'))
    await db!.sr_user_subscription_period.create({ data: { user_id: 7, type: 7, source: 'gift', interval: 'day', interval_count: 10, created_at: at } })
    await repo.upsertUserSubscription(7, 'cus_a')
    await repo.applyPaymentGrant({ ...grant('paid:b'), customerId: 'cus_a' })
    await repo.applyPaymentRefund(refund(1000, 'refund-a', 'paid:a'))
    expect((await repo.getUserSubscriptionInfo(7))!.subscription_end_time.toISOString()).toBe('2030-01-31T00:00:00.000Z')
    expect(await db!.sr_user_subscription_period.count({ where: { interval_count: { lt: 0 } } })).toBe(0)
  })

  test('review: command generations reuse pending work but allow a new completed action', async () => {
    const first = await repo.createPaymentCommand('stripe:false:acct:cancel:sub', { subscriptionId: 'sub' })
    expect(await repo.createPaymentCommand('stripe:false:acct:cancel:sub', { subscriptionId: 'sub' })).toBe(first)
    const token = await repo.claimPaymentJob(first)
    await repo.parkPaymentJob(first, 'stale', 'wrong-token')
    expect((await repo.getPaymentJob(first))!.status).toBe('running')
    await repo.finishPaymentJob(first, token!)
    expect(await repo.createPaymentCommand('stripe:false:acct:cancel:sub', { subscriptionId: 'sub' })).not.toBe(first)
  })

  test('review: signed invoice.paid and payment_succeeded both enter inbox and grant only once', async () => {
    await repo.upsertUserSubscription(7, 'cus_dual')
    const stripe = new Stripe('sk_test_local_only')
    const queue = vi.fn().mockResolvedValue(undefined)
    const service = new SubscriptionService((() => stripe) as never, repo, (() => ({ pushStripeEvent: queue })) as never)
    const invoice = {
      id: 'in_dual',
      billing_reason: 'subscription_cycle',
      customer: 'cus_dual',
      subscription: 'sub_dual',
      amount_paid: 1000,
      currency: 'usd',
      subscription_details: { metadata: { user_id: '7', platform: 'reader' } },
      lines: {
        has_more: false,
        data: [{ type: 'subscription', price: { recurring: { interval: 'day', interval_count: 30 } }, period: { start: at.getTime() / 1000, end: at.getTime() / 1000 + 2592000 } }]
      }
    }
    const ctx = { env: { STRIPE_CALLBACK_SECRET: 'whsec_local', STRIPE_LIVE_MODE: 'false', RUN_ENV: 'prod', RUN_TYPE: 'dev' } } as never
    for (const type of ['invoice.paid', 'invoice.payment_succeeded']) {
      const body = JSON.stringify({ id: `evt_${type}`, type, livemode: false, created: 1, data: { object: invoice } })
      const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_local' })
      await service.decryptCallbackEvent(ctx, body, signature)
    }
    expect(queue).toHaveBeenCalledTimes(2)
    const payments = new SubscriptionPaymentService((() => stripe) as never, repo)
    const orchestrator = new SubscriptionOrchestrator({} as never, service, repo, payments, {} as never)
    for (const [eventId] of queue.mock.calls) await orchestrator.processSubscription(ctx, { id: 'delivery', info: { eventId } })
    expect(await db!.sr_user_subscription_period.count()).toBe(1)
    const body = JSON.stringify({ id: 'evt_wrong_mode', type: 'invoice.paid', livemode: true, created: 1, data: { object: invoice } })
    await expect(service.decryptCallbackEvent(ctx, body, stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_local' }))).rejects.toBeDefined()
    expect(await db!.sr_stripe_event.count()).toBe(2)
  })

  test('Reader-only routing rejects foreign platform and unknown historical metadata', async () => {
    const payments = new SubscriptionPaymentService((() => ({})) as never, repo)
    for (const metadata of [{ platform: 'note', user_id: '7' }, { platform: 'reader', user_id: '7', collection_id: '1' }, { user_id: '7' }]) {
      await payments.handle('payment_intent.succeeded', { id: `pi_${JSON.stringify(metadata)}`, metadata, livemode: false })
    }
    expect(await db!.sr_user_subscription_period.count()).toBe(0)
    expect(await db!.sr_payment_job.count({ where: { status: 'reconciliation' } })).toBe(3)
  })

  test('Apple consumption failure stays in durable inbox and succeeds on retry without granting', async () => {
    const service = new SubscriptionAppleService({} as never, repo, {} as never, {} as never, {} as never)
    const key = 'apple:bundle:Production:notification:consume'
    await repo.enqueuePaymentJob(key, 'apple_event', {
      userId: 7,
      originalTransactionId: 'orig',
      productId: 'product',
      notificationType: 'CONSUMPTION_REQUEST',
      transactionInfo: { transactionId: 'tx', bundleId: 'bundle', environment: 'Production', appAccountToken: 'uuid' },
      environment: 'Production'
    })
    const send = vi
      .spyOn(service as any, 'sendConsumptionInformation')
      .mockRejectedValueOnce(new Error('Apple unavailable'))
      .mockResolvedValue(undefined)
    await expect(service.recoverAppleEvent({ RUN_TYPE: 'prod', APP_STORE_BUNDLE_ID: 'bundle' } as never, key)).rejects.toThrow('Apple unavailable')
    expect((await repo.getPaymentJob(key))!.status).toBe('pending')
    await service.recoverAppleEvent({ RUN_TYPE: 'prod', APP_STORE_BUNDLE_ID: 'bundle' } as never, key)
    expect(send.mock.calls[1][1]).toBe('tx')
    expect((await repo.getPaymentJob(key))!.status).toBe('done')
    expect(await db!.sr_user_subscription_period.count()).toBe(0)
  })

  test('analytics failure does not block logs or pending telemetry completion', async () => {
    const insertLog = vi.fn().mockResolvedValue(undefined)
    const { LogsService } = await import('@/domain/logs')
    const { GA4AnalyticsClient } = await import('@/infra/external/ga4Analytics')
    const env = { GA4_MEASUREMENT_ID: 'local', GA4_API_SECRET: 'test' } as Env
    const service = new SubscriptionTelemetryService(new LogsService({ insertLog } as never), repo, new GA4AnalyticsClient(env))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }))
    const payload = { userId: 7, provider: 'stripe', autoRenew: true, offer: false, subscriptionType: 'initial_subscription' }
    const orchestrator = new SubscriptionOrchestrator({} as never, {} as never, repo, {} as never, service)
    try {
      await repo.enqueuePaymentJob('telemetry:test', 'payment_telemetry', payload)
      await orchestrator.recover({ env } as never)
      await orchestrator.recover({ env } as never)
      expect((await repo.getPaymentJob('telemetry:test'))!.status).toBe('done')
      expect(insertLog).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(await db!.sr_payment_job.count({ where: { kind: 'telemetry_receipt' } })).toBe(0)
    } finally {
      fetchMock.mockRestore()
    }
  })

  test('leases recover after expiry and fencing rejects old completion', async () => {
    await repo.enqueuePaymentJob('job', 'stripe_cancel', { subscriptionId: 'sub_1' })
    const first = await repo.claimPaymentJob('job')
    expect(first).toBeTruthy()
    expect(await repo.claimPaymentJob('job')).toBeNull()
    await db!.sr_payment_job.update({ where: { key: 'job' }, data: { lease_until: new Date(0) } })
    const second = await repo.claimPaymentJob('job')
    await repo.finishPaymentJob('job', first!)
    expect((await repo.getPaymentJob('job'))!.status).toBe('running')
    await repo.finishPaymentJob('job', second!)
    expect((await repo.getPaymentJob('job'))!.status).toBe('done')
  })
})
