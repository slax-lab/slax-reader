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

  describe('identity refreshed for the same account', () => {
    it('checks again after a generation bump left the decision pending', async () => {
      const subscription = gate()
      mocks.store.refreshServerUserInfo.mockResolvedValueOnce(undefined)
      await subscription.refreshSubscription()
      expect(subscription.subscriptionStatus.value).toBe('pending')
      mocks.store.refreshServerUserInfo.mockImplementationOnce(async () => {
        mocks.store.userInfo = makeUser({ subscription_end_at: '2099-01-01T00:00:00Z', subscription_type: 2 })
        mocks.account.context.value = { status: 'ready', serverUserId: 1, generation: 1, accountKey: 'account-a' }
      })
      mocks.account.context.value = { status: 'local', serverUserId: null, generation: 1, accountKey: 'account-a' }
      await nextTick()
      await vi.waitFor(() => expect(subscription.subscriptionStatus.value).toBe('active'))
      expect(mocks.store.refreshServerUserInfo).toHaveBeenCalledTimes(2)
    })

    it('reports an error with retry when the check after the bump fails', async () => {
      const subscription = gate()
      mocks.store.refreshServerUserInfo.mockRejectedValueOnce(new Error('offline'))
      mocks.account.context.value = { status: 'local', serverUserId: null, generation: 1, accountKey: 'account-a' }
      await nextTick()
      await vi.waitFor(() => expect(subscription.subscriptionStatus.value).toBe('error'))
    })

    it('does not loop when each failed check invalidates the identity again', async () => {
      // A failed profile read invalidates the server user, which bumps the generation for the same account.
      mocks.store.refreshServerUserInfo.mockImplementation(async () => {
        const context = mocks.account.context.value
        mocks.account.context.value = { ...context, status: 'local', serverUserId: null, generation: context.generation + 1 }
        throw new Error('offline')
      })
      const subscription = gate()
      await subscription.refreshSubscription()
      for (let i = 0; i < 20; i++) await nextTick()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(mocks.store.refreshServerUserInfo).toHaveBeenCalledOnce()
      await vi.waitFor(() => expect(subscription.subscriptionStatus.value).toBe('error'))
    })

    it('bounds follow-up checks when every check ends under a newer identity without a decision', async () => {
      mocks.store.refreshServerUserInfo.mockImplementation(async () => {
        const context = mocks.account.context.value
        mocks.account.context.value = { ...context, status: 'local', serverUserId: null, generation: context.generation + 1 }
      })
      const subscription = gate()
      await subscription.refreshSubscription()
      for (let i = 0; i < 20; i++) await nextTick()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(mocks.store.refreshServerUserInfo).toHaveBeenCalledTimes(3)
      expect(subscription.subscriptionStatus.value).toBe('error')
      await subscription.refreshSubscription()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(mocks.store.refreshServerUserInfo.mock.calls.length).toBeGreaterThan(3)
    })

    it('joins a check already running for the current identity', async () => {
      let resolve!: () => void
      mocks.store.refreshServerUserInfo.mockImplementation(() => new Promise<void>(r => { resolve = r }))
      mocks.account.context.value = { status: 'local', serverUserId: null, generation: 1, accountKey: 'account-a' }
      const subscription = gate()
      void subscription.refreshSubscription()
      mocks.account.context.value = { status: 'local', serverUserId: null, generation: 1, accountKey: 'account-a' }
      await nextTick()
      expect(mocks.store.refreshServerUserInfo).toHaveBeenCalledOnce()
      resolve()
    })

    it('keeps a confirmed profile without a new request', async () => {
      mocks.store.userInfo = makeUser({ subscription_end_at: '2099-01-01T00:00:00Z', subscription_type: 2 })
      mocks.account.context.value = { status: 'ready', serverUserId: 1, generation: 0, accountKey: 'account-a' }
      const subscription = gate()
      mocks.account.context.value = { status: 'ready', serverUserId: 1, generation: 1, accountKey: 'account-a' }
      await nextTick()
      expect(mocks.store.refreshServerUserInfo).not.toHaveBeenCalled()
      expect(subscription.subscriptionStatus.value).toBe('active')
    })

    it('starts no check after signing out', async () => {
      gate()
      mocks.store.isLogin = false
      mocks.account.context.value = { status: 'empty', serverUserId: null, generation: 1, accountKey: null }
      await nextTick()
      expect(mocks.store.refreshServerUserInfo).not.toHaveBeenCalled()
    })
  })
})
