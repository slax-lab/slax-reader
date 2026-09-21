// useBookmark — isClient=false 单元测试（独立文件）
// 因 ESM 本地绑定固化（lessons-learned §1），isClient 切换必须独立 spec + vi.doMock + vi.resetModules + 动态 import
// vi.hoisted 不能引用 imported ref（hoist 提升时 vue 模块未加载触发 TDZ），仅放 spy 句柄

import { ref } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'

const { mockHaveRequestToken, mockUseI18n, mockUseUserSubscribe, mockUseScroll, mockUseResize, mockShowLoginModal } = vi.hoisted(() => ({
  mockHaveRequestToken: vi.fn(() => false),
  mockUseI18n: vi.fn(() => ({ locale: { value: 'en' } })),
  mockUseUserSubscribe: vi.fn(),
  mockUseScroll: vi.fn(),
  mockUseResize: vi.fn(),
  mockShowLoginModal: vi.fn()
}))

mockNuxtImport('haveRequestToken', () => mockHaveRequestToken)
mockNuxtImport('useI18n', () => mockUseI18n)
mockNuxtImport('useUserSubscribe', () => mockUseUserSubscribe)
mockNuxtImport('useScroll', () => mockUseScroll)
mockNuxtImport('navigateTo', () => vi.fn())
mockNuxtImport('useRequestURL', () => () => ({ href: '/' }))
mockNuxtImport('useLogBookmark', () => vi.fn())
mockNuxtImport('logAnalyzed', () => vi.fn())
mockNuxtImport('logChat', () => vi.fn())
mockNuxtImport('showFeedbackView', () => vi.fn())

vi.mock('~~/app/composables/bookmark/useCommon', () => ({
  useResize: mockUseResize,
  useTracking: vi.fn(() => ({ tracking: { touchTrack: vi.fn(), wheelTrack: vi.fn() }, isLocked: ref(false) }))
}))

vi.mock('~/components/Modal', () => ({
  showLoginModal: mockShowLoginModal
}))

describe('useBookmark — isClient=false', () => {
  it('C2: non-client 路径 — useScroll 不被调用，y 走 ref(0) 兜底', async () => {
    // 修订 4：vi.resetModules + vi.doMock 必须在 setActivePinia 之前
    vi.resetModules()
    vi.doMock('@commons/utils/is', () => ({ isClient: false }))

    // ref() 调用必须放 it 内（vue 已 import）
    mockUseUserSubscribe.mockReturnValue({
      isSubscriptionExpired: ref(false),
      checkSubscriptionExpired: vi.fn(() => false),
      updateSubscribeStatus: vi.fn()
    })
    mockUseResize.mockReturnValue({
      resizeAnimated: ref(false),
      summariesExpanded: ref(false),
      botExpanded: ref(false),
      onResizeObserver: vi.fn(),
      contentXOffset: ref(0),
      isLocked: ref(false),
      isNeedResized: ref(false)
    })

    // 修订 4：reset 后用同一轮模块缓存的 pinia 设置 active 实例
    const { setActivePinia: resetSetActivePinia, createPinia: resetCreatePinia } = await import('pinia')
    resetSetActivePinia(resetCreatePinia())

    const { useBookmark } = await import('~~/app/composables/bookmark/useBookmark')

    const options = {
      detailLayout: ref({ isSmallScreen: vi.fn(() => false), contentWidth: vi.fn(() => 800) }) as any,
      summariesSidebar: ref({ contentWidth: vi.fn(() => 200) }) as any,
      botSidebar: ref({ contentWidth: vi.fn(() => 200) }) as any,
      bookmarkDetail: ref<HTMLDivElement | undefined>(undefined),
      chatbot: ref({ addQuoteData: vi.fn() }) as any,
      typeOptions: vi.fn(() => ({ type: 'normal' as const, bmId: 1000001 })),
      initialRequestTask: undefined,
      initialTasksCompleted: undefined
    } as unknown as Parameters<typeof useBookmark>[0]

    const result = useBookmark(options)
    // 主断言：non-client 路径 useScroll 未调用（走 ref(0) 兜底）
    expect(mockUseScroll).not.toHaveBeenCalled()
    // backToTop 不抛错（y.value=0 已是 0）
    expect(() => result.backToTop()).not.toThrow()
  })
})
