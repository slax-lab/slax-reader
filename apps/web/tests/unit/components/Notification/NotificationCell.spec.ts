// Notification/NotificationCell 组件单测
// props: notification (required) / style (NORMAL | SIMPLE)
// computed publishTime: diffDays/diffHours/diffMinutes/just_now/toDateString
// handleClick: 5 path - comment/reply/collection_update/collection_price_change
//   isRead=false → markNotificationRead → request.post(NOTIFICATION_MARK_READ)
//   未匹配 type → 早退（不跳）
import NotificationCell, { NotificationCellStyle } from '~~/app/components/Notification/NotificationCell.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequest, mockPost } = vi.hoisted(() => {
  const mockPost = vi.fn(() => Promise.resolve({}))
  return {
    mockPost,
    mockRequest: vi.fn(() => ({ post: mockPost }))
  }
})

mockNuxtImport('request', () => mockRequest)

const baseNotification = {
  id: 100,
  is_read: false,
  type: 'comment',
  source: 'share',
  icon: '/icon.png',
  username: 'tester',
  title: 'Notification Title',
  content: 'Comment text',
  bookmark_title: 'Bookmark Title',
  created_at: new Date().toISOString(),
  object_data: {
    share_code: 'SHR',
    collection_code: 'COL',
    cb_id: 7,
    comment_id: 99,
    bookmark_id: 88
  }
}

describe('Notification/NotificationCell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('渲染（NORMAL 默认）', () => {
    it('mount → 渲染 .notification-cell.normal + 标题图标', () => {
      const wrapper = mountWithApp(NotificationCell, { props: { notification: baseNotification } })
      expect(wrapper.find('.notification-cell.normal').exists()).toBe(true)
      expect(wrapper.find('.notification-header img').exists()).toBe(true)
    })

    it('type=reply → 高亮 .highlighted span', () => {
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: { ...baseNotification, type: 'reply' } }
      })
      expect(wrapper.find('.highlighted').exists()).toBe(true)
    })

    it('type=comment → 不渲染 .highlighted, 渲染 title', () => {
      const wrapper = mountWithApp(NotificationCell, { props: { notification: baseNotification } })
      expect(wrapper.find('.highlighted').exists()).toBe(false)
    })

    it('quote_content 非空 → 渲染 .reply', () => {
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: { ...baseNotification, quote_content: 'quoted' } }
      })
      expect(wrapper.find('.reply').exists()).toBe(true)
      expect(wrapper.find('.reply-comment span').text()).toBe('quoted')
    })

    it('quote_content 空 → 渲染 .comment', () => {
      const wrapper = mountWithApp(NotificationCell, { props: { notification: baseNotification } })
      expect(wrapper.find('.comment').exists()).toBe(true)
      expect(wrapper.find('.comment-text').text()).toBe('Comment text')
    })

    it('content 和 quote_content 都为空 → 不渲染 .notification-content', () => {
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: { ...baseNotification, content: '', quote_content: '' } }
      })
      expect(wrapper.find('.notification-content').exists()).toBe(false)
    })

    it('bookmark_title 渲染 .link', () => {
      const wrapper = mountWithApp(NotificationCell, { props: { notification: baseNotification } })
      expect(wrapper.find('.notification-footer .link').exists()).toBe(true)
    })
  })

  describe('渲染（SIMPLE）', () => {
    it('style=SIMPLE → .simple 容器渲染', () => {
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: baseNotification, style: NotificationCellStyle.SIMPLE }
      })
      expect(wrapper.find('.notification-cell.simple').exists()).toBe(true)
    })

    it('style=SIMPLE + bookmark_title → .link 渲染', () => {
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: baseNotification, style: NotificationCellStyle.SIMPLE }
      })
      expect(wrapper.find('.link').exists()).toBe(true)
    })
  })

  describe('publishTime computed', () => {
    it('刚刚（diff < 1 分钟）→ just_now i18n', () => {
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: { ...baseNotification, created_at: new Date().toISOString() } }
      })
      const right = wrapper.find('.right').text()
      expect(right.length).toBeGreaterThan(0)
    })

    it('几分钟前 → minutes_ago', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: { ...baseNotification, created_at: fiveMinAgo } }
      })
      const right = wrapper.find('.right').text()
      expect(right).toContain('5')
    })

    it('几小时前 → hours_ago', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: { ...baseNotification, created_at: threeHoursAgo } }
      })
      const right = wrapper.find('.right').text()
      expect(right).toContain('3')
    })

    it('多天前 → toDateString', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: { ...baseNotification, created_at: tenDaysAgo } }
      })
      const right = wrapper.find('.right').text()
      expect(right.length).toBeGreaterThan(0)
    })
  })

  describe('handleClick', () => {
    it('type=comment + source=share + isRead=false → markRead + window.open(/s/.../highlight=...)', async () => {
      const mockOpen = vi.fn()
      vi.stubGlobal('open', mockOpen)
      const wrapper = mountWithApp(NotificationCell, { props: { notification: baseNotification } })
      await wrapper.find('.notification-cell').trigger('click')
      await flushPromises()
      expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/user/read_notification', body: { id: 100 } }))
      expect(mockOpen).toHaveBeenCalledWith(expect.stringContaining('/s/SHR'), '_blank')
    })

    it('type=comment + source=collection → /c/COL/CB?highlight=', async () => {
      const mockOpen = vi.fn()
      vi.stubGlobal('open', mockOpen)
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: { ...baseNotification, source: 'collection' } }
      })
      await wrapper.find('.notification-cell').trigger('click')
      await flushPromises()
      expect(mockOpen).toHaveBeenCalledWith(expect.stringContaining('/c/COL/7'), '_blank')
    })

    it('isRead=true → 不调 markRead，URL 不含 notification_id', async () => {
      const mockOpen = vi.fn()
      vi.stubGlobal('open', mockOpen)
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: { ...baseNotification, is_read: true } }
      })
      await wrapper.find('.notification-cell').trigger('click')
      await flushPromises()
      expect(mockPost).not.toHaveBeenCalled()
      expect(mockOpen).toHaveBeenCalled()
    })

    it('type=collection_update → /c/COL/<bookmark_id>', async () => {
      const mockOpen = vi.fn()
      vi.stubGlobal('open', mockOpen)
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: { ...baseNotification, type: 'collection_update' } }
      })
      await wrapper.find('.notification-cell').trigger('click')
      await flushPromises()
      expect(mockOpen).toHaveBeenCalledWith(expect.stringContaining('/c/COL/88'), '_blank')
    })

    it('type=collection_price_change → /c/COL', async () => {
      const mockOpen = vi.fn()
      vi.stubGlobal('open', mockOpen)
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: { ...baseNotification, type: 'collection_price_change' } }
      })
      await wrapper.find('.notification-cell').trigger('click')
      await flushPromises()
      expect(mockOpen).toHaveBeenCalledWith(expect.stringContaining('/c/COL'), '_blank')
    })

    it('type 未匹配 → 不跳转', async () => {
      const mockOpen = vi.fn()
      vi.stubGlobal('open', mockOpen)
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: { ...baseNotification, type: 'unknown' } }
      })
      await wrapper.find('.notification-cell').trigger('click')
      await flushPromises()
      expect(mockOpen).not.toHaveBeenCalled()
    })

    it('id 缺失 → markRead 早退', async () => {
      const mockOpen = vi.fn()
      vi.stubGlobal('open', mockOpen)
      const wrapper = mountWithApp(NotificationCell, {
        props: { notification: { ...baseNotification, id: 0, is_read: false } }
      })
      await wrapper.find('.notification-cell').trigger('click')
      await flushPromises()
      expect(mockPost).not.toHaveBeenCalled()
    })
  })
})
