import { ref } from 'vue'

import { mountWithApp } from '../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// useSubscribeChecking is a fork-only composable (auto-import)
const { useSubscribeCheckingMock } = vi.hoisted(() => ({
  useSubscribeCheckingMock: vi.fn()
}))
mockNuxtImport('useSubscribeChecking', () => useSubscribeCheckingMock)

// request() for getInAppPurchaseData
const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(() => ({ get: vi.fn().mockResolvedValue(null) }))
}))
mockNuxtImport('request', () => requestMock)

// analyticsLog auto-import
const { analyticsLogMock } = vi.hoisted(() => ({ analyticsLogMock: vi.fn() }))
mockNuxtImport('analyticsLog', () => analyticsLogMock)

// showRedeemModal from PaymentModal/index.ts
vi.mock('~~/app/components/PaymentModal', () => ({
  showRedeemModal: vi.fn()
}))

// SubscriptionModal.showModal() — called by plan-cta--primary click
const { mockShowModal } = vi.hoisted(() => ({ mockShowModal: vi.fn() }))
vi.mock('~~/app/components/SubscriptionModal', () => ({ default: { showModal: mockShowModal } }))

const makeUserInfo = (overrides = {}) => ({
  id: 1,
  subscription: {
    first_subscription_at: null,
    subscription_end_at: null,
    subscription_homepage: ''
  },
  ...overrides
})

describe('UserSubscribeSection', () => {
  beforeEach(() => {
    requestMock.mockClear()
    analyticsLogMock.mockClear()
    useSubscribeCheckingMock.mockReturnValue({
      loadingTitle: ref('Processing'),
      isSubscribed: ref(false),
      isProcessing: ref(false)
    })
  })

  it('renders section title', async () => {
    const { default: UserSubscribeSection } = await import('~~/app/components/UserSubscribeSection.vue')
    const wrapper = mountWithApp(UserSubscribeSection, {
      props: { userInfo: makeUserInfo() }
    })
    expect(wrapper.find('section').exists()).toBe(true)
    expect(wrapper.find('.title').exists()).toBe(true)
  })

  it('shows processing spinner when isProcessing is true', async () => {
    useSubscribeCheckingMock.mockReturnValue({
      loadingTitle: ref('Processing...'),
      isSubscribed: ref(false),
      isProcessing: ref(true)
    })
    const { default: UserSubscribeSection } = await import('~~/app/components/UserSubscribeSection.vue')
    const wrapper = mountWithApp(UserSubscribeSection, {
      props: { userInfo: makeUserInfo() }
    })
    expect(wrapper.find('.processing').exists()).toBe(true)
    // 文案是 i18n 的 processing_notice，不是 loadingTitle
    expect(wrapper.find('.processing span').text()).toContain('Your order is being processed')
  })

  it('shows plan comparison when not subscribed (no statusData)', async () => {
    const getMock = vi.fn().mockResolvedValue(null)
    requestMock.mockReturnValue({ get: getMock })
    const { default: UserSubscribeSection } = await import('~~/app/components/UserSubscribeSection.vue')
    const wrapper = mountWithApp(UserSubscribeSection, {
      props: { userInfo: makeUserInfo() }
    })
    await flushPromises()
    // statusData is null → isPro is false → .plan-comparison rendered
    expect(wrapper.find('.plan-comparison').exists()).toBe(true)
    expect(wrapper.find('.plan-cta--primary').exists()).toBe(true)
  })

  it('clicking plan-cta--primary calls SubscriptionModal.showModal()', async () => {
    mockShowModal.mockClear()
    const getMock = vi.fn().mockResolvedValue(null)
    requestMock.mockReturnValue({ get: getMock })
    const { default: UserSubscribeSection } = await import('~~/app/components/UserSubscribeSection.vue')
    const wrapper = mountWithApp(UserSubscribeSection, {
      props: { userInfo: makeUserInfo() }
    })
    await flushPromises()
    await wrapper.find('.plan-cta--primary').trigger('click')
    expect(mockShowModal).toHaveBeenCalled()
  })

  it('calls analyticsLog on mount when not subscribed', async () => {
    const { default: UserSubscribeSection } = await import('~~/app/components/UserSubscribeSection.vue')
    mountWithApp(UserSubscribeSection, {
      props: { userInfo: makeUserInfo() }
    })
    expect(analyticsLogMock).toHaveBeenCalledWith({ event: 'subscription_view', presentation: 'screen' })
  })

  it('shows subscripted-status when isPro (stripe subscription)', async () => {
    const getMock = vi.fn().mockResolvedValue({
      subscription: { type: 'stripe', end_time: '2027-01-01T00:00:00Z' }
    })
    requestMock.mockReturnValue({ get: getMock })
    const { default: UserSubscribeSection } = await import('~~/app/components/UserSubscribeSection.vue')
    const wrapper = mountWithApp(UserSubscribeSection, {
      props: {
        userInfo: makeUserInfo({
          subscription: { first_subscription_at: '2026-01-01T00:00:00Z', subscription_end_at: null, subscription_homepage: '' }
        })
      }
    })
    await flushPromises()
    expect(wrapper.find('.subscripted-status').exists()).toBe(true)
    expect(wrapper.find('.plan-comparison').exists()).toBe(false)
  })

  it('analyticsLog 在 mount 时调用一次（isPro 变为 true 后不再重复调用）', async () => {
    analyticsLogMock.mockClear()
    const getMock = vi.fn().mockResolvedValue({
      subscription: { type: 'stripe', end_time: '2027-01-01T00:00:00Z' }
    })
    requestMock.mockReturnValue({ get: getMock })
    const { default: UserSubscribeSection } = await import('~~/app/components/UserSubscribeSection.vue')
    mountWithApp(UserSubscribeSection, {
      props: { userInfo: makeUserInfo() }
    })
    // analyticsLog called once at mount (isPro=false at that point)
    expect(analyticsLogMock).toHaveBeenCalledTimes(1)
    await flushPromises()
    // after getInAppPurchaseData resolves (isPro=true), no additional analyticsLog call
    expect(analyticsLogMock).toHaveBeenCalledTimes(1)
  })

  it('showRedeem calls showRedeemModal', async () => {
    const { showRedeemModal } = await import('~~/app/components/PaymentModal')
    vi.mocked(showRedeemModal).mockClear()
    const { default: UserSubscribeSection } = await import('~~/app/components/UserSubscribeSection.vue')
    const wrapper = mountWithApp(UserSubscribeSection, {
      props: { userInfo: makeUserInfo() }
    })
    await flushPromises()
    // showRedeem is triggered by the redeem button (v-if="!isPro || isStripe")
    const vm = wrapper.vm as any
    vm.showRedeem()
    expect(showRedeemModal).toHaveBeenCalled()
  })
})
