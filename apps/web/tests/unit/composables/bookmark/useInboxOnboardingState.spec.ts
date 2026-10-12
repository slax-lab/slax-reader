// useInboxOnboardingState 单元测试
import { computed, defineComponent, ref } from 'vue'

import { useInboxOnboardingState } from '~~/app/composables/bookmark/useInboxOnboardingState'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseExtensionDetection } = vi.hoisted(() => ({
  mockUseExtensionDetection: vi.fn()
}))

vi.mock('~/composables/useExtensionDetection', () => ({
  useExtensionDetection: mockUseExtensionDetection
}))

const detectionState = (overrides: { isInstalled?: boolean; checked?: boolean } = {}) => ({
  isInstalled: { value: overrides.isInstalled ?? false },
  checked: { value: overrides.checked ?? true }
})

const mountState = (
  params: {
    isCurrentInboxTab?: boolean
    subscribedCount?: number
    subscriptionReady?: boolean
    isDataEmpty?: boolean
    isFirstLoad?: boolean
    userId?: number
  } = {}
) => {
  const isCurrentInboxTab = ref(params.isCurrentInboxTab ?? true)
  const subscribedCount = ref(params.subscribedCount ?? 0)
  const subscriptionReady = ref(params.subscriptionReady ?? true)
  const isDataEmpty = ref(params.isDataEmpty ?? true)
  const isFirstLoad = ref(params.isFirstLoad ?? false)
  const userId = ref<number | undefined>(params.userId ?? 1)
  let api: ReturnType<typeof useInboxOnboardingState> | undefined
  const Host = defineComponent({
    setup() {
      api = useInboxOnboardingState({ isCurrentInboxTab, subscribedCount, subscriptionReady, isDataEmpty, isFirstLoad, userId })
      return () => null
    }
  })
  const wrapper = mountWithApp(Host)
  return { wrapper, api: api!, isDataEmpty, subscribedCount, isFirstLoad }
}

describe('useInboxOnboardingState', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('未就位（探测未完成）且无标记 → inboxState=null', () => {
    mockUseExtensionDetection.mockReturnValue(detectionState({ checked: false }))
    const { api } = mountState()
    expect(api.inboxState.value).toBeNull()
  })

  it('未就位（订阅数据未完成）且无标记 → inboxState=null', () => {
    mockUseExtensionDetection.mockReturnValue(detectionState({ checked: true }))
    const { api } = mountState({ subscriptionReady: false })
    expect(api.inboxState.value).toBeNull()
  })

  it('非 inbox tab → inboxState=null（即使数据已就位）', () => {
    mockUseExtensionDetection.mockReturnValue(detectionState({ checked: true }))
    const { api } = mountState({ isCurrentInboxTab: false })
    expect(api.inboxState.value).toBeNull()
  })

  it('未装插件 + 订阅数 0 + inbox 空 → A，且落 onboarding 标记', () => {
    mockUseExtensionDetection.mockReturnValue(detectionState({ isInstalled: false, checked: true }))
    const { api } = mountState({ subscribedCount: 0, isDataEmpty: true, userId: 10 })
    expect(api.inboxState.value).toBe('A')
    expect(localStorage.getItem('slax_onboarding_pending_10')).toBe('true')
  })

  it('未装插件 + 订阅数 0 + inbox 非空 → B（不满足 A 的 isDataEmpty 条件，修复"老用户被整页覆盖"的 bug）', () => {
    mockUseExtensionDetection.mockReturnValue(detectionState({ isInstalled: false, checked: true }))
    const { api } = mountState({ subscribedCount: 0, isDataEmpty: false })
    expect(api.inboxState.value).toBe('B')
  })

  it('未装插件 + 订阅数 > 0 → B', () => {
    mockUseExtensionDetection.mockReturnValue(detectionState({ isInstalled: false, checked: true }))
    const { api } = mountState({ subscribedCount: 2, isDataEmpty: true })
    expect(api.inboxState.value).toBe('B')
  })

  it('已装插件（不管订阅数）→ C', () => {
    mockUseExtensionDetection.mockReturnValue(detectionState({ isInstalled: true, checked: true }))
    const { api } = mountState({ subscribedCount: 5 })
    expect(api.inboxState.value).toBe('C')
  })

  it('已落标记后，即使插件探测未就位，仍立刻返回 A（不闪现侧边栏/其它态）', () => {
    localStorage.setItem('slax_onboarding_pending_1', 'true')
    mockUseExtensionDetection.mockReturnValue(detectionState({ checked: false }))
    const { api } = mountState({ userId: 1 })
    expect(api.inboxState.value).toBe('A')
  })

  it('已落标记后装上插件 → 标记失效并清除，按 C 展示（修复"装插件后仍卡在安装引导"的死路）', async () => {
    localStorage.setItem('slax_onboarding_pending_2', 'true')
    mockUseExtensionDetection.mockReturnValue(detectionState({ isInstalled: true, checked: true }))
    const { api } = mountState({ userId: 2, subscribedCount: 0, isDataEmpty: true })
    expect(api.inboxState.value).toBe('C')

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(localStorage.getItem('slax_onboarding_pending_2')).toBeNull()
  })

  it('标记生效期间 inbox 变为非空 → 自动清除标记，inboxState 回落', async () => {
    mockUseExtensionDetection.mockReturnValue(detectionState({ isInstalled: false, checked: true }))
    const { api, isDataEmpty } = mountState({ subscribedCount: 0, isDataEmpty: true, userId: 5 })
    expect(api.inboxState.value).toBe('A')
    expect(localStorage.getItem('slax_onboarding_pending_5')).toBe('true')

    isDataEmpty.value = false
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(localStorage.getItem('slax_onboarding_pending_5')).toBeNull()
    expect(api.inboxState.value).toBe('B')
  })

  it('clearOnboardingPending 由消费方主动调用（如"稍后再说"/走完引导）→ 标记清除', () => {
    mockUseExtensionDetection.mockReturnValue(detectionState({ isInstalled: false, checked: true }))
    const { api } = mountState({ subscribedCount: 0, isDataEmpty: true, userId: 8 })
    expect(localStorage.getItem('slax_onboarding_pending_8')).toBe('true')
    api.clearOnboardingPending()
    expect(localStorage.getItem('slax_onboarding_pending_8')).toBeNull()
  })

  it('首次书签加载未完成 → inboxState=null（即使插件/订阅数据均已就位，慢网络下不误判老用户为空 inbox）', () => {
    mockUseExtensionDetection.mockReturnValue(detectionState({ isInstalled: false, checked: true }))
    const { api } = mountState({ subscribedCount: 0, isDataEmpty: true, isFirstLoad: true })
    expect(api.inboxState.value).toBeNull()
  })

  it('首次书签加载完成后 → 按原逻辑判定 A/B/C', () => {
    mockUseExtensionDetection.mockReturnValue(detectionState({ isInstalled: false, checked: true }))
    const { api, isFirstLoad } = mountState({ subscribedCount: 0, isDataEmpty: true, isFirstLoad: true, userId: 11 })
    expect(api.inboxState.value).toBeNull()

    isFirstLoad.value = false
    expect(api.inboxState.value).toBe('A')
  })

  it('clearOnboardingPending 后落终态（dismissed）→ 即使条件仍满足 A，也不会被 watcher 重新判回 A（修复 skip 死循环）', async () => {
    mockUseExtensionDetection.mockReturnValue(detectionState({ isInstalled: false, checked: true }))
    const { api, isDataEmpty } = mountState({ subscribedCount: 0, isDataEmpty: true, userId: 9 })
    expect(api.inboxState.value).toBe('A')

    // 用户点"稍后再说"：消费方调用 clearOnboardingPending
    api.clearOnboardingPending()
    await new Promise(resolve => setTimeout(resolve, 0))

    // inbox 仍为空、插件仍未装 —— 如果没有 dismissed 终态，会被 watcher 立刻重新置回 A
    expect(isDataEmpty.value).toBe(true)
    expect(api.inboxState.value).toBe('B')
    expect(localStorage.getItem('slax_onboarding_pending_9')).toBeNull()
  })

  it('dismissed 后已装插件 → C（不再受"未装插件+空 inbox"条件影响）', () => {
    mockUseExtensionDetection.mockReturnValue(detectionState({ isInstalled: true, checked: true }))
    const { api } = mountState({ subscribedCount: 0, isDataEmpty: true, userId: 12 })
    api.clearOnboardingPending()
    expect(api.inboxState.value).toBe('C')
  })
})
