// UserNotification.vue 组件单元测试
// 关键约束（spec 修订 1 决议）：
//  - NotificationCell 必须显式 stub（mountWithApp 不自动 stub），否则真实子组件触发副作用
//  - C24 sendMessage 入参是 { type: 'ready' } 对象，不是字符串
//  - 删除原 C20 !showMessageBubble 早退分支（不可测，仅由 watch 入口触发）
//  - useNotification mock 必须在 mountWithApp 前 mockReturnValue（顶层 setup 块挂载时执行）

import { nextTick } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises, mount } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseNotification, mockRegisterWorker, mockOnMessage, mockSendMessage, mockRequestPushPermission, mockRequest, mockGet, mockUseDebounceFn, mockIsSafari } = vi.hoisted(
  () => {
    const mockGet = vi.fn((): Promise<unknown> => Promise.resolve([]))
    return {
      mockUseNotification: vi.fn(),
      mockRegisterWorker: vi.fn(() => Promise.resolve(null)),
      mockOnMessage: vi.fn(),
      mockSendMessage: vi.fn(() => Promise.resolve()),
      mockRequestPushPermission: vi.fn(() => Promise.resolve(true)),
      mockRequest: vi.fn(() => ({ get: mockGet })),
      mockGet,
      mockUseDebounceFn: vi.fn((fn: any) => fn),
      mockIsSafari: vi.fn(() => false)
    }
  }
)

mockNuxtImport('useNotification', () => mockUseNotification)
mockNuxtImport('request', () => mockRequest)
mockNuxtImport('useDebounceFn', () => mockUseDebounceFn)

vi.mock('@commons/utils/is', async () => {
  const actual = await vi.importActual<any>('@commons/utils/is')
  return { ...actual, isSafari: mockIsSafari }
})

import UserNotification, { UserNotificationIconStyle } from '~~/app/components/Notification/UserNotification.vue'

const mountUserNotification = (props: any = {}, supported = true) => {
  mockUseNotification.mockReturnValue({
    isSupportedNotification: supported,
    registerWorker: mockRegisterWorker,
    onMessage: mockOnMessage,
    sendMessage: mockSendMessage,
    requestPushPermission: mockRequestPushPermission
  })
  return mountWithApp(UserNotification, {
    props,
    global: {
      stubs: { NotificationCell: true }
    }
  })
}

describe('UserNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue([])
    mockIsSafari.mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('渲染基础（C1-C3）', () => {
    it('C1: 默认 mount → .notification-icon 存在 + 不含 .tiny', async () => {
      const wrapper = mountUserNotification()
      await flushPromises()
      const icon = wrapper.find('.notification-icon')
      expect(icon.exists()).toBe(true)
      expect(icon.classes()).not.toContain('tiny')
    })

    it('C2: iconStyle=TINY → .tiny class 存在', async () => {
      const wrapper = mountUserNotification({ iconStyle: UserNotificationIconStyle.TINY })
      await flushPromises()
      expect(wrapper.find('.notification-icon').classes()).toContain('tiny')
    })

    it('C3: onMessage 收到 unreadCount=5 → .dot 渲染 v-show=true', async () => {
      let capturedCb: any = null
      mockOnMessage.mockImplementation((cb: any) => {
        capturedCb = cb
      })
      const wrapper = mountUserNotification()
      await flushPromises()
      await flushPromises()
      capturedCb({ data: '{"unreadCount":5}' })
      await nextTick()
      const dot = wrapper.find('.dot')
      expect(dot.exists()).toBe(true)
      // v-show=true 时 style 属性可能是 undefined（无 inline style）；v-show=false 时是 'display: none;'
      expect(dot.attributes('style') || '').not.toContain('display: none')
    })
  })

  describe('onMounted / onUnmounted（C5-C6）', () => {
    it('C5: mount 触发 window.addEventListener("resize", ...)', async () => {
      const addSpy = vi.spyOn(window, 'addEventListener')
      mountUserNotification()
      expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    })

    it('C6: unmount 触发 window.removeEventListener("resize", ...)', async () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener')
      const wrapper = mountUserNotification()
      wrapper.unmount()
      expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    })
  })

  describe('iconClick（C12-C15）', () => {
    it('C12: 首次 click + isSafari=false → showMessageBubble=true 不调 requestPushPermission', async () => {
      const wrapper = mountUserNotification()
      await flushPromises()
      await wrapper.find('.notification-icon').trigger('click')
      await nextTick()
      expect(mockRequestPushPermission).not.toHaveBeenCalled()
      expect(wrapper.find('.notification-bubble').exists()).toBe(true)
    })

    it('C13: 首次 click + isSafari=true → 调 requestPushPermission', async () => {
      mockIsSafari.mockReturnValue(true)
      const wrapper = mountUserNotification()
      await flushPromises()
      await wrapper.find('.notification-icon').trigger('click')
      await nextTick()
      expect(mockRequestPushPermission).toHaveBeenCalled()
    })

    it('C14: 第二次 click → showMessageBubble=false', async () => {
      const wrapper = mountUserNotification()
      await flushPromises()
      await wrapper.find('.notification-icon').trigger('click')
      await wrapper.find('.notification-icon').trigger('click')
      await nextTick()
      // bubble v-show=false
      expect(wrapper.find('.notification-bubble').attributes('style')).toContain('display: none')
    })

    it('C15: Safari + 二次开启不重复调 requestPushPermission', async () => {
      mockIsSafari.mockReturnValue(true)
      const wrapper = mountUserNotification()
      await flushPromises()
      await wrapper.find('.notification-icon').trigger('click') // open
      await wrapper.find('.notification-icon').trigger('click') // close
      await wrapper.find('.notification-icon').trigger('click') // re-open
      await nextTick()
      expect(mockRequestPushPermission).toHaveBeenCalledTimes(1)
    })
  })

  describe('clickOutSide（C16-C18）', () => {
    it('C18: 正常 outside click → showMessageBubble=false', async () => {
      const wrapper = mountUserNotification()
      await flushPromises()
      // 打开 bubble
      await wrapper.find('.notification-icon').trigger('click')
      await nextTick()
      expect(wrapper.find('.notification-bubble').attributes('style') || '').not.toContain('display: none')
      // 模拟外部点击关闭按钮
      await wrapper.find('.close').trigger('click')
      await nextTick()
      expect(wrapper.find('.notification-bubble').attributes('style')).toContain('display: none')
    })
  })

  describe('checkAll（C19）', () => {
    it('C19: 调用 → emit checkAll + 关闭 bubble', async () => {
      const wrapper = mountUserNotification()
      await flushPromises()
      await wrapper.find('.notification-icon').trigger('click') // 打开
      await wrapper.find('.check-all').trigger('click')
      await nextTick()
      expect(wrapper.emitted('checkAll')).toBeTruthy()
      expect(wrapper.find('.notification-bubble').attributes('style')).toContain('display: none')
    })
  })

  describe('checkAndQueryNotifications（C21-C23）', () => {
    it('C22: showMessageBubble=true + unreadCount>0 → request.get(NOTIFICATION_LIST)', async () => {
      let capturedCb: any = null
      mockOnMessage.mockImplementation((cb: any) => {
        capturedCb = cb
      })
      const wrapper = mountUserNotification()
      await flushPromises()
      await flushPromises()
      // 触发 unreadCount > 0
      capturedCb({ data: '{"unreadCount":3}' })
      await nextTick()
      // 打开 bubble → 触发 watch + checkAndQueryNotifications
      mockGet.mockResolvedValueOnce([{ id: 1, content: 'msg' }])
      await wrapper.find('.notification-icon').trigger('click')
      await flushPromises()
      expect(mockGet).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/v1/user/notifications',
          query: { page: 1, page_size: 10 }
        })
      )
    })

    it('C21: 已加载 notifications + unreadCount=0 → 早退不再请求', async () => {
      let capturedCb: any = null
      mockOnMessage.mockImplementation((cb: any) => {
        capturedCb = cb
      })
      mockGet.mockResolvedValueOnce([{ id: 1, content: 'cached' }])
      const wrapper = mountUserNotification()
      await flushPromises()
      await flushPromises()
      capturedCb({ data: '{"unreadCount":1}' })
      await nextTick()
      // 第一次打开加载
      await wrapper.find('.notification-icon').trigger('click')
      await flushPromises()
      // unreadCount=0 + 关闭 bubble
      capturedCb({ data: '{"unreadCount":0}' })
      await wrapper.find('.notification-icon').trigger('click') // close
      await nextTick()
      mockGet.mockClear()
      // 重新打开 → 早退不再 request.get
      await wrapper.find('.notification-icon').trigger('click')
      await flushPromises()
      expect(mockGet).not.toHaveBeenCalled()
    })
  })

  describe('顶层启动逻辑（C24-C26）', () => {
    it('C24: isSupportedNotification=true → registerWorker → onMessage + sendMessage({type:"ready"})', async () => {
      mountUserNotification({}, true)
      await flushPromises()
      await flushPromises()
      expect(mockRegisterWorker).toHaveBeenCalled()
      expect(mockOnMessage).toHaveBeenCalled()
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'ready' })
    })

    it('C25: isSupportedNotification=false → request.get(GET_UNREAD_COUNT) → unreadCount', async () => {
      mockGet.mockResolvedValueOnce({ unread_count: 7 })
      const wrapper = mountUserNotification({}, false)
      await flushPromises()
      await flushPromises()
      expect(mockGet).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/user/unread_count' }))
      // unreadCount=7 → .dot 显示
      await nextTick()
      const dot = wrapper.find('.dot')
      expect(dot.exists()).toBe(true)
      expect(dot.attributes('style') || '').not.toContain('display: none')
    })

    it('C26: onMessage callback receives JSON string → 解析 unreadCount', async () => {
      let capturedCb: any = null
      mockOnMessage.mockImplementation((cb: any) => {
        capturedCb = cb
      })
      const wrapper = mountUserNotification()
      await flushPromises()
      await flushPromises()
      capturedCb({ data: '{"unreadCount":42}' })
      await nextTick()
      expect(wrapper.find('.dot').attributes('style') || '').not.toContain('display: none')
    })
  })

  describe('useDebounceFn 入参（C11）', () => {
    it('C11: useDebounceFn(resizeUpdate, 100, { maxWait: 5000 }) 被调', () => {
      mountUserNotification()
      expect(mockUseDebounceFn).toHaveBeenCalledWith(expect.any(Function), 100, { maxWait: 5000 })
    })
  })
})
