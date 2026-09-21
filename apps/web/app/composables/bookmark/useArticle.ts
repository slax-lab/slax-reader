import { computed } from 'vue'

import { RESTMethodPath } from '@commons/types/const'

export const useArticleDetail = (detail: Ref<BookmarkArticleDetail>) => {
  const { t } = useI18n()

  const title = computed(
    () =>
      (isBookmarkDetail(detail.value) || isSnapshotBookmarkDetail(detail.value) ? detail.value.alias_title || detail.value.title : detail.value.title) ||
      t('component.bookmark_article.no_title')
  )

  const { allowAction, bookmarkUserId } = useBookmarkArticleRelative(detail)
  const allowStarred = computed(() => {
    return isBookmarkDetail(detail.value) && !detail.value.trashed_at
  })

  const allowTagged = computed(() => {
    if (isBookmarkDetail(detail.value)) return !detail.value.trashed_at
    // 公开快照页 /b/[id]：仅文章作者本人（owner）可增删标签
    if (isSnapshotBookmarkDetail(detail.value)) return allowAction.value
    return false
  })

  const isStarred = computed(() => {
    return isBookmarkDetail(detail.value) && detail.value.starred === 'star'
  })

  const bookmarkId = isBookmarkDetail(detail.value) ? detail.value.bookmark_id : undefined
  const shareCode = isShareBookmarkDetail(detail.value) ? detail.value.share_info.share_code : undefined
  // 公开快照页 /b/[id]：用 bookmark_uuid（后端 bookmark_uid）读写 marks
  // 基础仓类型中无快照分支，bookmark_uuid 由 fork 仓（slax-reader）的 SnapshotBookmarkDetail 提供
  const bookmarkUid = isSnapshotBookmarkDetail(detail.value) ? (detail.value as { bookmark_uuid?: string }).bookmark_uuid : undefined

  // updateStarred 用 computed 包裹，确保 detail 加载后能正确返回函数而非 undefined
  const updateStarred = computed(() => {
    if (!isBookmarkDetail(detail.value)) return undefined
    return async (isStar: boolean) => {
      if (!isBookmarkDetail(detail.value)) return
      const bid = detail.value.bookmark_id
      if (!bid) return
      const status = !isStar ? 'unstar' : 'star'
      await request().post<{ bookmark_id: number; status: string }>({
        url: RESTMethodPath.BOOKMARK_STAR,
        body: { bookmark_id: bid, status }
      })
      detail.value.starred = status
      detail.value = JSON.parse(JSON.stringify(detail.value))
    }
  })

  return {
    bookmarkId,
    shareCode,
    bookmarkUid,
    title,
    isStarred,
    allowStarred,
    allowAction,
    allowTagged,
    bookmarkUserId,
    updateStarred
  }
}

export const useStar = () => {}
