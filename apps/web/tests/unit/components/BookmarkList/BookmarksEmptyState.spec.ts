// BookmarksEmptyState 组件单测
import BookmarksEmptyState from '~~/app/components/BookmarkList/BookmarksEmptyState.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockAnalyticsLog } = vi.hoisted(() => ({
  mockAnalyticsLog: vi.fn()
}))

mockNuxtImport('analyticsLog', () => mockAnalyticsLog)

const baseProps = {
  filterStatus: 'inbox',
  isCurrentInboxTab: true
}

describe('BookmarksEmptyState', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    mockAnalyticsLog.mockReset()
  })

  describe('inbox：B/C/null', () => {
    it('inboxState=null（未就位）→ 不渲染任何态', () => {
      const wrapper = mountWithApp(BookmarksEmptyState, { props: { ...baseProps, inboxState: null } })
      expect(wrapper.find('.empty-view').exists()).toBe(false)
    })

    it('inboxState=B → 渲染带按钮 + 图标的 EmptyView（非默认兜底圆圈图标）', () => {
      const wrapper = mountWithApp(BookmarksEmptyState, { props: { ...baseProps, inboxState: 'B' } })
      expect(wrapper.find('.empty-view').exists()).toBe(true)
      expect(wrapper.find('.empty-view-action').exists()).toBe(true)
      // 非默认兜底圆圈图标
      const iconSvg = wrapper.find('.empty-view-icon svg')
      expect(iconSvg.exists()).toBe(true)
      expect(iconSvg.find('circle').exists()).toBe(false)
    })

    it('inboxState=B：点击安装按钮 → analyticsLog + window.open(pluginUrl)', async () => {
      const mockOpen = vi.fn()
      vi.stubGlobal('open', mockOpen)
      const wrapper = mountWithApp(BookmarksEmptyState, { props: { ...baseProps, inboxState: 'B' } })
      await wrapper.find('.empty-view-action').trigger('click')
      expect(mockAnalyticsLog).toHaveBeenCalledWith({
        event: 'bookmark_list_download',
        client: 'browser_extension'
      })
      expect(mockAnalyticsLog).toHaveBeenCalledTimes(1)
      expect(mockOpen).toHaveBeenCalledTimes(1)
      expect(mockAnalyticsLog.mock.invocationCallOrder[0]!).toBeLessThan(mockOpen.mock.invocationCallOrder[0]!)
      expect(mockOpen).toHaveBeenCalledWith(expect.stringContaining('chromewebstore.google.com'))
    })

    it('inboxState=C → 渲染无按钮的纯净 EmptyView', () => {
      const wrapper = mountWithApp(BookmarksEmptyState, { props: { ...baseProps, inboxState: 'C' } })
      expect(wrapper.find('.empty-view').exists()).toBe(true)
      expect(wrapper.find('.empty-view-action').exists()).toBe(false)
    })
  })

  describe('非 inbox tab', () => {
    it('trashed 空态 → 走通用 BOOKMARK_EMPTY_CONFIG，不受三态逻辑影响', () => {
      const wrapper = mountWithApp(BookmarksEmptyState, {
        props: { filterStatus: 'trashed', isCurrentInboxTab: false, inboxState: null }
      })
      expect(wrapper.find('.empty-view').exists()).toBe(true)
      expect(wrapper.find('.empty-view-action').exists()).toBe(false)
    })
  })
})
