// useBookmark composable 单元测试 — 主 spec（isClient=true 路径）
// auto-import 走 mockNuxtImport；显式 import（useResize / showLoginModal）走 vi.mock
// useUserStore 用真实 Pinia + setActivePinia + spyOn 局部替换
// 注意：isClient=false 路径在 useBookmark.non-client.spec.ts 测，因 ESM 本地绑定固化（lessons-learned §1）

import { nextTick, ref } from 'vue'

import type { UserInfo } from '@commons/contracts/interface'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { baseUser } from '~~/tests/fixtures/user'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// === vi.hoisted spy 句柄（lessons §1 / §13）===
const {
  mockNavigateTo,
  mockUseScroll,
  mockUseRequestURL,
  mockUseUserSubscribe,
  mockShowFeedbackView,
  mockUseLogBookmark,
  mockLogAnalyzed,
  mockLogChat,
  mockShowLoginModal,
  mockUseResize,
  mockHaveRequestToken,
  mockUseI18n,
  mockCheckSubscriptionExpired,
  mockUpdateSubscribeStatus,
  yRef,
  summariesExpanded,
  botExpanded,
  isLocked
} = vi.hoisted(() => {
  return {
    mockNavigateTo: vi.fn(),
    mockUseScroll: vi.fn(),
    mockUseRequestURL: vi.fn(() => ({ href: 'https://example.com/test' })),
    mockUseUserSubscribe: vi.fn(),
    mockShowFeedbackView: vi.fn(),
    mockUseLogBookmark: vi.fn(),
    mockLogAnalyzed: vi.fn(),
    mockLogChat: vi.fn(),
    mockShowLoginModal: vi.fn(),
    mockUseResize: vi.fn(),
    mockHaveRequestToken: vi.fn(() => false),
    mockUseI18n: vi.fn(() => ({ locale: { value: 'en' } })),
    mockCheckSubscriptionExpired: vi.fn(() => false),
    mockUpdateSubscribeStatus: vi.fn(),
    yRef: { value: 0 } as { value: number },
    summariesExpanded: { value: false } as { value: boolean },
    botExpanded: { value: false } as { value: boolean },
    isLocked: { value: false } as { value: boolean }
  }
})

mockNuxtImport('navigateTo', () => mockNavigateTo)
mockNuxtImport('useScroll', () => mockUseScroll)
mockNuxtImport('useRequestURL', () => mockUseRequestURL)
mockNuxtImport('useUserSubscribe', () => mockUseUserSubscribe)
mockNuxtImport('showFeedbackView', () => mockShowFeedbackView)
mockNuxtImport('useLogBookmark', () => mockUseLogBookmark)
mockNuxtImport('logAnalyzed', () => mockLogAnalyzed)
mockNuxtImport('logChat', () => mockLogChat)
mockNuxtImport('haveRequestToken', () => mockHaveRequestToken)
mockNuxtImport('useI18n', () => mockUseI18n)

vi.mock('~/components/Modal', () => ({
  showLoginModal: mockShowLoginModal
}))

// useResize stub（避开 useTracking / DOM 测量 / debounce）— 路径首选 ~~（dweb tsconfig alias）
vi.mock('~~/app/composables/bookmark/useCommon', () => ({
  useResize: mockUseResize,
  useTracking: vi.fn(() => ({ tracking: { touchTrack: vi.fn(), wheelTrack: vi.fn() }, isLocked }))
}))

// 注意：useUserStore 必须先于 useBookmark import（合并 upstream 后暴露的 vite/nuxt auto-import
// 时序坑：useBookmark.ts 内部先 import Modal 再 import stores/user；若测试文件的静态 import 顺序
// 反过来，Modal 链上真实 .vue SFC 的 <script setup> 编译会先于 stores/user.ts 触发 unplugin-auto-import
// 重新扫描，导致 stores/user.ts 里 `haveRequestToken()` 自动导入解析到与 mockNuxtImport 拦截目标不同的
// 绑定实例，getter 读到真实实现而非 mock，spy 断言全部落空。
// eslint-disable-next-line simple-import-sort/imports -- 顺序不可由 import-sort 自动重排，见上注释
import { useUserStore } from '~~/app/stores/user'
import { useBookmark } from '~~/app/composables/bookmark/useBookmark'

const makeOptions = () =>
  ({
    detailLayout: ref({ isSmallScreen: vi.fn(() => false), contentWidth: vi.fn(() => 800) }) as any,
    summariesSidebar: ref({ contentWidth: vi.fn(() => 200) }) as any,
    botSidebar: ref({ contentWidth: vi.fn(() => 200) }) as any,
    bookmarkDetail: ref<HTMLDivElement | undefined>(undefined),
    chatbot: ref({ addQuoteData: vi.fn() }) as any,
    typeOptions: vi.fn(() => ({ type: 'normal' as const, bmId: 1000001 })),
    initialRequestTask: undefined as (() => Promise<void>) | undefined,
    initialTasksCompleted: undefined as (() => void) | undefined
  }) as unknown as Parameters<typeof useBookmark>[0]

describe('useBookmark', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    yRef.value = 0
    summariesExpanded.value = false
    botExpanded.value = false
    isLocked.value = false
    mockUseScroll.mockReturnValue({ y: yRef })
    mockHaveRequestToken.mockReturnValue(false)
    mockUseUserSubscribe.mockReturnValue({
      isSubscriptionExpired: ref(false),
      checkSubscriptionExpired: mockCheckSubscriptionExpired,
      updateSubscribeStatus: mockUpdateSubscribeStatus
    })
    mockCheckSubscriptionExpired.mockReturnValue(false)
    mockUseResize.mockReturnValue({
      resizeAnimated: ref(false),
      summariesExpanded,
      botExpanded,
      onResizeObserver: vi.fn(),
      contentXOffset: ref(0),
      isLocked,
      isNeedResized: ref(false)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('初始化（C1, C3-C4）', () => {
    it('C1: 客户端路径 — useScroll(window) 调用，返回 19 字段', () => {
      const result = useBookmark(makeOptions())
      expect(mockUseScroll).toHaveBeenCalled()
      const expectedKeys = [
        'user',
        'isSubscriptionExpired',
        'redirectHref',
        'resizeAnimated',
        'summariesExpanded',
        'botExpanded',
        'contentXOffset',
        'isNeedResized',
        'onResizeObserver',
        'showAnalyzed',
        'showChatbot',
        'chatBotQuote',
        'showFeedback',
        'backToTop',
        'loginVerify',
        'screenLockUpdate',
        'navigateToNotification',
        'navigateToBookmarks',
        'navigateToText'
      ]
      expectedKeys.forEach(key => expect(result).toHaveProperty(key))
    })

    it('C3: 已登录 — userInfo=baseUser → user.value=baseUser；redirectHref 来自 useRequestURL', () => {
      const store = useUserStore()
      store.user = baseUser
      const result = useBookmark(makeOptions())
      expect(result.user.value).toEqual(baseUser)
      expect(result.redirectHref).toBe('https://example.com/test')
    })

    it('C4: 未登录 — userInfo=null → user.value=null', () => {
      const result = useBookmark(makeOptions())
      expect(result.user.value).toBeNull()
    })
  })

  describe('loginVerify（C24-C25）', () => {
    it('C24: user 存在 → return true，不调 showLoginModal', () => {
      const store = useUserStore()
      store.user = baseUser
      const result = useBookmark(makeOptions())
      expect(result.loginVerify()).toBe(true)
      expect(mockShowLoginModal).not.toHaveBeenCalled()
    })

    it('C25: user=null → 调 showLoginModal({redirect}) 后 return false', () => {
      const result = useBookmark(makeOptions())
      expect(result.loginVerify()).toBe(false)
      expect(mockShowLoginModal).toHaveBeenCalledWith({ redirect: 'https://example.com/test' })
    })
  })

  describe('showFeedback（C5）', () => {
    it('C5: 默认 feedbackType="parse_error" → 调 showFeedbackView(options, "parse_error")', () => {
      const options = makeOptions()
      const typeOpts = { type: 'normal' as const, bmId: 1000001 }
      ;(options.typeOptions as ReturnType<typeof vi.fn>).mockReturnValue(typeOpts)
      const result = useBookmark(options)
      result.showFeedback()
      expect(mockShowFeedbackView).toHaveBeenCalledWith(typeOpts, 'parse_error')
    })
  })

  describe('showAnalyzed 4 分支（C6-C9）', () => {
    it('C6: 未登录 → 早退，summariesExpanded 不变，logAnalyzed 不调', () => {
      const result = useBookmark(makeOptions())
      result.showAnalyzed()
      expect(summariesExpanded.value).toBe(false)
      expect(mockLogAnalyzed).not.toHaveBeenCalled()
    })

    it('C7: 订阅过期 → 早退', () => {
      const store = useUserStore()
      store.user = baseUser
      mockCheckSubscriptionExpired.mockReturnValue(true)
      const result = useBookmark(makeOptions())
      result.showAnalyzed()
      expect(summariesExpanded.value).toBe(false)
      expect(mockLogAnalyzed).not.toHaveBeenCalled()
    })

    it('C8: 登录 + 订阅有效 + 展开 → botExpanded=false + summariesExpanded=true + logAnalyzed', () => {
      const store = useUserStore()
      store.user = baseUser
      botExpanded.value = true
      const result = useBookmark(makeOptions())
      result.showAnalyzed()
      expect(botExpanded.value).toBe(false)
      expect(summariesExpanded.value).toBe(true)
      expect(mockLogAnalyzed).toHaveBeenCalled()
    })

    it('C9: 登录 + 订阅有效 + 关闭路径 → summariesExpanded=false 但不调 logAnalyzed', () => {
      const store = useUserStore()
      store.user = baseUser
      summariesExpanded.value = true
      const result = useBookmark(makeOptions())
      result.showAnalyzed()
      expect(summariesExpanded.value).toBe(false)
      expect(mockLogAnalyzed).not.toHaveBeenCalled()
    })
  })

  describe('showChatbot 4 分支（C10-C13）', () => {
    it('C10: 未登录 → 早退', () => {
      const result = useBookmark(makeOptions())
      result.showChatbot()
      expect(botExpanded.value).toBe(false)
      expect(mockLogChat).not.toHaveBeenCalled()
    })

    it('C11: 订阅过期 → 早退', () => {
      const store = useUserStore()
      store.user = baseUser
      mockCheckSubscriptionExpired.mockReturnValue(true)
      const result = useBookmark(makeOptions())
      result.showChatbot()
      expect(botExpanded.value).toBe(false)
      expect(mockLogChat).not.toHaveBeenCalled()
    })

    it('C12: 登录 + 订阅有效 + 展开 → summariesExpanded=false + botExpanded=true + logChat', () => {
      const store = useUserStore()
      store.user = baseUser
      summariesExpanded.value = true
      const result = useBookmark(makeOptions())
      result.showChatbot()
      expect(summariesExpanded.value).toBe(false)
      expect(botExpanded.value).toBe(true)
      expect(mockLogChat).toHaveBeenCalled()
    })

    it('C13: 登录 + 订阅有效 + 关闭路径 → botExpanded=false 但不调 logChat', () => {
      const store = useUserStore()
      store.user = baseUser
      botExpanded.value = true
      const result = useBookmark(makeOptions())
      result.showChatbot()
      expect(botExpanded.value).toBe(false)
      expect(mockLogChat).not.toHaveBeenCalled()
    })
  })

  describe('chatBotQuote（C14-C17）', () => {
    it('C14: 未登录 → 早退，addQuoteData 不调', async () => {
      const options = makeOptions()
      const result = useBookmark(options)
      result.chatBotQuote({ text: 'q' } as any)
      await nextTick()
      expect(options.chatbot!.value!.addQuoteData).not.toHaveBeenCalled()
    })

    it('C15: 订阅过期 → 早退', async () => {
      const store = useUserStore()
      store.user = baseUser
      mockCheckSubscriptionExpired.mockReturnValue(true)
      const options = makeOptions()
      const result = useBookmark(options)
      result.chatBotQuote({ text: 'q' } as any)
      await nextTick()
      expect(options.chatbot!.value!.addQuoteData).not.toHaveBeenCalled()
    })

    it('C16: 通过 + botExpanded=false → 设 true → addQuoteData 被调', async () => {
      const store = useUserStore()
      store.user = baseUser
      const options = makeOptions()
      const result = useBookmark(options)
      const data = { text: 'quote' } as any
      result.chatBotQuote(data)
      await nextTick()
      expect(botExpanded.value).toBe(true)
      expect(options.chatbot!.value!.addQuoteData).toHaveBeenCalledWith(data)
    })

    it('C17: 通过 + chatbot.value=undefined → addQuoteData 不调（合并已展开 + chatbot undefined 分支）', async () => {
      const store = useUserStore()
      store.user = baseUser
      botExpanded.value = true
      const options = makeOptions()
      options.chatbot = ref(undefined) as any
      const result = useBookmark(options)
      result.chatBotQuote({ text: 'q' } as any)
      await nextTick()
      expect(botExpanded.value).toBe(true)
    })
  })

  describe('navigate 系列（C18-C21）', () => {
    it('C18: navigateToBookmarks → navigateTo("/bookmarks", { replace: true })', () => {
      const result = useBookmark(makeOptions())
      result.navigateToBookmarks()
      expect(mockNavigateTo).toHaveBeenCalledWith('/bookmarks', { replace: true })
    })

    it('C19: navigateToText 小屏 → summariesExpanded=false', () => {
      summariesExpanded.value = true
      const options = makeOptions()
      options.detailLayout!.value!.isSmallScreen = vi.fn(() => true) as any
      const result = useBookmark(options)
      result.navigateToText()
      expect(summariesExpanded.value).toBe(false)
    })

    it('C20: navigateToText 大屏 → summariesExpanded 不变', () => {
      summariesExpanded.value = true
      const result = useBookmark(makeOptions())
      result.navigateToText()
      expect(summariesExpanded.value).toBe(true)
    })

    it('C21: navigateToNotification → navigateTo("/bookmarks?filter=notifications", {})', () => {
      const result = useBookmark(makeOptions())
      result.navigateToNotification()
      expect(mockNavigateTo).toHaveBeenCalledWith('/bookmarks?filter=notifications', {})
    })
  })

  describe('副作用（C22-C23）', () => {
    it('C22: screenLockUpdate(true) → isLocked=true', () => {
      const result = useBookmark(makeOptions())
      result.screenLockUpdate(true)
      expect(isLocked.value).toBe(true)
      result.screenLockUpdate(false)
      expect(isLocked.value).toBe(false)
    })

    it('C23: backToTop → y.value=0', () => {
      yRef.value = 500
      const result = useBookmark(makeOptions())
      result.backToTop()
      expect(yRef.value).toBe(0)
    })
  })

  describe('初始化任务（C26-C29）', () => {
    it('C26: isLogin=false → getUserInfo 不调', async () => {
      mockHaveRequestToken.mockReturnValue(false)
      const store = useUserStore()
      const spy = vi.spyOn(store, 'getUserInfo').mockResolvedValue(undefined as unknown as UserInfo)
      useBookmark(makeOptions())
      await Promise.resolve()
      await Promise.resolve()
      expect(spy).not.toHaveBeenCalled()
    })

    it('C27: isLogin=true + getUserInfo 返 baseUser → user 更新 + refresh + updateSubscribeStatus', async () => {
      mockHaveRequestToken.mockReturnValue(true)
      const store = useUserStore()
      const spy = vi.spyOn(store, 'getUserInfo').mockResolvedValue(baseUser)
      const result = useBookmark(makeOptions())
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(spy).toHaveBeenCalledTimes(2)
      expect(spy).toHaveBeenNthCalledWith(2, { refresh: true })
      expect(result.user.value).toEqual(baseUser)
      expect(mockUpdateSubscribeStatus).toHaveBeenCalled()
    })

    it('C28: isLogin=true + getUserInfo 首次返 null → 不调 refresh 不调 updateSubscribeStatus', async () => {
      mockHaveRequestToken.mockReturnValue(true)
      const store = useUserStore()
      const spy = vi.spyOn(store, 'getUserInfo').mockResolvedValue(undefined as any)
      useBookmark(makeOptions())
      await Promise.resolve()
      await Promise.resolve()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(mockUpdateSubscribeStatus).not.toHaveBeenCalled()
    })

    it('C29: useLogBookmark throw → console.error 捕获，不影响 getUserInfo 后续调用', async () => {
      mockHaveRequestToken.mockReturnValue(true)
      mockUseLogBookmark.mockImplementationOnce(() => {
        throw new Error('boom')
      })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const store = useUserStore()
      const getSpy = vi.spyOn(store, 'getUserInfo').mockResolvedValue(baseUser)
      useBookmark(makeOptions())
      await Promise.resolve()
      expect(errorSpy).toHaveBeenCalled()
      expect(getSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })
  })

  describe('initialRequestTask + initialTasksCompleted（C30-C31）', () => {
    it('C30: 传入 callback → setTimeout 触发 initialTasksCompleted', async () => {
      vi.useFakeTimers()
      const completed = vi.fn()
      const options = makeOptions()
      options.initialRequestTask = vi.fn().mockResolvedValue(undefined)
      options.initialTasksCompleted = completed
      useBookmark(options)
      await vi.runAllTimersAsync()
      expect(options.initialRequestTask).toHaveBeenCalled()
      expect(completed).toHaveBeenCalled()
    })

    it('C31: 未传 callback → Promise.allSettled 仍 resolve，不抛错', async () => {
      vi.useFakeTimers()
      expect(() => useBookmark(makeOptions())).not.toThrow()
      await vi.runAllTimersAsync()
    })
  })
})
