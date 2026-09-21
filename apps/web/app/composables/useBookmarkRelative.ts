import { useTrackMetric } from './useTrackMetric'
import { type BookmarkDetail, type CollectionBookmarkDetail, type ShareBookmarkDetail, type SnapshotBookmarkDetail } from '@commons/types/interface'
import { showFeedbackModal } from '~/components/Modal'
import { DESIGN_ICONS, type DesignIcon } from '~/constants/designIcons'
import { useUserStore } from '~/stores/user'

export enum BookmarkType {
  Normal = 'normal',
  Share = 'share',
  Collection = 'collection',
  // /b/[id] 用 bookmark_uid 调后端
  Snapshot = 'snapshot'
}

export type BookmarkTypeOptions =
  | {
      type: BookmarkType.Normal
      title: string
      bmId: number
    }
  | {
      type: BookmarkType.Share
      title: string
      shareCode: string
    }
  | {
      type: BookmarkType.Collection
      title: string
      collection: {
        code: string
        cbId: number
      }
    }
  | {
      type: BookmarkType.Snapshot
      title: string
      bookmarkUid: string
      // 原网页地址，反馈 href 指向原文
      targetUrl?: string
    }

// 详情类型已迁移至 types-pro
export type BookmarkArticleDetail = BookmarkDetail | ShareBookmarkDetail | CollectionBookmarkDetail | SnapshotBookmarkDetail

export const isBookmarkDetail = (detail: BookmarkArticleDetail): detail is BookmarkDetail => 'bookmark_id' in detail && 'starred' in detail && 'archived' in detail
export const isShareBookmarkDetail = (detail: BookmarkArticleDetail): detail is ShareBookmarkDetail => 'share_info' in detail
// 快照详情也可能带 collection_info，故用 role 区分（仅快照有）
export const isCollectionBookmarkDetail = (detail: BookmarkArticleDetail): detail is CollectionBookmarkDetail => 'collection_info' in detail && !('role' in detail)
export const isSnapshotBookmarkDetail = (detail: BookmarkArticleDetail): detail is SnapshotBookmarkDetail =>
  !('bookmark_id' in detail) && !('share_info' in detail) && 'role' in detail

export const BookmarkTabTypes = ['inbox', 'starred', 'topics', 'highlights', 'archive']

// 覆盖 TabIcons，加 collections
export const TabIcons: Record<string, DesignIcon> = {
  inbox: DESIGN_ICONS.inbox,
  starred: {
    viewBox: '0 0 24 24',
    markup: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'
  },
  topics: DESIGN_ICONS.topics,
  collections: {
    viewBox: '0 0 24 24',
    markup: '<path d="M12 2l10 5-10 5L2 7l10-5z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/>'
  },
  highlights: DESIGN_ICONS.pencil,
  archive: DESIGN_ICONS.archive
}

export const showFeedbackView = (options: BookmarkTypeOptions, type: string) => {
  const href = `${window.location.origin}${window.location.pathname}`
  const email = useUserStore().userInfo?.email

  if (options.type === BookmarkType.Normal) {
    showFeedbackModal({
      reportType: type,
      title: options.title,
      href,
      email: email || '',
      params: {
        bookmark_id: options.bmId,
        entry_point: 'bookmark_detail',
        target_url: href
      }
    })
  } else if (options.type === BookmarkType.Share) {
    showFeedbackModal({
      reportType: type,
      title: options.title,
      href,
      email: email || '',
      params: {
        share_code: options.shareCode,
        entry_point: 'share',
        target_url: href
      }
    })
  } else if (options.type === BookmarkType.Collection) {
    showFeedbackModal({
      reportType: type,
      title: options.title,
      href,
      email: email || '',
      params: {
        cb_id: options.collection.cbId,
        collection_code: options.collection.code,
        entry_point: 'collection',
        target_url: href
      }
    })
  } else if (options.type === BookmarkType.Snapshot) {
    // href 指向原网页，缺失回退当前页
    showFeedbackModal({
      reportType: type,
      title: options.title,
      href: options.targetUrl || href,
      email: email || '',
      params: {
        bookmark_uuid: options.bookmarkUid,
        entry_point: 'bookmark_detail',
        target_url: href
      }
    })
  }
}

export const useBookmarkArticleRelative = (detail: Ref<BookmarkArticleDetail>) => {
  const allowAction = computed(() => {
    if (isBookmarkDetail(detail.value)) {
      return true
    }

    const userId = useUserStore().userInfo?.userId

    if ('share_info' in detail.value && (detail.value.share_info.allow_action || detail.value.user_id === userId)) {
      return true
    }

    // 快照页的 collection_info 可选，需先判存在再取权限
    const collectionInfo = 'collection_info' in detail.value ? detail.value.collection_info : undefined
    if (collectionInfo && (collectionInfo.allow_action || collectionInfo.owner_id === userId)) {
      return true
    }

    // /b/[id]：仅 owner 可写（Phase A）
    if (isSnapshotBookmarkDetail(detail.value) && !!userId && detail.value.user_id === userId) {
      return true
    }

    return false
  })

  const bookmarkUserId = computed(() => {
    if (isBookmarkDetail(detail.value)) {
      return detail.value.user_id
    }

    if ('share_info' in detail.value) {
      return detail.value.user_id
    }

    // 快照页归属以 user_id 为准，先于 collection_info 判定
    if (isSnapshotBookmarkDetail(detail.value)) {
      return detail.value.user_id ?? 0
    }

    if (isCollectionBookmarkDetail(detail.value)) {
      return detail.value.collection_info.owner_id
    }

    return 0
  })

  return {
    allowAction,
    bookmarkUserId
  }
}

export const logAnalyzed = (_options: BookmarkTypeOptions, _userId: number) => {
  const { track } = useTrackMetric()
  track('ai_summary')
}

export const logChat = (_options: BookmarkTypeOptions, _userId: number) => {}

export const useLogBookmark = (options: BookmarkTypeOptions) => {
  if (options.type === BookmarkType.Share) {
    analyticsLog({
      event: 'bookmark_view',
      id: options.shareCode,
      mode: 'snapshot'
    })
  } else if (options.type === BookmarkType.Normal) {
    analyticsLog({
      event: 'bookmark_view',
      id: `${options.bmId}`,
      mode: 'snapshot'
    })
  } else if (options.type === BookmarkType.Collection) {
    analyticsLog({
      event: 'bookmark_view',
      id: options.collection.code,
      mode: 'snapshot'
    })
  }
}
