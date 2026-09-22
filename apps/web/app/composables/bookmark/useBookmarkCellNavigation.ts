// BookmarkCell 点击/跳转编排
// 快照走 seam，fork 可覆盖
import { urlHttpString } from '@commons/frontend-utils/string'

import { type BookmarkItem, BookmarkParseStatus } from '@commons/types/interface'
import { showSnapshotStatusModal } from '~/components/Modal'

type ListSection = 'inbox' | 'starred' | 'topics' | 'archive' | 'trash' | 'notifications'

type InteractElement = 'title' | 'orginal' | 'snapshot' | 'source_filter' | 'edit_title' | 'star' | 'archive' | 'trash'

export interface UseBookmarkCellNavigationOptions {
  bookmark: Ref<BookmarkItem>
  isSubscribe: () => boolean
  collectionCode: () => string | undefined
  isDeleting: () => boolean
  isStroking: () => boolean
  isRequesting: () => boolean
  isEditingTitle: () => boolean
}

export function useBookmarkCellNavigation(options: UseBookmarkCellNavigationOptions) {
  const { bookmark, isSubscribe, collectionCode, isDeleting, isStroking, isRequesting, isEditingTitle } = options

  const { t } = useI18n()
  const route = useRoute()

  const getCurrentSection = (): ListSection => {
    const filter = String(route.query.filter || 'inbox')
    const sectionMap: Record<string, ListSection> = {
      inbox: 'inbox',
      starred: 'starred',
      topics: 'topics',
      archive: 'archive',
      trashed: 'trash',
      notifications: 'notifications'
    }
    return sectionMap[filter] || 'inbox'
  }

  const trackListItemInteract = (element: InteractElement) => {
    analyticsLog({
      event: 'bookmark_list_item_interact',
      bookmark_id: bookmark.value.id,
      element,
      section: getCurrentSection()
    })
  }

  const urlString = () => urlHttpString(bookmark.value.target_url)

  const getSnapshotModalTitle = (status: BookmarkParseStatus) => {
    if (status === BookmarkParseStatus.FAILED) {
      return t('component.snapshot_status_modal.failed_title')
    } else {
      return t('component.snapshot_status_modal.pending_title')
    }
  }

  const getSnapshotModalContent = (status: BookmarkParseStatus) => {
    if (status === BookmarkParseStatus.FAILED) {
      return t('component.snapshot_status_modal.failed_content')
    } else {
      return t('component.snapshot_status_modal.pending_content')
    }
  }

  const clickHref = () => {
    if (isRequesting()) {
      return
    }

    trackListItemInteract('orginal')

    window.open(urlString(), '_blank')
  }

  const clickCache = () => {
    if (isRequesting()) {
      return
    }

    trackListItemInteract('snapshot')

    if (bookmark.value.status !== BookmarkParseStatus.SUCCESS) {
      const reminderKey = `snapshot_reminder_disabled_${bookmark.value.status}`
      const isReminderDisabled = localStorage.getItem(reminderKey) === 'true'

      if (!isReminderDisabled) {
        showSnapshotStatusModal({
          status: bookmark.value.status,
          title: getSnapshotModalTitle(bookmark.value.status),
          content: getSnapshotModalContent(bookmark.value.status),
          onConfirm: (dontRemindAgain: boolean) => {
            if (dontRemindAgain) {
              localStorage.setItem(reminderKey, 'true')
            }
            clickHref()
          }
        })
      } else {
        clickHref()
      }
      return
    }

    // 缺标识降级打开原文
    const target = useSlaxRoutes().snapshotRoute(bookmark.value)
    if (!target) {
      clickHref()
      return
    }

    pwaOpen({
      url: target
    })
  }

  const clickTitle = () => {
    if (isDeleting() || isStroking()) {
      return
    }

    trackListItemInteract('title')

    if (isSubscribe()) {
      // 合集直跳 /b/[uuid]，缺则回退
      const uuid = bookmark.value.bookmark_user_uuid
      pwaOpen({
        url: useSlaxRoutes().decorateReaderRoute(uuid ? `/b/${uuid}` : `/c/${collectionCode()}/${bookmark.value.id}`),
        target: '_blank'
      })
      return
    }

    if (bookmark.value.status !== 'success' || bookmark.value.type === 'shortcut') {
      clickHref()
      return
    }

    // 优先跳快照页
    clickCache()
  }

  // 整卡点击：编辑态不触发，复用标题逻辑
  const clickCard = () => {
    if (isEditingTitle() || isRequesting()) {
      return
    }

    clickTitle()
  }

  return {
    clickCard,
    clickTitle,
    clickHref,
    clickCache,
    // 埋点，多处复用
    trackListItemInteract
  }
}
