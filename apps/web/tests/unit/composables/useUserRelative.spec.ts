import { effectScope, nextTick, reactive, ref } from 'vue'

import { makeUser } from '~~/tests/fixtures/user'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ showModal: vi.fn(), store: {} as any, account: {} as any }))
vi.mock('~/components/SubscriptionModal', () => ({ default: { showModal: mocks.showModal } }))
vi.mock('~/stores/user', () => ({ useUserStore: () => mocks.store }))
vi.mock('~/composables/useAccountContext', () => ({ useAccountContext: () => mocks.account }))
import { useUserSubscribe } from '~~/app/composables/useUserRelative'

const scopes: ReturnType<typeof effectScope>[] = []
const gate = () => {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => useUserSubscribe())!
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.store = reactive({ userInfo: null, isLogin: true, refreshServerUserInfo: vi.fn() })
  mocks.account = { context: ref({ status: 'local', serverUserId: null, generation: 0, accountKey: 'account-a' }) }
})
afterEach(() => scopes.splice(0).forEach(scope => scope.stop()))

describe('reader subscription startup', () => {
  it('does not present an upgrade prompt for an unresolved subscription', () => {
    const subscription = gate()
    subscription.checkSubscriptionExpired()
    expect(mocks.showModal).not.toHaveBeenCalled()
  })

  it('does not default a confirmed current-account subscriber to expired', () => {
    mocks.store.userInfo = makeUser({ subscription_end_at: '2099-01-01T00:00:00Z', subscription_type: 2 })
    mocks.account.context.value = { status: 'ready', serverUserId: 1, generation: 0, accountKey: 'account-a' }
    const subscription = gate()
    expect(subscription.isSubscriptionExpired.value).toBe(false)
    expect(subscription.checkSubscriptionExpired()).toBe(false)
    expect(mocks.showModal).not.toHaveBeenCalled()
  })

  it('keeps real expired subscriptions behind the upgrade flow', () => {
    mocks.store.userInfo = makeUser({ subscription_end_at: '2000-01-01T00:00:00Z', subscription_type: 2 })
    mocks.account.context.value = { status: 'ready', serverUserId: 1, generation: 0, accountKey: 'account-a' }
    const subscription = gate()
    expect(subscription.checkSubscriptionExpired()).toBe(true)
    expect(mocks.showModal).toHaveBeenCalledOnce()
  })

  it('reacts to profile arrival through another existing request path', async () => {
    const subscription = gate()
    mocks.store.userInfo = makeUser({ subscription_end_at: '2099-01-01T00:00:00Z', subscription_type: 2 })
    mocks.account.context.value = { status: 'ready', serverUserId: 1, generation: 0, accountKey: 'account-a' }
    await nextTick()
    expect(subscription.subscriptionStatus.value).toBe('active')
  })

  it('coalesces repeated checks and adopts the verified response', async () => {
    let resolve!: () => void
    mocks.store.refreshServerUserInfo.mockImplementation(() => new Promise<void>(r => { resolve = r }))
    const subscription = gate()
    const first = subscription.refreshSubscription()
    const second = subscription.refreshSubscription()
    expect(subscription.subscriptionStatus.value).toBe('pending')
    expect(mocks.store.refreshServerUserInfo).toHaveBeenCalledTimes(1)
    mocks.store.userInfo = makeUser({ subscription_end_at: '2099-01-01T00:00:00Z', subscription_type: 2 })
    mocks.account.context.value = { status: 'ready', serverUserId: 1, generation: 0, accountKey: 'account-a' }
    resolve()
    await Promise.all([first, second])
    expect(subscription.subscriptionStatus.value).toBe('active')
  })

  it('reports network failure as an error and permits an explicit retry', async () => {
    mocks.store.refreshServerUserInfo.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    const subscription = gate()
    await subscription.refreshSubscription()
    expect(subscription.subscriptionStatus.value).toBe('error')
    subscription.checkSubscriptionExpired()
    expect(mocks.showModal).not.toHaveBeenCalled()
    const retry = subscription.refreshSubscription()
    expect(subscription.subscriptionStatus.value).toBe('pending')
    mocks.store.userInfo = makeUser({ subscription_end_at: '2099-01-01T00:00:00Z', subscription_type: 2 })
    mocks.account.context.value = { status: 'ready', serverUserId: 1, generation: 0, accountKey: 'account-a' }
    await retry
    expect(subscription.subscriptionStatus.value).toBe('active')
  })

  it('keeps a same-account failure visible after identity invalidation', async () => {
    mocks.store.refreshServerUserInfo.mockImplementation(async () => {
      mocks.account.context.value = { status: 'local', serverUserId: null, generation: 1, accountKey: 'account-a' }
      throw new Error('offline')
    })
    const subscription = gate()
    await subscription.refreshSubscription()
    expect(subscription.subscriptionStatus.value).toBe('error')
  })

  it('does not attach an old account request failure to a new account', async () => {
    let reject!: (error: Error) => void
    mocks.store.refreshServerUserInfo.mockImplementationOnce(() => new Promise((_, r) => { reject = r }))
    const subscription = gate()
    const pending = subscription.refreshSubscription()
    mocks.account.context.value = { status: 'local', serverUserId: null, generation: 1, accountKey: 'account-b' }
    reject(new Error('old request'))
    await pending
    expect(subscription.subscriptionStatus.value).toBe('pending')
  })

  it('applies confirmed expiry and clears access on account invalidation', () => {
    mocks.store.userInfo = makeUser({ subscription_end_at: '2099-01-01T00:00:00Z', subscription_type: 2 })
    mocks.account.context.value = { status: 'ready', serverUserId: 1, generation: 0, accountKey: 'account-a' }
    const subscription = gate()
    expect(subscription.subscriptionStatus.value).toBe('active')
    mocks.store.userInfo = makeUser({ subscription_end_at: '2000-01-01T00:00:00Z', subscription_type: 2 })
    expect(subscription.subscriptionStatus.value).toBe('inactive')
    mocks.account.context.value = { status: 'local', serverUserId: null, generation: 1, accountKey: 'account-b' }
    expect(subscription.subscriptionStatus.value).toBe('pending')
  })

  it('does not coalesce a new account into an old pending request during incremental context updates', async () => {
    let finishOld!: () => void
    mocks.store.refreshServerUserInfo.mockImplementationOnce(() => new Promise<void>(resolve => { finishOld = resolve }))
    const subscription = gate()
    const old = subscription.refreshSubscription()
    mocks.account.context.value.accountKey = 'account-b'
    mocks.account.context.value.serverUserId = null
    mocks.account.context.value.generation++
    await nextTick()
    expect(mocks.store.refreshServerUserInfo).toHaveBeenCalledTimes(2)
    finishOld()
    await old
    expect(subscription.subscriptionStatus.value).toBe('pending')
  })

  it('starts a fresh verified check when the signed-in account changes', async () => {
    const subscription = gate()
    mocks.store.refreshServerUserInfo.mockImplementation(async () => {
      mocks.store.userInfo = makeUser({ userId: 2, subscription_end_at: '2000-01-01T00:00:00Z', subscription_type: 2 })
      mocks.account.context.value = { status: 'ready', serverUserId: 2, generation: 1, accountKey: 'account-b' }
    })
    mocks.account.context.value = { status: 'local', serverUserId: null, generation: 1, accountKey: 'account-b' }
    await nextTick()
    expect(mocks.store.refreshServerUserInfo).toHaveBeenCalledOnce()
    expect(subscription.subscriptionStatus.value).toBe('inactive')
    expect(mocks.showModal).not.toHaveBeenCalled()
  })

  it('does not trust a persisted subscriber from an unverified account', () => {
    mocks.store.userInfo = makeUser({ subscription_end_at: '2099-01-01T00:00:00Z', subscription_type: 2 })
    expect(gate().isSubscriptionExpired.value).toBe(true)
  })
})
