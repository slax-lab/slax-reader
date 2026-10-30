import { mountWithApp } from '../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'

// fork 下 mount layer BookmarkCell
// 点击应跳 /b/[id]（验证 seam）
const { mockPwaOpen, mockAnalyticsLog, mockUseRoute } = vi.hoisted(() => ({
  mockPwaOpen: vi.fn(),
  mockAnalyticsLog: vi.fn(),
  mockUseRoute: vi.fn(() => ({ query: {}, params: {}, path: '/bookmarks', fullPath: '/bookmarks' }))
}))

mockNuxtImport('pwaOpen', () => mockPwaOpen)
mockNuxtImport('analyticsLog', () => mockAnalyticsLog)
mockNuxtImport('useRoute', () => mockUseRoute)

describe('layer BookmarkCell under fork config', () => {
  it('普通文章点击标题：fork seam 覆盖 → pwaOpen /b/[id]', async () => {
    const { default: BookmarkCell } = await import('~/components/BookmarkList/BookmarkCell.vue')
    const bookmark = {
      id: 1000001,
      bookmark_user_uuid: 'uuid-xyz',
      title: 'T',
      target_url: 'https://example.com/a',
      status: 'success',
      type: 'article',
      site_name: 'S',
      created_at: '2026-01-01',
      published_at: '2026-01-01'
    }
    const wrapper = mountWithApp(BookmarkCell, { props: { bookmark, isSubscribe: false } })
    expect(wrapper.find('.article-card-link').attributes('href')).toBe('/b/uuid-xyz?_slax_entry=bookmarks')
    await wrapper.find('.article-title').trigger('click')
    expect(mockPwaOpen).toHaveBeenCalledWith({ url: '/b/uuid-xyz?_slax_entry=bookmarks' })
  })
  it('opens saved mail in the Reader while its source stays a non-link', async () => {
    mockPwaOpen.mockClear()
    const { default: BookmarkCell } = await import('~/components/BookmarkList/BookmarkCell.vue')
    const bookmark = { id: 1000002, bookmark_user_uuid: 'mail-copy', title: 'Mail', target_url: 'slax-newsletter://message/1', status: 'success', type: 'article', site_name: 'Weekly', created_at: '2026-01-01' }
    const wrapper = mountWithApp(BookmarkCell, { props: { bookmark, isSubscribe: false } })
    expect(wrapper.get('.article-source').element.tagName).toBe('SPAN')
    expect(wrapper.get('.article-source').attributes('href')).toBeUndefined()
    await wrapper.get('.article-title').trigger('click')
    expect(mockPwaOpen).toHaveBeenCalledWith({ url: '/b/mail-copy?_slax_entry=bookmarks' })
  })

})
