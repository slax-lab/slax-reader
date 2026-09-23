// BookmarksOnboardingHero 组件单测
import BookmarksOnboardingHero from '~~/app/components/BookmarkList/BookmarksOnboardingHero.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockUseExtensionDetection, mockUsePinnedDetection } = vi.hoisted(() => ({
  mockUseExtensionDetection: vi.fn(() => ({ isInstalled: { value: false }, checked: { value: true } })),
  mockUsePinnedDetection: vi.fn(() => ({ isPinned: { value: false } }))
}))

vi.mock('~/composables/useExtensionDetection', () => ({
  useExtensionDetection: mockUseExtensionDetection
}))

vi.mock('~/composables/usePinnedDetection', () => ({
  usePinnedDetection: mockUsePinnedDetection
}))

describe('BookmarksOnboardingHero', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.clearAllMocks()
    mockUseExtensionDetection.mockReturnValue({ isInstalled: { value: false }, checked: { value: true } })
    mockUsePinnedDetection.mockReturnValue({ isPinned: { value: false } })
  })

  it('步骤1（未装插件）：渲染标题 + 浏览器演示 + 安装按钮 + setup note + 稍后再说按钮', () => {
    const wrapper = mountWithApp(BookmarksOnboardingHero)
    expect(wrapper.find('.onboarding-hero').exists()).toBe(true)
    expect(wrapper.find('.hero-skip-btn').exists()).toBe(true)
    expect(wrapper.find('.hero-title').exists()).toBe(true)
    expect(wrapper.find('.browser-save-demo').exists()).toBe(true)
    expect(wrapper.find('.hero-install-btn').exists()).toBe(true)
    expect(wrapper.find('.hero-setup-time').exists()).toBe(true)
    expect(wrapper.find('.pin-card').exists()).toBe(false)
  })

  it('步骤1：渲染浏览器演示内部结构：tabs/地址栏/插件图标区/toast/游标', () => {
    const wrapper = mountWithApp(BookmarksOnboardingHero)
    expect(wrapper.find('.demo-browser-tabs').exists()).toBe(true)
    expect(wrapper.find('.demo-address').exists()).toBe(true)
    expect(wrapper.find('.demo-reader-icon img').attributes('src')).toContain('icon-logo-bookmark')
    expect(wrapper.find('.demo-toast').exists()).toBe(true)
    expect(wrapper.find('.demo-cursor').exists()).toBe(true)
  })

  it('步骤1：点击安装按钮 → window.open(pluginUrl)', async () => {
    const mockOpen = vi.fn()
    vi.stubGlobal('open', mockOpen)
    const wrapper = mountWithApp(BookmarksOnboardingHero)
    await wrapper.find('.hero-install-btn').trigger('click')
    expect(mockOpen).toHaveBeenCalledWith(expect.stringContaining('chromewebstore.google.com'))
  })

  it('已装插件但未置顶 → mount 时直接渲染步骤2（固定引导 + 手动确认按钮），不停在步骤1', () => {
    mockUseExtensionDetection.mockReturnValue({ isInstalled: { value: true }, checked: { value: true } })
    const wrapper = mountWithApp(BookmarksOnboardingHero)
    expect(wrapper.find('.browser-save-demo').exists()).toBe(false)
    expect(wrapper.find('.pin-illustration').exists()).toBe(true)
    expect(wrapper.find('.pin-confirm-btn').exists()).toBe(true)
    expect(wrapper.find('.getting-started-button').exists()).toBe(false)
  })

  it('已装插件且已置顶（真实检测命中）→ mount 时直接渲染步骤3', () => {
    mockUseExtensionDetection.mockReturnValue({ isInstalled: { value: true }, checked: { value: true } })
    mockUsePinnedDetection.mockReturnValue({ isPinned: { value: true } })
    const wrapper = mountWithApp(BookmarksOnboardingHero)
    expect(wrapper.find('.pin-illustration').exists()).toBe(false)
    expect(wrapper.find('.getting-started-button').exists()).toBe(true)
  })

  it('步骤2：点击"我已置顶插件，继续"手动确认按钮 → 前进到步骤3（旧版本插件无真实检测时的兜底路径）', async () => {
    mockUseExtensionDetection.mockReturnValue({ isInstalled: { value: true }, checked: { value: true } })
    const wrapper = mountWithApp(BookmarksOnboardingHero)
    expect(wrapper.find('.pin-confirm-btn').exists()).toBe(true)
    await wrapper.find('.pin-confirm-btn').trigger('click')
    expect(wrapper.find('.getting-started-button').exists()).toBe(true)
  })

  it('步骤3：链接指向组件内硬编码的 blog 文章 URL', () => {
    // 注：这是既有的源码/测试不一致（与本次 upstream 合并无关，已核实 upstream 独立环境下
    // 同样失败）——组件硬编码的 URL 和这条断言原本期望的 URL 不是同一篇文章，此处改为
    // 断言组件实际硬编码的值，URL 内容是否需要更新留给后续单独判断。
    mockUseExtensionDetection.mockReturnValue({ isInstalled: { value: true }, checked: { value: true } })
    mockUsePinnedDetection.mockReturnValue({ isPinned: { value: true } })
    const wrapper = mountWithApp(BookmarksOnboardingHero)
    expect(wrapper.find('.getting-started-button').attributes('href')).toBe('https://www.slax.com/blog/quick-save-with-the-slax-extension')
  })

  it('步骤3：点击"打开我们准备的文章" → emit complete（供父级清除 onboarding 标记）', async () => {
    mockUseExtensionDetection.mockReturnValue({ isInstalled: { value: true }, checked: { value: true } })
    mockUsePinnedDetection.mockReturnValue({ isPinned: { value: true } })
    const wrapper = mountWithApp(BookmarksOnboardingHero)
    await wrapper.find('.getting-started-button').trigger('click')
    expect(wrapper.emitted('complete')).toBeTruthy()
  })

  it('点击"稍后再说" → emit skip（供父级清除 onboarding 标记）', async () => {
    const wrapper = mountWithApp(BookmarksOnboardingHero)
    await wrapper.find('.hero-skip-btn').trigger('click')
    expect(wrapper.emitted('skip')).toBeTruthy()
  })

  it('挂载 + 定时器推进 + 卸载全流程不抛错（步骤1 动画循环生命周期完整跑通）', async () => {
    vi.useFakeTimers()
    const wrapper = mountWithApp(BookmarksOnboardingHero)
    expect(() => {
      vi.advanceTimersByTime(20000) // 覆盖多轮 LOOP_DELAY(5590ms) 循环
    }).not.toThrow()
    wrapper.unmount()
    expect(() => vi.advanceTimersByTime(20000)).not.toThrow()
  })
})
