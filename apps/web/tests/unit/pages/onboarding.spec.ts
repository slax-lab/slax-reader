// pages/onboarding.vue 单测
import OnboardingPage from '~~/app/pages/onboarding.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
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

describe('pages/onboarding.vue', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockGetUserInfo.mockResolvedValue(baseUser)
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('无 onboarding 标记 → userInfo 就位后立即退回 /bookmarks', async () => {
    mountOnboardingPage()
    await flushPromises()
    expect(mockNavigateTo).toHaveBeenCalledWith('/bookmarks', { replace: true })
  })

  it('有 onboarding 标记 → 渲染 BookmarksOnboardingHero，不退回', async () => {
    localStorage.setItem(`slax_onboarding_pending_${baseUser.userId}`, 'true')
    const wrapper = mountOnboardingPage()
    await flushPromises()
    expect(wrapper.findComponent({ name: 'BookmarksOnboardingHero' }).exists()).toBe(true)
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('hero emit skip → 清标记 + 退回 /bookmarks', async () => {
    localStorage.setItem(`slax_onboarding_pending_${baseUser.userId}`, 'true')
    const wrapper = mountOnboardingPage()
    await flushPromises()
    mockNavigateTo.mockClear()
    const hero = wrapper.findComponent({ name: 'BookmarksOnboardingHero' })
    await hero.vm.$emit('skip')
    await flushPromises()
    expect(localStorage.getItem(`slax_onboarding_pending_${baseUser.userId}`)).toBeNull()
    expect(mockNavigateTo).toHaveBeenCalledWith('/bookmarks', { replace: true })
  })

  it('hero emit complete → 清标记 + 退回 /bookmarks', async () => {
    localStorage.setItem(`slax_onboarding_pending_${baseUser.userId}`, 'true')
    const wrapper = mountOnboardingPage()
    await flushPromises()
    mockNavigateTo.mockClear()
    const hero = wrapper.findComponent({ name: 'BookmarksOnboardingHero' })
    await hero.vm.$emit('complete')
    await flushPromises()
    expect(localStorage.getItem(`slax_onboarding_pending_${baseUser.userId}`)).toBeNull()
    expect(mockNavigateTo).toHaveBeenCalledWith('/bookmarks', { replace: true })
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
