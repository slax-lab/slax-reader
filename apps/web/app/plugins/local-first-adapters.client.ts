// 向共享组件 provide LF adapter
// 工厂惰性，各自门控
import { haveRequestToken } from '~/utils/request'

import { useLocalBookmarks } from '@/composables/bookmark/useLocalBookmarks'
import { isLocalFirstEnabled } from '@/composables/useLocalFirst'
import { useLocalNotifications } from '@/composables/useLocalNotifications'
import type { UserNotificationMessageItem } from '@commons/types/interface'
import { type LocalFirstAdapter, LocalFirstAdapterKey } from '~/composables/local-first/injection'
import type { ComputedRef, Ref } from 'vue'

export default defineNuxtPlugin(nuxtApp => {
  const adapter: LocalFirstAdapter = {
    // BookmarkCell：token + LF
    bookmarkActions: () => (haveRequestToken() && isLocalFirstEnabled() ? useLocalBookmarks() : null),

    // BookmarkTags：uuid + LF
    bookmarkTagSource: uuid => {
      // 别 gate 空 uuid：返回 null 会退回 REST，
      // 之后重建本地源会让 useQuery 脱离 setup 崩。
      if (!isLocalFirstEnabled()) return null
      const local = useLocalBookmarks()
      const bm = local.watchBookmarkTags(uuid)
      const all = local.watchUserTags()
      return {
        tags: bm.tags,
        isLoading: bm.isLoading,
        add: (bookmarkUuid: string, tagUuid: string) => local.addBookmarkTag(bookmarkUuid, tagUuid),
        remove: (bookmarkUuid: string, tagUuid: string) => local.removeBookmarkTag(bookmarkUuid, tagUuid),
        setTags: (bookmarkUuid: string, tagUuids: string[]) => local.setTags(bookmarkUuid, tagUuids),
        userTags: all.tags,
        createUserTag: (tagName: string) => local.createUserTag(tagName)
      }
    },

    // 列表卡片上的标签写操作：不带 useQuery，每张卡都能用
    bookmarkTagActions: () => {
      if (!haveRequestToken() || !isLocalFirstEnabled()) return null
      const local = useLocalBookmarks()
      return {
        setTags: (bookmarkUuid: string, tagUuids: string[]) => local.setTags(bookmarkUuid, tagUuids),
        add: (bookmarkUuid: string, tagUuid: string) => local.addBookmarkTag(bookmarkUuid, tagUuid),
        remove: (bookmarkUuid: string, tagUuid: string) => local.removeBookmarkTag(bookmarkUuid, tagUuid),
        createUserTag: (tagName: string) => local.createUserTag(tagName)
      }
    },

    // 标签筛选页 “+” 的候选词（useQuery，须在 setup 调用一次）
    bookmarkListTagSource: () => {
      if (!haveRequestToken() || !isLocalFirstEnabled()) return null
      const local = useLocalBookmarks()
      return {
        candidates: (tagIds: Ref<string[]>) => local.watchCandidateTags(tagIds).candidates
      }
    },

    // TagsHeader：token + LF（独立工厂）
    userTagSource: () => {
      if (!haveRequestToken() || !isLocalFirstEnabled()) return null
      const local = useLocalBookmarks()
      const all = local.watchUserTags()
      return {
        tags: all.tags,
        create: (tagName: string) => local.createUserTag(tagName)
      }
    },

    // UserNotification：仅 LF，恒 rest
    notificationRuntime: () => {
      if (!isLocalFirstEnabled()) return { feed: null, unreadTransport: 'rest' }
      const ln = useLocalNotifications()
      return {
        feed: {
          unreadCount: ln.watchUnreadCount().unreadCount,
          // 边界 cast，本地形态
          items: ln.watchList(50).items as unknown as ComputedRef<UserNotificationMessageItem[]>,
          markAllRead: () => ln.markAllRead()
        },
        unreadTransport: 'rest'
      }
    }
  }

  nuxtApp.vueApp.provide(LocalFirstAdapterKey, adapter)
})
