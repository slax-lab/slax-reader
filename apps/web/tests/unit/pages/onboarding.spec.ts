import OnboardingPage from '~~/app/pages/onboarding.vue'

// pages/onboarding.vue 单测
import { initialPromotionState } from '~~/app/utils/promotionFlow'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { useOnboardingPending } from '~~/app/composables/bookmark/useOnboardingPending'
import { baseUser } from '~~/tests/fixtures/user'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNavigateTo, mockGetUserInfo, mockUseI18n, mockUseHead, mockShowFeedbackModal } = vi.hoisted(() => {
  const mockT = vi.fn((key: string) => key)
  return {
    mockNavigateTo: vi.fn(() => Promise.resolve()),
    mockGetUserInfo: vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve(baseUser)),
    mockUseI18n: vi.fn(() => ({ locale: { value: 'en' }, t: mockT })),
    mockUseHead: vi.fn(),
    mockShowFeedbackModal: vi.fn()
  }
})

mockNuxtImport('useRoute', () => () => ({ path: '/onboarding', query: {} }))
mockNuxtImport('navigateTo', () => mockNavigateTo)
mockNuxtImport('useI18n', () => mockUseI18n)
mockNuxtImport('useHead', () => mockUseHead)

vi.mock('~/components/Modal', () => ({
  showFeedbackModal: mockShowFeedbackModal
}))

vi.mock('~/stores/user', () => ({
  useUserStore: () => ({
    userInfo: { ...baseUser },
    isSubscriptionExpired: false,
    getUserInfo: mockGetUserInfo
  })
}))

const stubs = {
  OnboardingTopBar: { name: 'OnboardingTopBar', template: '<div class="onboarding-topbar" />', emits: ['feedback'] },
  BookmarksOnboardingHero: { name: 'BookmarksOnboardingHero', template: '<div class="onboarding-hero" />', emits: ['skip', 'complete'] }
}

const mountOnboardingPage = () => mountWithApp(OnboardingPage, { global: { stubs } })

enableAutoUnmount(afterEach)

describe('pages/onboarding.vue', () => {
  beforeEach(() => {
    localStorage.clear()
    useState('onboarding-flags', () => ({})).value = {}
    useState('koc-promotion', initialPromotionState).value = { ...initialPromotionState(), userId: baseUser.userId, phase: 'idle', contextResolved: true }
    vi.clearAllMocks()
    mockNavigateTo.mockImplementation(() => Promise.resolve())
    mockGetUserInfo.mockResolvedValue(baseUser)
  })

  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('closes the real mobile hero and publishes dismissal before returning to the cached Inbox', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone)', platform: 'iPhone', maxTouchPoints: 1 })
    localStorage.setItem(`slax_onboarding_pending_${baseUser.userId}`, 'true')
    const wrapper = mountWithApp(OnboardingPage, { global: { stubs: { OnboardingTopBar: stubs.OnboardingTopBar } } })
    await flushPromises()
    expect(wrapper.find('.hero-mobile-close').exists()).toBe(true)
    mockNavigateTo.mockImplementation(() => {
      expect(localStorage.getItem(`slax_onboarding_dismissed_${baseUser.userId}`)).toBe('true')
      expect(localStorage.getItem(`slax_onboarding_pending_${baseUser.userId}`)).toBeNull()
      return Promise.resolve()
    })
    await wrapper.get('.hero-mobile-close').trigger('click')
    await flushPromises()
    expect(mockNavigateTo).toHaveBeenCalledWith({ path: '/', query: {} }, { replace: true })
    const observer = mountWithApp({ setup: () => useOnboardingPending(ref(baseUser.userId)), template: '<div>{{ isDismissed }}:{{ isPending }}</div>' })
    expect(observer.text()).toBe('true:false')
    observer.vm.setPending()
    await nextTick()
    expect(observer.text()).toBe('true:false')
  })

  it('allows mobile close without an account identity', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Android)', platform: 'Linux armv8l', maxTouchPoints: 5 })
    useState('koc-promotion', initialPromotionState).value = { ...initialPromotionState(), phase: 'idle', contextResolved: true }
    const wrapper = mountWithApp(OnboardingPage, { global: { stubs: { OnboardingTopBar: stubs.OnboardingTopBar } } })
    expect(wrapper.find('.hero-mobile-close').exists()).toBe(true)
    await wrapper.get('.hero-mobile-close').trigger('click')
    await flushPromises()
    expect(mockNavigateTo).toHaveBeenCalledWith({ path: '/', query: {} }, { replace: true })
    expect(localStorage.getItem(`slax_onboarding_dismissed_${baseUser.userId}`)).toBeNull()
  })

  it('无 onboarding 标记 → userInfo 就位后立即退回 /', async () => {
    mountOnboardingPage()
    await flushPromises()
    expect(mockNavigateTo).toHaveBeenCalledWith({ path: '/', query: {} }, { replace: true })
  })

  it('有 onboarding 标记 → 渲染 BookmarksOnboardingHero，不退回', async () => {
    localStorage.setItem(`slax_onboarding_pending_${baseUser.userId}`, 'true')
    const wrapper = mountOnboardingPage()
    await flushPromises()
    expect(wrapper.findComponent({ name: 'BookmarksOnboardingHero' }).exists()).toBe(true)
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('hero emit skip → 清标记 + 退回 /', async () => {
    localStorage.setItem(`slax_onboarding_pending_${baseUser.userId}`, 'true')
    const wrapper = mountOnboardingPage()
    await flushPromises()
    mockNavigateTo.mockClear()
    const hero = wrapper.findComponent({ name: 'BookmarksOnboardingHero' })
    await hero.vm.$emit('skip')
    await flushPromises()
    expect(localStorage.getItem(`slax_onboarding_pending_${baseUser.userId}`)).toBeNull()
    expect(mockNavigateTo).toHaveBeenCalledWith({ path: '/', query: {} }, { replace: true })
  })

  it('hero emit complete → 清标记 + 退回 /', async () => {
    localStorage.setItem(`slax_onboarding_pending_${baseUser.userId}`, 'true')
    const wrapper = mountOnboardingPage()
    await flushPromises()
    mockNavigateTo.mockClear()
    const hero = wrapper.findComponent({ name: 'BookmarksOnboardingHero' })
    await hero.vm.$emit('complete')
    await flushPromises()
    expect(localStorage.getItem(`slax_onboarding_pending_${baseUser.userId}`)).toBeNull()
    expect(mockNavigateTo).toHaveBeenCalledWith({ path: '/', query: {} }, { replace: true })
  })

  it('OnboardingTopBar emit feedback → showFeedbackModal 调用', async () => {
    localStorage.setItem(`slax_onboarding_pending_${baseUser.userId}`, 'true')
    const wrapper = mountOnboardingPage()
    await flushPromises()
    const topBar = wrapper.findComponent({ name: 'OnboardingTopBar' })
    await topBar.vm.$emit('feedback')
    await flushPromises()
    expect(mockShowFeedbackModal).toHaveBeenCalled()
  })
})
