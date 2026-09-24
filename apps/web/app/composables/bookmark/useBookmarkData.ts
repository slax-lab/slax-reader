// 覆盖 core useBookmarkData：inbox/archive/starred/topics(选tag) 走 PowerSync 本地库，
// 其余走 REST；未登录或无 PowerSync 整体回退 REST。highlights 暂走 REST。
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, toValue, watch } from 'vue'

import { bookmarkMatchesSourceDomain } from '~/utils/bookmarkSource'
import type { ChannelMessageData } from '~/utils/channel'

import { useLocalBookmarks } from '@/composables/bookmark/useLocalBookmarks'
import { useLocalCollections } from '@/composables/bookmark/useLocalCollections'
import { useLocalMarks } from '@/composables/bookmark/useLocalMarks'
import type { BookmarkItem, BookmarkTag } from '@commons/frontend-types/models'
import { isClient } from '@commons/frontend-utils/is'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { HighlightItem } from '@slax-reader/contracts/interface'
import { useDebounceFn, useEventListener, useInfiniteScroll } from '@vueuse/core'
import type { useBookmarkFilter } from '~/composables/bookmark/useBookmarkFilter'
import type { Ref } from 'vue'

type BookmarkFilter = ReturnType<typeof useBookmarkFilter>
type GroupedItem = { type: 'group'; label: string; key: string } | { type: 'bookmark'; bookmark: BookmarkItem; index: number }

// trashed 不在本地 tab：已删书签不同步到本地库，
// 列表走 REST，删除写操作仍走本地 setTrashed。
const LOCAL_TABS = ['inbox', 'archive', 'starred', 'untagged']

export const useBookmarkData = (
  filter: BookmarkFilter,
  searchText: Ref<string>,
  activeCollectionCode?: Ref<string | null | undefined>,
  activeCollectionId?: Ref<string | null | undefined>,
  sourceDomain?: Ref<string | null | undefined>,
  visible?: Ref<boolean>
) => {
  const { t, locale } = useI18n()
  const { $powersync } = useNuxtApp()

  // REST 列表（非 local tab，分页 push）
  const restBookmarks = ref<BookmarkItem[]>([])
  const restHighlights = ref<HighlightItem[]>([])
  // REST 加载态，仅非 local tab 用
  const restLoading = ref(false)
  const ending = ref(false)
  const page = ref(1)
  const isTransitioning = ref(false)
  const isFirstLoad = ref(true)
  const isActivated = ref(true)

  // local-first：客户端 + 已登录 + PowerSync 就绪
  const canUseLocal = isClient && haveRequestToken() && isLocalFirstEnabled() && !!$powersync
  const local = canUseLocal ? useLocalBookmarks() : null
  // flag 关时不建，highlights 回退 REST
  const localMarks = canUseLocal && isHighlightLocalFirstEnabled() ? useLocalMarks() : null

  const localCollections = canUseLocal ? useLocalCollections() : null

  const isLocalBookmarkTab = computed(
    () => !!local && (LOCAL_TABS.includes(filter.filterStatus.value) || (filter.filterStatus.value === 'topics' && filter.filterTopicIds.value.length > 0))
  )
  const isLocalHighlightTab = computed(() => !!localMarks && filter.filterStatus.value === 'highlights')
  const activeInboxCollectionCode = computed(() => (filter.filterStatus.value === 'inbox' && !searchText.value ? (toValue(activeCollectionCode) ?? undefined) : undefined))
  const isLocalCollectionTab = computed(() => !!localCollections && !!activeInboxCollectionCode.value)
  const isRestCollectionTab = computed(() => !localCollections && !!activeInboxCollectionCode.value && !!toValue(activeCollectionId))
  const useLocalForTab = (tab: string) =>
    !!local && (LOCAL_TABS.includes(tab) || (isHighlightLocalFirstEnabled() && tab === 'highlights') || (tab === 'topics' && filter.filterTopicIds.value.length > 0))

  // 响应式本地查询：tab/tagId 变化自动重查
  const localList = local
    ? local.watchList(
        computed(() => filter.filterStatus.value),
        computed(() => (filter.filterStatus.value === 'topics' ? filter.filterTopicIds.value : undefined))
      )
    : null
  // 词表只建一次（useQuery），给卡片把 metadata.tags 的 uuid 换成名字
  const localUserTags = local ? local.watchUserTags() : null
  const withTags = (items: BookmarkItem[]): BookmarkItem[] => {
    if (!localUserTags) return items
    const byId = new Map(localUserTags.tags.value.map(t => [String(t.id), t]))
    return items.map(item => {
      const ids = item.tag_ids ?? []
      const tags = ids.map(id => byId.get(id)).filter((t): t is BookmarkTag => !!t)
      return { ...item, tags }
    })
  }
  const localHighlights = localMarks ? localMarks.watchHighlights(computed(() => filter.filterStatus.value === 'highlights')) : null
  const localCollectionList = localCollections ? localCollections.watchCollectionBookmarks(activeInboxCollectionCode) : null

  // settling 期间置空，防止闪旧列表
  const bookmarkSettling = ref(false)
  const highlightSettling = ref(false)

  const unfilteredBookmarks = computed<BookmarkItem[]>(() => {
    if (bookmarkSettling.value) return []
    return isLocalCollectionTab.value ? withTags(localCollectionList!.items.value) : isLocalBookmarkTab.value ? withTags(localList!.items.value) : restBookmarks.value
  })
  const bookmarks = computed<BookmarkItem[]>(() => {
    const domain = toValue(sourceDomain)
    if (filter.filterStatus.value !== 'inbox' || !domain || isLocalCollectionTab.value) return unfilteredBookmarks.value
    return unfilteredBookmarks.value.filter(bookmark => bookmarkMatchesSourceDomain(bookmark, domain))
  })
  const highlights = computed<HighlightItem[]>(() => {
    if (highlightSettling.value) return []
    return isLocalHighlightTab.value ? localHighlights!.highlights.value : restHighlights.value
  })

  // 对外 loading：local tab 取本地 isLoading 或 settling，否则取 REST loading。
  const loading = computed(() => {
    if (isLocalCollectionTab.value) return localCollectionList!.isLoading.value || bookmarkSettling.value
    if (isLocalBookmarkTab.value) return localList!.isLoading.value || bookmarkSettling.value
    if (isLocalHighlightTab.value) return localHighlights!.isLoading.value || highlightSettling.value
    return restLoading.value
  })

  // 切入 local 书签 tab 置 settling，结果刷新后清除
  if (local) {
    watch(
      () => [isLocalBookmarkTab.value, filter.filterStatus.value, filter.filterTopicIds.value.join(',')],
      () => isLocalBookmarkTab.value && (bookmarkSettling.value = true)
    )
    watch(
      () => localList!.items.value,
      () => (bookmarkSettling.value = false)
    )
  }
  if (localCollections) {
    watch(
      () => [isLocalCollectionTab.value, activeInboxCollectionCode.value],
      () => isLocalCollectionTab.value && (bookmarkSettling.value = true)
    )
    watch(
      () => localCollectionList!.items.value,
      () => (bookmarkSettling.value = false)
    )
  }
  // 切入 local 划线 tab 置 settling，结果刷新后清除
  if (localMarks) {
    watch(
      () => isLocalHighlightTab.value,
      () => isLocalHighlightTab.value && (highlightSettling.value = true)
    )
    watch(
      () => localHighlights!.highlights.value,
      () => (highlightSettling.value = false)
    )
  }

  // === 派生计算 ===
  const groupedBookmarks = computed<GroupedItem[]>(() => {
    if (filter.filterStatus.value === 'highlights') return []
    const result: GroupedItem[] = []
    let lastGroup = ''
    // 分组字段对齐排序字段（starred_at/archived_at/created_at）
    // 强制文字列表，分组值不渲染
    const status = filter.filterStatus.value
    const groupDateOf = (b: BookmarkItem) => {
      if (!isLocalBookmarkTab.value) return b.created_at
      if (status === 'starred') return b.starred_at
      if (status === 'archive') return b.archived_at
      if (status === 'inbox') return b.created_at
      return b.updated_at
    }
    bookmarks.value.forEach((bookmark, index) => {
      const dateStr = groupDateOf(bookmark)
      if (dateStr) {
        const date = new Date(dateStr)
        const groupKey = `${date.getFullYear()}-${date.getMonth()}`
        if (groupKey !== lastGroup) {
          result.push({
            type: 'group',
            label: t('page.bookmarks_index.date_group_format', {
              year: date.getFullYear(),
              month: date.getMonth() + 1,
              monthName: date.toLocaleString(locale.value, { month: 'long' })
            }),
            key: groupKey
          })
          lastGroup = groupKey
        }
      }
      result.push({ type: 'bookmark', bookmark, index })
    })
    return result
  })

  const isRefreshLoading = computed(() => restLoading.value && page.value === 1)
  const lastUpdatedText = computed(() => {
    const latest = bookmarks.value[0]?.updated_at
    if (!latest) return ''
    const diff = Date.now() - new Date(latest).getTime()
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    let time: string
    if (mins < 1) time = t('page.bookmarks_index.just_now')
    else if (hours < 1) time = t('page.bookmarks_index.minutes_ago', { n: mins })
    else if (days < 1) time = t('page.bookmarks_index.hours_ago', { n: hours })
    else if (days < 30) time = t('page.bookmarks_index.days_ago', { n: days })
    else if (days < 365) time = t('page.bookmarks_index.months_ago', { n: Math.floor(days / 30) })
    else time = t('page.bookmarks_index.years_ago', { n: Math.floor(days / 365) })
    return t('page.bookmarks_index.last_updated_at', { time })
  })

  const isDataEmpty = computed(() => {
    if (isLocalCollectionTab.value) return bookmarks.value.length === 0
    switch (filter.filterStatus.value) {
      case 'highlights':
        return highlights.value.length === 0
      case 'topics':
        return filter.filterTopicIds.value.length > 0 ? bookmarks.value.length === 0 : false
      case 'collections':
        return filter.filterCollectionId.value ? bookmarks.value.length === 0 : false
      default:
        return bookmarks.value.length === 0
    }
  })

  const showList = computed(() => {
    if (isTransitioning.value) return true
    if (searchText.value) return false
    if (isLocalCollectionTab.value) return bookmarks.value.length > 0
    switch (filter.filterStatus.value) {
      case 'highlights':
        return highlights.value.length > 0
      default:
        return bookmarks.value.length > 0
    }
  })

  // === REST 查询 ===
  const queryBookmarks = async () => {
    const collectionId = isRestCollectionTab.value ? String(toValue(activeCollectionId)) : String(filter.filterCollectionId.value) || ''
    const source = toValue(sourceDomain)
    return await request().get<BookmarkItem[]>({
      url: RESTMethodPath.BOOKMARK_LIST,
      query: {
        page: page.value,
        size: 20,
        filter: isRestCollectionTab.value ? 'collections' : `${filter.filterStatus.value}`,
        topic_ids: filter.filterTopicIds.value.join(','),
        collection_id: collectionId,
        ...(filter.filterStatus.value === 'inbox' && source ? { source } : {})
      }
    })
  }
  const queryHighlights = async () => await request().get<HighlightItem[]>({ url: RESTMethodPath.HIGHLIGHT_LIST, query: { page: page.value, size: 6 } })

  // 每次 reset 递增；请求回来时代数变了就是过期响应，直接丢，不碰 loading/page/ending
  let loadSeq = 0
  const loadData = async <T extends any[]>(query: () => Promise<T | undefined>) => {
    const seq = loadSeq
    restLoading.value = true
    const data = await query()
    if (seq !== loadSeq) return
    restLoading.value = false
    if (!data || data.length < 1) {
      ending.value = true
      return
    }
    page.value += 1
    return data
  }

  const resetBookmarks = () => {
    loadSeq += 1
    restBookmarks.value = []
    restHighlights.value = []
    restLoading.value = false
    ending.value = false
    page.value = 1
    isTransitioning.value = false
    reset()
  }

  const onLoadMore = async () => {
    if (isFirstLoad.value) isFirstLoad.value = false
    const type = filter.filterStatus.value

    if (isLocalCollectionTab.value) {
      ending.value = true
      restLoading.value = false
      return
    }

    // local-first tab 由 useQuery 驱动，无需分页
    if (useLocalForTab(type)) {
      ending.value = true
      restLoading.value = false
      return
    }

    if (restLoading.value || ending.value) return
    if ((type === 'topics' && filter.filterTopicIds.value.length < 1) || (type === 'collections' && filter.filterCollectionId.value < 1)) {
      resetBookmarks()
      ending.value = true
      return
    }
    const topicKey = type === 'topics' ? filter.filterTopicIds.value.join(',') : ''
    if (type === 'highlights') {
      const data = await loadData(queryHighlights)
      type === filter.filterStatus.value && restHighlights.value.push(...(data || []))
    } else {
      const data = await loadData(queryBookmarks)
      type === filter.filterStatus.value && (type !== 'topics' || topicKey === filter.filterTopicIds.value.join(',')) && restBookmarks.value.push(...(data || []))
    }
  }

  const reloadList = () => {
    resetBookmarks()
    onLoadMore()
  }

  if (!local && sourceDomain) {
    watch(sourceDomain, (domain, previousDomain) => {
      if (domain === previousDomain || filter.filterStatus.value !== 'inbox') return
      resetBookmarks()
      onLoadMore()
    })
  }

  const canLoadMoreList = () => (visible?.value ?? true) && !restLoading.value && !ending.value && isActivated.value && !searchText.value
  const { reset } = useInfiniteScroll(isClient ? window : null, () => onLoadMore(), { distance: 100, canLoadMore: canLoadMoreList })
  const resetInfiniteScroll = useDebounceFn(() => reset(), 1000)

  if (isClient) {
    useEventListener(window, 'resize', resetInfiniteScroll)
    if (window.visualViewport) useEventListener(window.visualViewport, 'resize', resetInfiniteScroll)
  }

  onActivated(() => (isActivated.value = true))
  onDeactivated(() => (isActivated.value = false))

  // === cell handlers：local tab 走本地，否则改 REST 数组 ===
  const handleCellArchive = (id: number, archive: boolean) => {
    if (isLocalCollectionTab.value) return
    if (isLocalBookmarkTab.value) {
      local!.setArchive(id as unknown as string, archive)
      return
    }
    if (filter.filterStatus.value === 'inbox' && archive) restBookmarks.value = restBookmarks.value.filter(b => b.id !== id)
    else if (filter.filterStatus.value === 'archive' && !archive) restBookmarks.value = restBookmarks.value.filter(b => b.id !== id)
    else {
      const b = restBookmarks.value.find(b => b.id === id)
      b && (b.archived = archive ? 'archive' : 'inbox')
    }
  }
  const handleCellAliasTitle = (id: number, aliasTitle: string) => {
    if (isLocalCollectionTab.value) return
    if (isLocalBookmarkTab.value) {
      local!.setAliasTitle(id as unknown as string, aliasTitle)
      return
    }
    const b = restBookmarks.value.find(b => b.id === id)
    b && (b.alias_title = aliasTitle)
  }
  const handleCellBookmarkUpdate = (id: number, bookmark: BookmarkItem) => {
    if (isLocalCollectionTab.value) return
    if (isLocalBookmarkTab.value) {
      if (bookmark.starred) local!.setStar(id as unknown as string, bookmark.starred === 'star')
      return
    }
    const index = restBookmarks.value.findIndex(b => b.id === id)
    if (index > -1) restBookmarks.value.splice(index, 1, bookmark)
  }
  const handleDelete = async (id: number) => {
    if (isLocalCollectionTab.value) return
    if (isLocalBookmarkTab.value) {
      local!.setTrashed(id as unknown as string, true)
      return
    }
    isTransitioning.value = true
    restBookmarks.value = restBookmarks.value.filter(b => b.id !== id)
    await nextTick()
    isTransitioning.value = false
  }

  // === 频道同步：local 模式下 computed 自动刷新，无需接管 ===
  const channelMessageHandler = (name: keyof ChannelMessageData, data: Partial<ChannelMessageData>) => {
    if (local) return
    if ((restBookmarks.value.length === 0 && restLoading.value) || !data[name]) return
    if (name === 'archive') {
      const { id, cancel } = data[name]
      if ((!cancel && filter.filterStatus.value === 'inbox') || (cancel && filter.filterStatus.value === 'archive'))
        restBookmarks.value = restBookmarks.value.filter(b => b.id !== id)
      else if ((!cancel && filter.filterStatus.value === 'archive') || (cancel && filter.filterStatus.value === 'inbox')) reloadList()
      else if (filter.filterStatus.value === 'starred') {
        const b = restBookmarks.value.find(b => b.id === id)
        if (b) b.archived = cancel ? 'inbox' : 'archive'
      }
    } else if (name === 'star') {
      const { id, cancel } = data[name]
      if (filter.filterStatus.value === 'starred') reloadList()
      else {
        const b = restBookmarks.value.find(b => b.id === id)
        if (b) b.starred = cancel ? 'unstar' : 'star'
      }
    } else if (name === 'trashed') {
      const { id, trashed } = data[name]
      if (filter.filterStatus.value === 'trashed') {
        if (trashed) restBookmarks.value = restBookmarks.value.filter(b => b.id !== id)
        else reloadList()
      } else if (filter.filterStatus.value === 'inbox') reloadList()
    }
  }

  onMounted(() => addChannelMessageHandler(channelMessageHandler))
  onUnmounted(() => removeChannelMessageHandler(channelMessageHandler))

  return {
    bookmarks,
    highlights,
    loading,
    ending,
    isTransitioning,
    isFirstLoad,
    groupedBookmarks,
    isRefreshLoading,
    lastUpdatedText,
    isDataEmpty,
    showList,
    onLoadMore,
    resetBookmarks,
    reloadList,
    handleCellArchive,
    handleCellAliasTitle,
    handleCellBookmarkUpdate,
    handleDelete
  }
}
