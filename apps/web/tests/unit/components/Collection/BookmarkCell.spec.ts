import { mountWithApp } from '../../../setup/mount'
import type { UserShareCollectListItem } from '@slax-reader/contracts/interface'
import { describe, expect, it } from 'vitest'

describe('Collection/BookmarkCell', () => {
  const makeBookmark = (overrides: Partial<UserShareCollectListItem> = {}): UserShareCollectListItem => ({
    title: 'Test Bookmark',
    bookmark_uuid: 'uuid-1',
    ...overrides
  })

  // 标题规则同 inbox 单元格
  describe('title rule (synced with inbox cell)', () => {
    it('prefers alias_title over title', async () => {
      const { default: BookmarkCell } = await import('~~/app/components/Collection/BookmarkCell.vue')
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: makeBookmark({ alias_title: 'Alias', title: 'Original' }) }
      })
      expect(wrapper.find('.article-title').text()).toBe('Alias')
    })

    it('falls back to title when alias_title is empty', async () => {
      const { default: BookmarkCell } = await import('~~/app/components/Collection/BookmarkCell.vue')
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: makeBookmark({ alias_title: '', title: 'Original' }) }
      })
      expect(wrapper.find('.article-title').text()).toBe('Original')
    })

    it('falls back to target_url when both alias_title and title are empty', async () => {
      const { default: BookmarkCell } = await import('~~/app/components/Collection/BookmarkCell.vue')
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: makeBookmark({ alias_title: '', title: '', target_url: 'https://example.com/raw' }) }
      })
      expect(wrapper.find('.article-title').text()).toBe('https://example.com/raw')
    })

    // 视觉宽度口径：中文记 2 宽度，拉丁记 1，预算 48*2
    it('keeps latin titles up to 96 chars untruncated', async () => {
      const { default: BookmarkCell } = await import('~~/app/components/Collection/BookmarkCell.vue')
      const long = 'A'.repeat(96)
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: makeBookmark({ title: long }) }
      })
      const text = wrapper.find('.article-title').text()
      expect(text.endsWith('…')).toBe(false)
      expect(Array.from(text).length).toBe(96)
    })

    it('truncates latin titles longer than 96 chars with an ellipsis', async () => {
      const { default: BookmarkCell } = await import('~~/app/components/Collection/BookmarkCell.vue')
      const long = 'A'.repeat(120)
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: makeBookmark({ title: long }) }
      })
      const text = wrapper.find('.article-title').text()
      expect(text.endsWith('…')).toBe(true)
      expect(Array.from(text).length).toBe(97) // 96 宽度 + 省略号
    })

    it('truncates cjk titles longer than 48 chars with an ellipsis', async () => {
      const { default: BookmarkCell } = await import('~~/app/components/Collection/BookmarkCell.vue')
      const long = '中'.repeat(60)
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: makeBookmark({ title: long }) }
      })
      const text = wrapper.find('.article-title').text()
      expect(text.endsWith('…')).toBe(true)
      expect(Array.from(text).length).toBe(49) // 48 字 + 省略号
    })
  })

  // snippet 由 first_mark 派生，无徽标
  describe('snippet (derived from first_mark)', () => {
    it('renders note text (is-note, no badge) when first_mark has a comment', async () => {
      const { default: BookmarkCell } = await import('~~/app/components/Collection/BookmarkCell.vue')
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: makeBookmark({ first_mark: { comment: 'my note', content: '', source: '' } }) }
      })
      expect(wrapper.find('.article-owner-note').classes()).toContain('is-note')
      expect(wrapper.find('.article-owner-note-text').text()).toBe('my note')
      expect(wrapper.find('.article-owner-note-badge').exists()).toBe(false)
    })

    it('renders highlight text (is-highlight, no badge) when first_mark has no comment', async () => {
      const { default: BookmarkCell } = await import('~~/app/components/Collection/BookmarkCell.vue')
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: makeBookmark({ first_mark: { comment: '', content: '', source: 'quoted' } }) }
      })
      expect(wrapper.find('.article-owner-note').classes()).toContain('is-highlight')
      expect(wrapper.find('.article-owner-note-text').text()).toBe('quoted')
      expect(wrapper.find('.article-owner-note-badge').exists()).toBe(false)
    })

    it('renders no snippet block when first_mark is null', async () => {
      const { default: BookmarkCell } = await import('~~/app/components/Collection/BookmarkCell.vue')
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: makeBookmark({ first_mark: null }) }
      })
      expect(wrapper.find('.article-owner-note').exists()).toBe(false)
    })

    it('renders no snippet block when first_mark has neither comment nor highlight', async () => {
      const { default: BookmarkCell } = await import('~~/app/components/Collection/BookmarkCell.vue')
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: makeBookmark({ first_mark: { comment: '', content: '', source: '' } }) }
      })
      expect(wrapper.find('.article-owner-note').exists()).toBe(false)
    })
  })

  describe('navigation target', () => {
    it('links to /b/{bookmark_uuid} when present', async () => {
      const { default: BookmarkCell } = await import('~~/app/components/Collection/BookmarkCell.vue')
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: makeBookmark({ bookmark_uuid: 'abc' }) }
      })
      expect(wrapper.find('.collection-article-row').attributes('to')).toBe('/b/abc')
    })

    it('falls back to # when bookmark_uuid is absent', async () => {
      const { default: BookmarkCell } = await import('~~/app/components/Collection/BookmarkCell.vue')
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: makeBookmark({ bookmark_uuid: undefined }) }
      })
      expect(wrapper.find('.collection-article-row').attributes('to')).toBe('#')
    })
  })
})
