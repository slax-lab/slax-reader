// composables/bookmark/useArticle.ts 单测 —— 第五期 Sprint G
// 覆盖：useArticleDetail 各 computed（title alias_title 优先 / fallback no_title） /
//      bookmarkId / shareCode / allowStarred / allowTagged / isStarred
import { ref } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockUseI18n } = vi.hoisted(() => ({
  mockUseI18n: vi.fn(() => ({ t: (key: string) => `i18n:${key}`, locale: { value: 'en' } }))
}))

mockNuxtImport('useI18n', () => mockUseI18n)
mockNuxtImport('isBookmarkDetail', () => (d: unknown) => !!(d && (d as Record<string, unknown>).bookmark_id))
mockNuxtImport('isShareBookmarkDetail', () => (d: unknown) => !!(d && (d as Record<string, unknown>).share_info))
mockNuxtImport('useBookmarkArticleRelative', () => () => ({
  allowAction: ref(true),
  bookmarkUserId: ref(42)
}))

import { useArticleDetail } from '~~/app/composables/bookmark/useArticle'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('composables/bookmark/useArticle', () => {
  describe('useArticleDetail', () => {
    it('BookmarkDetail：title 优先 alias_title', () => {
      const detail = ref({ bookmark_id: 1, alias_title: 'A', title: 'B', starred: 'star', trashed_at: null })
      const r = useArticleDetail(detail as never)
      expect(r.title.value).toBe('A')
    })

    it('BookmarkDetail：alias_title 空时 fallback title', () => {
      const detail = ref({ bookmark_id: 1, alias_title: '', title: 'B', starred: 'star', trashed_at: null })
      const r = useArticleDetail(detail as never)
      expect(r.title.value).toBe('B')
    })

    it('两者都空：fallback i18n no_title', () => {
      const detail = ref({ bookmark_id: 1, alias_title: '', title: '', starred: 'unstar', trashed_at: null })
      const r = useArticleDetail(detail as never)
      expect(r.title.value).toBe('i18n:component.bookmark_article.no_title')
    })

    it('ShareBookmarkDetail：title 直接用 detail.title（不读 alias_title）', () => {
      const detail = ref({ share_info: { share_code: 'sc' }, title: 'Shared' })
      const r = useArticleDetail(detail as never)
      expect(r.title.value).toBe('Shared')
    })

    it('bookmarkId / shareCode：BookmarkDetail 路径', () => {
      const detail = ref({ bookmark_id: 7, alias_title: '', title: 'B', starred: 'unstar', trashed_at: null })
      const r = useArticleDetail(detail as never)
      expect(r.bookmarkId).toBe(7)
      expect(r.shareCode).toBeUndefined()
    })

    it('bookmarkId / shareCode：ShareBookmarkDetail 路径', () => {
      const detail = ref({ share_info: { share_code: 'CODE' }, title: 'X' })
      const r = useArticleDetail(detail as never)
      expect(r.bookmarkId).toBeUndefined()
      expect(r.shareCode).toBe('CODE')
    })

    it('allowStarred / allowTagged：trashed_at 存在时返 false', () => {
      const detail = ref({ bookmark_id: 1, alias_title: '', title: 'B', starred: 'unstar', trashed_at: '2026-01-01' })
      const r = useArticleDetail(detail as never)
      expect(r.allowStarred.value).toBe(false)
      expect(r.allowTagged.value).toBe(false)
    })

    it('isStarred：starred=star → true', () => {
      const detail = ref({ bookmark_id: 1, alias_title: '', title: 'B', starred: 'star', trashed_at: null })
      const r = useArticleDetail(detail as never)
      expect(r.isStarred.value).toBe(true)
    })
  })
})
