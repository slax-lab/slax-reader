import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SubscriptionAppleService } from '@/domain/subscriptionApple'
import { AppleJWSVerifier } from '@/utils/iap/apple'
import { AutoRenewStatus, Environment, NotificationType, OfferType, TransactionType } from '@/const/iap/apple'
import type { JWSTransactionDecodedPayload, ResponseBodyV2DecodedPayload } from '@/const/iap/apple'
import { subscriptionInterval, subscriptionType } from '@/infra/repository/dbSubscription'
import type { subscriptionPeriod } from '@/infra/repository/dbSubscription'
import type { ContextManager } from '@/utils/context'

const now = Date.UTC(2026, 8, 18, 12)
const day = 86400000
const uuid = 'e35b267c-73bc-4f45-9adb-3a768207b8ef'
const bundleId = 'app.slax.reader'

function transaction(overrides: Partial<JWSTransactionDecodedPayload> = {}): JWSTransactionDecodedPayload {
  return {
    transactionId: 'transaction-1',
    originalTransactionId: 'original-1',
    bundleId,
    productId: 'slax.reader.monthly',
    purchaseDate: now - 20 * day,
    originalPurchaseDate: now - 20 * day,
    quantity: 1,
    type: TransactionType.AUTO_RENEWABLE_SUBSCRIPTION,
    appAccountToken: uuid,
    signedDate: now,
    environment: Environment.PRODUCTION,
    expiresDate: now + 10 * day,
    ...overrides
  }
}

function setup(runType = 'prod') {
  const user = { id: 7, uuid, deleted_at: null }
  const userRepo = { getUserInfo: vi.fn().mockResolvedValue(user), getUserByUuid: vi.fn().mockResolvedValue(user) }
  let periods: subscriptionPeriod[] = []
  const subscriptionRepo = {
    getUserSubscriptionInfo: vi.fn().mockResolvedValue(null),
    getUserSubscriptionPeriod: vi.fn().mockImplementation(async () => [...periods]),
    createAppleTransactionProcessed: vi.fn().mockResolvedValue(true),
    createUserSubscriptionRecordMany: vi.fn().mockImplementation(async (records: subscriptionPeriod[]) => periods.push(...records)),
    createReceiveActivityRecord: vi.fn().mockResolvedValue({}),
    upsertUserAppleSubscription: vi.fn().mockResolvedValue({}),
    createAppleIAPNotificationEvent: vi.fn().mockResolvedValue({}),
    hasActivePaymentGrant: vi.fn().mockResolvedValue(true),
    applyPaymentGrant: vi.fn().mockResolvedValue({}),
    applyPaymentRefund: vi.fn().mockResolvedValue({}),
    enqueuePaymentJob: vi.fn().mockImplementation(async (key, kind, payload) => {
      subscriptionRepo.getPaymentJob.mockResolvedValue({ key, kind, payload, status: 'pending' })
    }),
    getPaymentJob: vi.fn(),
    claimPaymentJob: vi.fn().mockResolvedValue('lease'),
    finishPaymentJob: vi.fn().mockResolvedValue(undefined),
    paymentTransaction: vi
      .fn()
      .mockImplementation(async (_userId, work) => work(subscriptionRepo, { sr_user_subscription: { updateMany: subscriptionRepo.upsertUserAppleSubscription } }))
  }
  const ga4Client = { trackEvent: vi.fn().mockResolvedValue(undefined) }
  const logsService = { track: vi.fn().mockResolvedValue(undefined) }
  const alertBot = { stripe: { pushMessage: vi.fn() } }
  const service = new SubscriptionAppleService(userRepo as never, subscriptionRepo as never, alertBot as never, ga4Client as never, logsService as never)
  const waitUntil = vi.fn()
  const ctx = { getUserId: () => 7, env: { RUN_TYPE: runType, RUN_ENV: 'prod', APP_STORE_BUNDLE_ID: bundleId }, execution: { waitUntil } } as unknown as ContextManager
  const verify = vi.spyOn(AppleJWSVerifier.prototype, 'verifyAndDecode')
  const assertNoSideEffects = () => {
    for (const [name, mock] of Object.entries(subscriptionRepo)) {
      if (!name.startsWith('get')) expect(mock, name).not.toHaveBeenCalled()
    }
    expect(ga4Client.trackEvent).not.toHaveBeenCalled()
    expect(logsService.track).not.toHaveBeenCalled()
    expect(alertBot.stripe.pushMessage).not.toHaveBeenCalled()
    expect(waitUntil).not.toHaveBeenCalled()
  }
  const notification = (tx = transaction(), type = NotificationType.DID_RENEW, overrides: Partial<ResponseBodyV2DecodedPayload> = {}) => {
    const payload: ResponseBodyV2DecodedPayload = {
      notificationType: type,
      notificationUUID: 'notification-1',
      version: '2.0',
      signedDate: now,
      data: { bundleId, environment: Environment.PRODUCTION, signedTransactionInfo: 'signed-transaction' },
      ...overrides
    }
    verify.mockResolvedValueOnce(payload).mockResolvedValueOnce(tx)
    return service.handleAppleIAPNotificationEvent(ctx, 'signed-notification')
  }
  return { service, ctx, verify, userRepo, subscriptionRepo, assertNoSideEffects, notification, setPeriods: (data: subscriptionPeriod[]) => (periods = data) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Apple receipt validation before entitlement writes', () => {
  test.each([
    ['wrong bundle', { bundleId: 'another.app' }],
    ['wrong environment', { environment: Environment.SANDBOX }],
    ['unknown product', { productId: 'another.subscription' }],
    ['offer ID is not a product', { productId: 'promotional_offer_1m' }],
    ['foreign account', { appAccountToken: 'another-user' }],
    ['missing account', { appAccountToken: undefined }],
    ['missing transaction', { transactionId: '' }],
    ['missing original transaction', { originalTransactionId: '' }],
    ['wrong transaction type', { type: TransactionType.CONSUMABLE }]
  ] as const)('%s has no side effects', async (_name, changes) => {
    const h = setup()
    h.verify.mockResolvedValue(transaction(changes))
    await expect(h.service.checkAppleIAPSubscription(h.ctx, 'slax.reader.monthly', uuid, 'signed')).rejects.toBeDefined()
    h.assertNoSideEffects()
  })

  test.each([
    ['wrong client order', 'slax.reader.monthly', 'different-order'],
    ['wrong client product', 'slax.reader.monthly.trial_1mo', uuid]
  ])('%s has no side effects', async (_name, product, order) => {
    const h = setup()
    h.verify.mockResolvedValue(transaction())
    await expect(h.service.checkAppleIAPSubscription(h.ctx, product, order, 'signed')).rejects.toBeDefined()
    h.assertNoSideEffects()
  })

  test.each([null, { id: 7, uuid, deleted_at: new Date(now) }])('rejects unavailable current user %j', async user => {
    const h = setup()
    h.userRepo.getUserInfo.mockResolvedValue(user)
    h.verify.mockResolvedValue(transaction())
    await expect(h.service.checkAppleIAPSubscription(h.ctx, 'slax.reader.monthly', uuid, 'signed')).rejects.toBeDefined()
    h.assertNoSideEffects()
  })

  test.each([
    ['expired', { expiresDate: now - 1 }],
    ['expiration boundary', { expiresDate: now }],
    ['missing expiration', { expiresDate: undefined }],
    ['invalid expiration', { expiresDate: NaN }],
    ['revoked', { revocationDate: now - 1 }],
    ['revocation reason', { revocationReason: 0 }],
    ['upgraded', { isUpgraded: true }],
    ['future purchase', { purchaseDate: now + day }],
    ['invalid purchase', { purchaseDate: NaN }]
  ] as const)('%s cannot grant access', async (_name, changes) => {
    const h = setup()
    h.verify.mockResolvedValue(transaction(changes))
    await expect(h.service.checkAppleIAPSubscription(h.ctx, 'slax.reader.monthly', uuid, 'signed')).resolves.toBe(false)
    h.assertNoSideEffects()
  })

  test('signature failure has no side effects', async () => {
    const h = setup()
    h.verify.mockRejectedValue(new Error('invalid signature'))
    await expect(h.service.checkAppleIAPSubscription(h.ctx, 'slax.reader.monthly', uuid, 'tampered')).rejects.toThrow('invalid signature')
    h.assertNoSideEffects()
  })

  test('the real verifier rejects an unsigned receipt without writes', async () => {
    const h = setup()
    h.verify.mockRestore()
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify(transaction())).toString('base64url')
    await expect(h.service.checkAppleIAPSubscription(h.ctx, 'slax.reader.monthly', uuid, `${header}.${payload}.`)).rejects.toThrow('Missing or invalid x5c')
    h.assertNoSideEffects()
  })

  test.each(['dev', 'beta'])('%s uses Sandbox despite RUN_ENV=prod', async runType => {
    const h = setup(runType)
    const tx = transaction({ environment: Environment.SANDBOX, productId: 'app.slax.reader.monthly' })
    h.verify.mockResolvedValue(tx)
    await expect(h.service.checkAppleIAPSubscription(h.ctx, tx.productId, uuid, 'signed')).resolves.toBe(true)
    expect(h.subscriptionRepo.applyPaymentGrant).toHaveBeenCalledWith(
      expect.objectContaining({ nextInvoiceAt: new Date(tx.expiresDate!), key: 'apple:app.slax.reader:Sandbox:transaction-1' })
    )
  })

  test.each(['dev', 'beta'])('%s rejects production transactions', async runType => {
    const h = setup(runType)
    h.verify.mockResolvedValue(transaction())
    await expect(h.service.checkAppleIAPSubscription(h.ctx, 'slax.reader.monthly', uuid, 'signed')).rejects.toBeDefined()
    h.assertNoSideEffects()
  })
})

describe('Apple notification boundaries', () => {
  test.each([
    ['outer bundle', { bundleId: 'another.app', environment: Environment.PRODUCTION }],
    ['outer environment', { bundleId, environment: Environment.SANDBOX }]
  ] as const)('rejects %s before any writes', async (_name, data) => {
    const h = setup()
    await expect(h.notification(transaction(), NotificationType.DID_RENEW, { data: { ...data, signedTransactionInfo: 'signed' } })).rejects.toBeDefined()
    h.assertNoSideEffects()
  })

  test.each([
    ['inner bundle', { bundleId: 'another.app' }],
    ['inner environment', { environment: Environment.SANDBOX }],
    ['inner product', { productId: 'another.subscription' }]
  ] as const)('rejects %s before any writes', async (_name, changes) => {
    const h = setup()
    await expect(h.notification(transaction(changes))).rejects.toBeDefined()
    h.assertNoSideEffects()
  })

  test('deleted user notification has no side effects', async () => {
    const h = setup()
    h.userRepo.getUserByUuid.mockResolvedValue({ id: 7, uuid, deleted_at: new Date(now) })
    await expect(h.notification()).rejects.toBeDefined()
    h.assertNoSideEffects()
  })

  test.each([{ expiresDate: now - 1 }, { revocationDate: now - 1 }])('inactive activation notification %j has no side effects', async changes => {
    const h = setup()
    await h.notification(transaction(changes))
    h.assertNoSideEffects()
  })

  test('renewal info must belong to the same transaction chain', async () => {
    const h = setup()
    h.verify
      .mockResolvedValueOnce({
        notificationType: NotificationType.DID_RENEW,
        data: { bundleId, environment: Environment.PRODUCTION, signedTransactionInfo: 'tx', signedRenewalInfo: 'renewal' }
      })
      .mockResolvedValueOnce(transaction())
      .mockResolvedValueOnce({
        originalTransactionId: 'another-original',
        productId: 'slax.reader.monthly',
        autoRenewProductId: 'slax.reader.monthly',
        environment: Environment.PRODUCTION,
        autoRenewStatus: AutoRenewStatus.ON
      })
    await expect(h.service.handleAppleIAPNotificationEvent(h.ctx, 'signed')).rejects.toBeDefined()
    h.assertNoSideEffects()
  })

  test('expired notifications still stop renewal', async () => {
    const h = setup()
    h.subscriptionRepo.getUserSubscriptionInfo.mockResolvedValue({
      apple_original_transaction_id: 'original-1',
      subscription_end_time: new Date(now - day),
      next_invoice_time: new Date(now - day)
    })
    await h.notification(transaction({ expiresDate: now - day }), NotificationType.EXPIRED)
    expect(h.subscriptionRepo.upsertUserAppleSubscription).toHaveBeenCalledWith(expect.objectContaining({ data: { auto_renew: false, subscribed: false } }))
    expect(h.subscriptionRepo.createAppleTransactionProcessed).not.toHaveBeenCalled()
  })

  test('refund notifications can process expired and revoked transactions', async () => {
    const h = setup()
    h.setPeriods([{ user_id: 7, type: subscriptionType.APPLE, source: 'original-1', interval: subscriptionInterval.DAY, interval_count: 10, created_at: new Date(now - 20 * day) }])
    await h.notification(transaction({ expiresDate: now - day, revocationDate: now }), NotificationType.REFUND)
    expect(h.subscriptionRepo.applyPaymentRefund).toHaveBeenCalledWith(expect.objectContaining({ key: 'apple:app.slax.reader:Production:transaction-1', revoked: true }))
    expect(h.subscriptionRepo.createUserSubscriptionRecordMany).not.toHaveBeenCalled()
  })
})

describe('Apple transactional entitlement delegation', () => {
  test('passes authoritative transaction windows and stable business key', async () => {
    const h = setup()
    h.verify.mockResolvedValue(transaction())
    await h.service.checkAppleIAPSubscription(h.ctx, 'slax.reader.monthly', uuid, 'signed')
    expect(h.subscriptionRepo.applyPaymentGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'apple:app.slax.reader:Production:transaction-1',
        at: new Date(now - 20 * day),
        nextInvoiceAt: new Date(now + 10 * day),
        appleTransactionId: 'transaction-1'
      })
    )
    expect(h.subscriptionRepo.createAppleTransactionProcessed).not.toHaveBeenCalled()
  })

  test.each([OfferType.INTRODUCTORY, OfferType.PROMOTIONAL])('offer %s consumes bonus in the grant transaction', async offerType => {
    const h = setup()
    h.verify.mockResolvedValue(transaction({ offerType }))
    await h.service.checkAppleIAPSubscription(h.ctx, 'slax.reader.monthly', uuid, 'signed')
    expect(h.subscriptionRepo.applyPaymentGrant).toHaveBeenCalledWith(expect.objectContaining({ consumeBonus: true }))
  })
})
