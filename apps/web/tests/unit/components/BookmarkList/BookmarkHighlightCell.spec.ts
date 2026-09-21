// BookmarkList/BookmarkHighlightCell 组件单测（新版 highlight-card 结构）
// props: highlight (HighlightItem)
// click → jumpToOriginal → pwaOpen
// dateString format / getContent 多分支：content 空 → approx_source.exact / 非空 → filter+map+join
import BookmarkHighlightCell from '~~/app/components/BookmarkList/BookmarkHighlightCell.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPwaOpen } = vi.hoisted(() => ({
  mockPwaOpen: vi.fn()
}))

mockNuxtImport('pwaOpen', () => mockPwaOpen)

const baseHighlight = {
  id: 1,
  type: 'mark',
  source_type: 'bookmark',
  source_id: 100,
  title: 'Bookmark Title',
  created_at: '2026-01-01T10:00:00Z',
  content: [
    { type: 'text', text: 'highlighted ' },
    { type: 'text', text: 'text' }
  ],
  approx_source: { exact: 'fallback exact' }
}

describe('BookmarkList/BookmarkHighlightCell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('渲染', () => {
    it('mount → .highlight-card + 来源标题渲染', () => {
      const wrapper = mountWithApp(BookmarkHighlightCell, { props: { highlight: baseHighlight } })
      expect(wrapper.find('.highlight-card').exists()).toBe(true)
      expect(wrapper.find('.highlight-source span').text()).toBe('Bookmark Title')
    })

    it('type=mark → .highlight-quote 渲染 highlight 内容拼接', () => {
      const wrapper = mountWithApp(BookmarkHighlightCell, { props: { highlight: baseHighlight } })
      expect(wrapper.find('.highlight-quote').exists()).toBe(true)
      expect(wrapper.find('.highlight-quote').text()).toBe('highlighted text')
    })

    it('type=comment → 渲染 highlight-quote + highlight-note(comment)', () => {
      const wrapper = mountWithApp(BookmarkHighlightCell, {
        props: { highlight: { ...baseHighlight, type: 'comment', comment: 'My comment' } }
      })
      expect(wrapper.find('.highlight-quote').exists()).toBe(true)
      expect(wrapper.find('.highlight-note').text()).toBe('My comment')
    })

    it('type=reply + 父评论存在 → 渲染 highlight-quote + highlight-note(reply)', () => {
      const wrapper = mountWithApp(BookmarkHighlightCell, {
        props: {
          highlight: {
            ...baseHighlight,
            type: 'reply',
            comment: 'My reply',
            parent_comment: 'Original comment',
            parent_comment_deleted: false
          }
        }
      })
      expect(wrapper.find('.highlight-note').text()).toBe('My reply')
      expect(wrapper.find('.highlight-quote').exists()).toBe(true)
    })

    it('type=reply + parent_comment_deleted=true → highlight-quote 仍渲染（内容来自 getContent）', () => {
      const wrapper = mountWithApp(BookmarkHighlightCell, {
        props: {
          highlight: {
            ...baseHighlight,
            type: 'reply',
            comment: 'My reply',
            parent_comment_deleted: true
          }
        }
      })
      // 新版不再有 deleted class，但 highlight-quote 仍渲染
      expect(wrapper.find('.highlight-quote').exists()).toBe(true)
    })

    it('title 空 → highlight-source 不渲染', () => {
      const wrapper = mountWithApp(BookmarkHighlightCell, {
        props: { highlight: { ...baseHighlight, title: '' } }
      })
      expect(wrapper.find('.highlight-source').exists()).toBe(false)
    })
  })

  describe('getContent 分支', () => {
    it('content 空数组 → 返 approx_source.exact', () => {
      const wrapper = mountWithApp(BookmarkHighlightCell, {
        props: { highlight: { ...baseHighlight, content: [] } }
      })
      expect(wrapper.find('.highlight-quote').text()).toBe('fallback exact')
    })

    it('content 含 image type → image 被过滤', () => {
      const wrapper = mountWithApp(BookmarkHighlightCell, {
        props: {
          highlight: {
            ...baseHighlight,
            content: [
              { type: 'text', text: 'A' },
              { type: 'image', text: 'IMG' },
              { type: 'text', text: 'B' }
            ]
          }
        }
      })
      expect(wrapper.find('.highlight-quote').text()).toBe('AB')
    })

    it('content 含 \\n / \\t → 被剔除', () => {
      const wrapper = mountWithApp(BookmarkHighlightCell, {
        props: {
          highlight: {
            ...baseHighlight,
            content: [{ type: 'text', text: 'A\nB\tC' }]
          }
        }
      })
      expect(wrapper.find('.highlight-quote').text()).toBe('ABC')
    })
  })

  describe('jumpToOriginal', () => {
    it('source_type=share → pwaOpen /b/<id>?highlight=<id>（fork：highlightRoute 统一跳 /b/）', async () => {
      const wrapper = mountWithApp(BookmarkHighlightCell, {
        props: { highlight: { ...baseHighlight, source_type: 'share', source_id: 'SHR' } }
      })
      await wrapper.find('.highlight-card').trigger('click')
      expect(mockPwaOpen).toHaveBeenCalledWith({ url: '/b/SHR?highlight=1' })
    })

    it('source_type=collection → pwaOpen /b/<id>?highlight=<id>（fork：highlightRoute 统一跳 /b/）', async () => {
      const wrapper = mountWithApp(BookmarkHighlightCell, {
        props: { highlight: { ...baseHighlight, source_type: 'collection', source_id: 'COL' } }
      })
      await wrapper.find('.highlight-card').trigger('click')
      expect(mockPwaOpen).toHaveBeenCalledWith({ url: '/b/COL?highlight=1' })
    })

    it('default source_type → pwaOpen /b/<id>?highlight=<id>（fork：highlightRoute 统一跳 /b/）', async () => {
      const wrapper = mountWithApp(BookmarkHighlightCell, {
        props: { highlight: { ...baseHighlight, source_type: 'bookmark', source_id: 100 } }
      })
      await wrapper.find('.highlight-card').trigger('click')
      expect(mockPwaOpen).toHaveBeenCalledWith({ url: '/b/100?highlight=1' })
    })
  })
})
