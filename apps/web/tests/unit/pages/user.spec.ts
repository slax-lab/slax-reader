// pages/user.vue 单测
// 覆盖：加载态骨架屏 / 内容态卡片结构 / 实验室卡片按 /labs 返回显隐 / 共用顶栏的搜索与反馈 / error_alert query 处理
import UserRelatedInfoSection from '~~/app/components/global/UserRelatedInfoSection.vue'
import UserImportSection from '~~/app/components/UserImportSection.vue'
import UserPage from '~~/app/pages/user.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRoute, mockNavigateTo, mockRequest, mockGet, mockAnalyticsLog, mockToastShowToast, mockUseI18n, mockShowFeedbackModal } = vi.hoisted(() => {
  const route = { query: {} as Record<string, unknown>, path: '/user', params: {}, fullPath: '/user', hash: '' }
  const mockGet = vi.fn()
  const mockT = vi.fn((key: string) => key)
  return {
    mockRoute: route,
    mockNavigateTo: vi.fn(() => Promise.resolve()),
    mockRequest: vi.fn(() => ({ get: mockGet, post: vi.fn(() => Promise.resolve()) })),
    mockGet,
    mockAnalyticsLog: vi.fn(),
    mockToastShowToast: vi.fn(),
    mockUseI18n: vi.fn(() => ({ locale: { value: 'en' }, t: mockT, te: () => true })),
    mockShowFeedbackModal: vi.fn()
  }
})

vi.mock('~/components/Modal', () => ({
  showFeedbackModal: mockShowFeedbackModal
}))

vi.mock('~/components/Toast', () => ({
  default: { showToast: mockToastShowToast },
  ToastType: { Success: 1, Error: 2, Warning: 3, Info: 4 }
}))

mockNuxtImport('useRoute', () => () => mockRoute)
mockNuxtImport('navigateTo', () => mockNavigateTo)
mockNuxtImport('request', () => mockRequest)
mockNuxtImport('analyticsLog', () => mockAnalyticsLog)
mockNuxtImport('useI18n', () => mockUseI18n)

const baseUserDetail = {
  name: 'Test User',
  email: 'test@example.com',
  account: 'testaccount',
  lang: 'en',
  avatar: 'https://example.com/avatar.jpg',
  timezone: 'UTC',
  id: '1',
  platform: [],
  subscription: {},
  share_collect: {},
  stripe_connect: {},
  ai_lang: 'en'
}

// request().get 按 url 分发：/v1/user/labs 默认返回空列表，其余返回用户详情
let labFeatures: unknown[] = []
const dispatchGet = ({ url }: { url: string }) => Promise.resolve(url === '/v1/user/labs' ? { features: labFeatures } : baseUserDetail)

beforeEach(() => {
  mockRoute.hash = ''
  mockRoute.query = {}
  mockNavigateTo.mockClear()
  mockGet.mockReset()
  mockAnalyticsLog.mockClear()
  mockToastShowToast.mockClear()
  labFeatures = []
  mockGet.mockImplementation(dispatchGet)
})

afterEach(() => {
  mockRoute.query = {}
})

// 子组件 stub，避免子组件内部副作用
const stubs = {
  // Top bar shared with the inbox: only the search / feedback events matter here
  BookmarksTopBar: {
    name: 'BookmarksTopBar',
    template: '<header class="bookmarks-topbar-stub"></header>',
    props: ['sidebarToggle', 'searchText'],
    emits: ['search', 'feedback']
  },
  UserRelatedInfoSection: {
    name: 'UserRelatedInfoSection',
    template: '<section v-if="section === \'connections\'" class="settings-card user-related-stub"></section>',
    props: ['userInfo', 'section'],
    emits: ['update']
  },
  UserImportSection: {
    name: 'UserImportSection',
    template: '<section class="settings-card user-import-stub"></section>'
  },
  UserExportSection: {
    name: 'UserExportSection',
    template: '<section class="settings-card user-export-stub"></section>'
  },
  UserDeleteAccountSection: {
    name: 'UserDeleteAccountSection',
    template: '<section class="user-delete-account-section"></section>'
  },
  OptionsBar: {
    name: 'OptionsBar',
    template: '<div class="options-bar-stub"></div>',
    props: ['options', 'defaultSelectedIndex'],
    emits: ['optionSelected']
  },
  AILanguageTips: {
    name: 'AILanguageTips',
    template: '<span />'
  },
  NavigateStyleButton: {
    name: 'NavigateStyleButton',
    template: '<button class="navigate-style-button-stub"></button>',
    props: ['title'],
    emits: ['action']
  }
}

describe('pages/user', () => {
  describe('加载态', () => {
    it('loading=true 时渲染 UserPageSkeleton，不渲染 .detail', () => {
      mockGet.mockReturnValue(new Promise(() => {})) // 永不 resolve
      const wrapper = mountWithApp(UserPage, { global: { stubs } })
      expect(wrapper.find('.user-page-skeleton').exists()).toBe(true)
      expect(wrapper.find('.detail').exists()).toBe(false)
    })
  })

  describe('内容态', () => {
    it('加载完成后渲染 .detail，顶栏用收件箱同款 BookmarksTopBar，不再有自己的返回栏', async () => {
      const wrapper = mountWithApp(UserPage, { global: { stubs } })
      await flushPromises()
      expect(wrapper.find('.detail').exists()).toBe(true)
      expect(wrapper.findComponent({ name: 'BookmarksTopBar' }).exists()).toBe(true)
      expect(wrapper.find('.user-topbar').exists()).toBe(false)
      expect(wrapper.find('.back-btn').exists()).toBe(false)
    })

    it('渲染 6 个 .settings-card（语言 + 个人信息 + 第三方绑定 + 导入 + 导出 + 帮助支持），实验室为空时不占卡', async () => {
      const wrapper = mountWithApp(UserPage, { global: { stubs } })
      await flushPromises()
      expect(wrapper.findAll('.settings-card').length).toBe(6)
      expect(wrapper.find('#labs').exists()).toBe(false)
    })

    it('places Labs after connections and before data', async () => {
      labFeatures = [{ key: 'youtube', status: 'active', enabled: false, enabled_at: null }]
      const wrapper = mountWithApp(UserPage, { global: { stubs } })
      await flushPromises()
      const cards = wrapper.findAll('.settings-card')
      expect(cards.length).toBe(7)
      expect(cards[3]!.attributes('id')).toBe('labs')
      expect(wrapper.findAll('.settings-nav a').map(link => link.attributes('href'))).toEqual(['#account', '#preferences', '#connections', '#features', '#data', '#support'])
      expect(mockGet).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/user/labs' }))
    })

    it('UserRelatedInfoSection 和 UserImportSection 组件存在', async () => {
      const wrapper = mountWithApp(UserPage, { global: { stubs } })
      await flushPromises()
      expect(wrapper.findComponent(UserRelatedInfoSection).exists()).toBe(true)
      expect(wrapper.findComponent(UserImportSection).exists()).toBe(true)
    })

    it('UserDeleteAccountSection 不含 .settings-card class', async () => {
      const wrapper = mountWithApp(UserPage, { global: { stubs } })
      await flushPromises()
      const deleteSection = wrapper.find('.user-delete-account-section')
      expect(deleteSection.exists()).toBe(true)
      expect(deleteSection.classes()).not.toContain('settings-card')
    })
  })

  describe('section navigation', () => {
    it('omits Features when there are no visible Labs and groups account, preferences, connections, data, support', async () => {
      const wrapper = mountWithApp(UserPage, { global: { stubs } })
      await flushPromises()
      expect(wrapper.findAll('.settings-nav a').map(link => link.attributes('href'))).toEqual(['#account', '#preferences', '#connections', '#data', '#support'])
      expect((wrapper.find('#features').element as HTMLElement).style.display).toBe('none')
      expect(wrapper.find('#support .user-delete-account-section').exists()).toBe(true)
    })

    it('preserves query parameters and scrolls to a keyboard-focusable destination', async () => {
      mockRoute.query = { source: 'reader' }
      const wrapper = mountWithApp(UserPage, { global: { stubs } })
      await flushPromises()
      const target = wrapper.find('#data').element as HTMLElement
      const scroll = vi.spyOn(target, 'scrollIntoView')
      await wrapper.find('.settings-nav a[href="#data"]').trigger('click')
      await flushPromises()
      expect(mockNavigateTo).toHaveBeenCalledWith({ path: '/user', query: { source: 'reader' }, hash: '#data' }, { replace: true })
      expect(scroll).toHaveBeenCalled()
      expect(target.getAttribute('tabindex')).toBe('-1')
      expect(wrapper.find('.settings-nav a[href="#data"]').attributes('aria-current')).toBe('location')
    })

    it('opens the existing Labs deep link after the async Labs response', async () => {
      mockRoute.hash = '#labs'
      labFeatures = [{ key: 'youtube', status: 'active', enabled: false, enabled_at: null }]
      const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
      const wrapper = mountWithApp(UserPage, { global: { stubs } })
      await flushPromises()
      expect(wrapper.find('#labs').exists()).toBe(true)
      expect(scroll.mock.contexts).toContain(wrapper.find('#labs').element)
      scroll.mockRestore()
    })
  })

  describe('共用顶栏', () => {
    it('顶栏不带侧栏折叠按钮', async () => {
      const wrapper = mountWithApp(UserPage, { global: { stubs } })
      await flushPromises()
      expect(wrapper.findComponent({ name: 'BookmarksTopBar' }).props('sidebarToggle')).toBe(false)
    })

    it('顶栏搜索 → 带 q 回到收件箱；清空（空关键词）不离开设置页', async () => {
      const wrapper = mountWithApp(UserPage, { global: { stubs } })
      await flushPromises()
      const topbar = wrapper.findComponent({ name: 'BookmarksTopBar' })
      await topbar.vm.$emit('search', 'vue')
      expect(mockNavigateTo).toHaveBeenCalledWith({ path: '/bookmarks', query: { q: 'vue' } })
      mockNavigateTo.mockClear()
      await topbar.vm.$emit('search', '')
      expect(mockNavigateTo).not.toHaveBeenCalled()
    })

    it('顶栏反馈 → showFeedbackModal 带用户邮箱和 settings 入口', async () => {
      const wrapper = mountWithApp(UserPage, { global: { stubs } })
      await flushPromises()
      await wrapper.findComponent({ name: 'BookmarksTopBar' }).vm.$emit('feedback')
      expect(mockShowFeedbackModal).toHaveBeenCalledWith(expect.objectContaining({ email: 'test@example.com', params: { entry_point: 'settings' } }))
    })
  })

  describe('error_alert query 参数', () => {
    it('存在 error_alert 时调用 Toast.showToast 并 navigateTo 清除参数', async () => {
      mockRoute.query = { error_alert: '登录已过期', other: 'keep' }
      mountWithApp(UserPage, { global: { stubs } })
      await flushPromises()
      expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ text: '登录已过期' }))
      expect(mockNavigateTo).toHaveBeenCalledWith({ path: '/user', query: { other: 'keep' } }, { replace: true })
    })
  })
})
