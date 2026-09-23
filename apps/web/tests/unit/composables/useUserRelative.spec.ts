import { describe, expect, it, vi } from 'vitest'

vi.mock('~~/app/components/SubscriptionModal', () => ({
  default: { showModal: vi.fn() }
}))

describe('useUserRelative (useUserSubscribe)', () => {
  it('isSubscriptionExpired defaults to true', async () => {
    const { useUserSubscribe } = await import('~~/app/composables/useUserRelative')
    const { isSubscriptionExpired } = useUserSubscribe()
    expect(isSubscriptionExpired.value).toBe(true)
  })

  it('checkSubscriptionExpired calls showModal and returns true when expired', async () => {
    const SubscriptionModal = (await import('~~/app/components/SubscriptionModal')).default
    const { useUserSubscribe } = await import('~~/app/composables/useUserRelative')
    const { isSubscriptionExpired, checkSubscriptionExpired } = useUserSubscribe()
    isSubscriptionExpired.value = true
    const result = checkSubscriptionExpired()
    expect(result).toBe(true)
    expect(SubscriptionModal.showModal).toHaveBeenCalled()
  })

  it('checkSubscriptionExpired returns false when not expired', async () => {
    const { useUserSubscribe } = await import('~~/app/composables/useUserRelative')
    const { isSubscriptionExpired, checkSubscriptionExpired } = useUserSubscribe()
    isSubscriptionExpired.value = false
    const result = checkSubscriptionExpired()
    expect(result).toBe(false)
  })

  it('updateSubscribeStatus sets expired=true for user with no subscription', async () => {
    const { useUserSubscribe } = await import('~~/app/composables/useUserRelative')
    const { isSubscriptionExpired, updateSubscribeStatus } = useUserSubscribe()
    // user with no subscription data → checkUserSubscribedIsExpired returns true
    updateSubscribeStatus({ subscribe: null } as any)
    expect(isSubscriptionExpired.value).toBe(true)
  })
})
