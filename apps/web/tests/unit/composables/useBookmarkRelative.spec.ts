import { ref } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'

// useUserStore from upstream layer
vi.mock('~/stores/user', () => ({
  useUserStore: vi.fn(() => ({ userInfo: { userId: 42, email: 'test@example.com' } }))
}))

// showFeedbackModal from upstream layer
vi.mock('~/components/Modal', () => ({
  showFeedbackModal: vi.fn()
}))

// analyticsLog auto-import
const { analyticsLogMock } = vi.hoisted(() => ({ analyticsLogMock: vi.fn() }))
mockNuxtImport('analyticsLog', () => analyticsLogMock)

// useTrackMetric is imported via relative path in useBookmarkRelative.ts — must use vi.mock
// (mockNuxtImport only intercepts Nuxt auto-import virtual module, not relative imports)
const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }))
vi.mock('~~/app/composables/useTrackMetric', () => ({
  useTrackMetric: () => ({ track: trackMock })
}))

describe('useBookmarkRelative', () => {
  describe('type guards', () => {
    it('isBookmarkDetail returns true for bookmark with bookmark_id + starred + archived', async () => {
      const { isBookmarkDetail } = await import('~~/app/composables/useBookmarkRelative')
      const detail = { bookmark_id: 1, starred: false, archived: false }
      expect(isBookmarkDetail(detail as any)).toBe(true)
    })

    it('isShareBookmarkDetail returns true for detail with share_info', async () => {
      const { isShareBookmarkDetail } = await import('~~/app/composables/useBookmarkRelative')
      const detail = { share_info: { allow_action: true } }
      expect(isShareBookmarkDetail(detail as any)).toBe(true)
    })

    it('isCollectionBookmarkDetail returns true for detail with collection_info', async () => {
      const { isCollectionBookmarkDetail } = await import('~~/app/composables/useBookmarkRelative')
      const detail = { collection_info: { allow_action: true, owner_id: 1 } }
      expect(isCollectionBookmarkDetail(detail as any)).toBe(true)
    })

    it('isSnapshotBookmarkDetail returns true for detail with role', async () => {
      const { isSnapshotBookmarkDetail } = await import('~~/app/composables/useBookmarkRelative')
      const detail = { role: 'owner', bookmark_uuid: 'u1', user_id: 42 }
      expect(isSnapshotBookmarkDetail(detail as any)).toBe(true)
    })

    // 后端若在 /content/meta 补下发 collection_info，快照仍须判为快照
    it('snapshot detail carrying collection_info is not misread as collection', async () => {
      const { isSnapshotBookmarkDetail, isCollectionBookmarkDetail } = await import('~~/app/composables/useBookmarkRelative')
      const detail = { role: 'visitor', bookmark_uuid: 'u1', user_id: 42, collection_info: { allow_action: true, owner_id: 42 } }
      expect(isSnapshotBookmarkDetail(detail as any)).toBe(true)
      expect(isCollectionBookmarkDetail(detail as any)).toBe(false)
    })
  })

  describe('useBookmarkArticleRelative', () => {
    it('allowAction is true for BookmarkDetail', async () => {
      const { useBookmarkArticleRelative } = await import('~~/app/composables/useBookmarkRelative')
      const detail = ref({ bookmark_id: 1, starred: false, archived: false } as any)
      const { allowAction } = useBookmarkArticleRelative(detail)
      expect(allowAction.value).toBe(true)
    })

    it('allowAction is true for share detail when allow_action is true', async () => {
      const { useBookmarkArticleRelative } = await import('~~/app/composables/useBookmarkRelative')
      const detail = ref({ share_info: { allow_action: true }, user_id: 99 } as any)
      const { allowAction } = useBookmarkArticleRelative(detail)
      expect(allowAction.value).toBe(true)
    })

    it('allowAction is false for share detail when allow_action false and different user', async () => {
      const { useBookmarkArticleRelative } = await import('~~/app/composables/useBookmarkRelative')
      const detail = ref({ share_info: { allow_action: false }, user_id: 99 } as any)
      const { allowAction } = useBookmarkArticleRelative(detail)
      expect(allowAction.value).toBe(false)
    })

    it('bookmarkUserId returns bookmark user_id for BookmarkDetail', async () => {
      const { useBookmarkArticleRelative } = await import('~~/app/composables/useBookmarkRelative')
      const detail = ref({ bookmark_id: 1, starred: false, archived: false, user_id: 7 } as any)
      const { bookmarkUserId } = useBookmarkArticleRelative(detail)
      expect(bookmarkUserId.value).toBe(7)
    })

    it('bookmarkUserId returns collection owner_id for collection detail', async () => {
      const { useBookmarkArticleRelative } = await import('~~/app/composables/useBookmarkRelative')
      const detail = ref({ collection_info: { allow_action: true, owner_id: 55 } } as any)
      const { bookmarkUserId } = useBookmarkArticleRelative(detail)
      expect(bookmarkUserId.value).toBe(55)
    })

    it('bookmarkUserId returns 0 for unknown detail type', async () => {
      const { useBookmarkArticleRelative } = await import('~~/app/composables/useBookmarkRelative')
      const detail = ref({} as any)
      const { bookmarkUserId } = useBookmarkArticleRelative(detail)
      expect(bookmarkUserId.value).toBe(0)
    })

    it('bookmarkUserId returns user_id for share detail', async () => {
      const { useBookmarkArticleRelative } = await import('~~/app/composables/useBookmarkRelative')
      const detail = ref({ share_info: { allow_action: true }, user_id: 77 } as any)
      const { bookmarkUserId } = useBookmarkArticleRelative(detail)
      expect(bookmarkUserId.value).toBe(77)
    })
  })

  describe('useLogBookmark', () => {
    it('logs bookmark_view with share mode for Share type', async () => {
      analyticsLogMock.mockClear()
      const { useLogBookmark, BookmarkType } = await import('~~/app/composables/useBookmarkRelative')
      useLogBookmark({ type: BookmarkType.Share, title: 'T', shareCode: 'abc' })
      expect(analyticsLogMock).toHaveBeenCalledWith({ event: 'bookmark_view', id: 'abc', mode: 'snapshot' })
    })

    it('logs bookmark_view with bmId for Normal type', async () => {
      analyticsLogMock.mockClear()
      const { useLogBookmark, BookmarkType } = await import('~~/app/composables/useBookmarkRelative')
      useLogBookmark({ type: BookmarkType.Normal, title: 'T', bmId: 123 })
      expect(analyticsLogMock).toHaveBeenCalledWith({ event: 'bookmark_view', id: '123', mode: 'snapshot' })
    })

    it('logs bookmark_view with collection code for Collection type', async () => {
      analyticsLogMock.mockClear()
      const { useLogBookmark, BookmarkType } = await import('~~/app/composables/useBookmarkRelative')
      useLogBookmark({ type: BookmarkType.Collection, title: 'T', collection: { code: 'col1', cbId: 1 } })
      expect(analyticsLogMock).toHaveBeenCalledWith({ event: 'bookmark_view', id: 'col1', mode: 'snapshot' })
    })
  })

  describe('logAnalyzed', () => {
    it('calls track("ai_summary")', async () => {
      trackMock.mockClear()
      const { logAnalyzed, BookmarkType } = await import('~~/app/composables/useBookmarkRelative')
      logAnalyzed({ type: BookmarkType.Normal, title: 'T', bmId: 1 }, 42)
      expect(trackMock).toHaveBeenCalledWith('ai_summary')
    })
  })

  describe('showFeedbackView', () => {
    it('calls showFeedbackModal with Normal bookmark params', async () => {
      const { showFeedbackModal } = await import('~/components/Modal')
      vi.mocked(showFeedbackModal).mockClear()
      const { showFeedbackView, BookmarkType } = await import('~~/app/composables/useBookmarkRelative')
      showFeedbackView({ type: BookmarkType.Normal, title: 'My Article', bmId: 99 }, 'spam')
      expect(showFeedbackModal).toHaveBeenCalledWith(expect.objectContaining({ reportType: 'spam', title: 'My Article', params: expect.objectContaining({ bookmark_id: 99 }) }))
    })

    it('calls showFeedbackModal with Share bookmark params', async () => {
      const { showFeedbackModal } = await import('~/components/Modal')
      vi.mocked(showFeedbackModal).mockClear()
      const { showFeedbackView, BookmarkType } = await import('~~/app/composables/useBookmarkRelative')
      showFeedbackView({ type: BookmarkType.Share, title: 'Shared', shareCode: 'xyz' }, 'copyright')
      expect(showFeedbackModal).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ share_code: 'xyz' }) }))
    })

    it('calls showFeedbackModal with Collection bookmark params', async () => {
      const { showFeedbackModal } = await import('~/components/Modal')
      vi.mocked(showFeedbackModal).mockClear()
      const { showFeedbackView, BookmarkType } = await import('~~/app/composables/useBookmarkRelative')
      showFeedbackView({ type: BookmarkType.Collection, title: 'Col', collection: { code: 'col1', cbId: 99 } }, 'spam')
      expect(showFeedbackModal).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ cb_id: 99, collection_code: 'col1' }) }))
    })
  })

  describe('allowAction — collection detail', () => {
    it('allowAction is true for collection detail when allow_action is true', async () => {
      const { useBookmarkArticleRelative } = await import('~~/app/composables/useBookmarkRelative')
      const { ref } = await import('vue')
      const detail = ref({ collection_info: { allow_action: true, owner_id: 99 } } as any)
      const { allowAction } = useBookmarkArticleRelative(detail)
      expect(allowAction.value).toBe(true)
    })

    it('allowAction is true for collection detail when owner_id matches userId', async () => {
      const { useBookmarkArticleRelative } = await import('~~/app/composables/useBookmarkRelative')
      const { ref } = await import('vue')
      // useUserStore mock returns userId: 42
      const detail = ref({ collection_info: { allow_action: false, owner_id: 42 } } as any)
      const { allowAction } = useBookmarkArticleRelative(detail)
      expect(allowAction.value).toBe(true)
    })

    it('allowAction is false for collection detail when allow_action false and different owner', async () => {
      const { useBookmarkArticleRelative } = await import('~~/app/composables/useBookmarkRelative')
      const { ref } = await import('vue')
      const detail = ref({ collection_info: { allow_action: false, owner_id: 99 } } as any)
      const { allowAction } = useBookmarkArticleRelative(detail)
      expect(allowAction.value).toBe(false)
    })
  })
})
