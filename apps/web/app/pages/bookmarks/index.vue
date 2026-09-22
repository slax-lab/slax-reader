<template>
  <div class="bookmarks-view">
    <div class="fixed left-0 top-0 z-100 h-0px w-full flex-center">
      <Transition name="list-loading">
        <div class="h-30px w-30px translate-y-50px rounded-full bg-surface-solid shadow-md flex-center -mt-30px" v-show="showRefreshLoading">
          <div class="i-svg-spinners:90-ring text-h2 text-accent"></div>
        </div>
      </Transition>
    </div>

    <!-- AddUrlTopModal：由 FAB 触发 -->
    <AddUrlTopModal v-model:show="isShowTopModal" @add-url-success="addUrlSuccess" />

    <!-- FAB：浮动添加按钮 -->
    <BookmarksFab @click="isShowTopModal = true" />

    <BookmarksLayout ref="bookmarksLayout" :search-text="searchText" @search="text => (searchText = text)" @feedback="feedbackClick">
      <template v-slot:sidebar-left>
        <TabsSidebar ref="tabsSidebar" :tabType="searchText ? '' : filterStatus" @change-tab="inboxClick" />
        <!-- fork-only：领取订阅入口 -->
        <div v-if="showReceiveSubscribe" class="sidebar-promo" @click="receiveActivity">
          <img loading="lazy" src="@internal/images/tips-receive-subscribe-cn.png" alt="" v-if="$i18n.locale === 'zh'" />
          <img loading="lazy" src="@internal/images/tips-receive-subscribe-en.png" alt="" v-else />
        </div>
      </template>
      <template v-slot:content-header>
        <!-- 首次同步进度：main 内第一个元素，位于 FeedSwitcher 上方 -->
        <LocalSyncProgress v-if="isFirstSyncing" :percent="syncPercent" :downloaded="syncDownloaded" :total="syncTotal" />

        <ClientOnly>
          <FeedSwitcher
            v-if="canCollections && filterStatus === 'inbox' && !searchText"
            :active-code="activeCollectionCode"
            :collections="subscribedCollections"
            :animate-code="feedAnimateCode"
            :fade-codes="feedFadeCodes"
            @select="selectFeed"
            @animated="onFeedAnimated"
          />
        </ClientOnly>

        <h2 v-if="activeCollection" class="feed-featured-title">
          <span class="feed-featured-meta">
            <span class="feed-featured-name">{{ activeCollection.name }}</span>
            <span class="feed-subscription-meta" :class="{ expired: feedExpired }">
              {{ feedStatusText }}
            </span>
          </span>
          <span class="feed-featured-actions">
            <button class="feed-home-btn" type="button" @click="openCollectionHome">
              {{ $t('page.bookmarks_index.collection_feed.view_home') }}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14" />
                <path d="M13 6l6 6-6 6" />
              </svg>
            </button>
            <button v-if="feedExpired" class="feed-renew-btn" type="button" @click="openCollectionHome">
              {{ $t('page.bookmarks_index.collection_feed.renew') }}
            </button>
          </span>
        </h2>

        <BookmarksContentHeader
          v-else
          :search-text="searchText"
          :filter-status="filterStatus"
          :filter-topic-ids="filterTopicIds"
          :filter-topic-name="filterTopicName"
          :filter-collection-id="filterCollectionId"
          :filter-collection-name="filterCollectionName"
          @back="() => (searchText = '')"
          @search-status-update="status => (isSearching = status)"
          @select-tag="selectTopics"
          @select-untagged="() => inboxClick('untagged')"
          @select-collect="selectCollection"
          @code-update="(code: string) => (filterCollectionCode = code)"
        />
      </template>
      <template v-slot:content-list>
        <!-- fork-only：星标视图顶部合集引导横幅 -->
        <ClientOnly>
          <StarredSharePrompt v-if="filterStatus === 'starred' && !searchText && !activeCollectionCode && !loading" :starred-count="bookmarks.length" />
        </ClientOnly>

        <!-- 切换器：星标/回收站隐藏，强制文字；专栏 feed 也隐藏。归档和收件箱一样可切卡片 -->
        <ListLayoutSwitcher
          v-if="
            !searchText &&
            !activeCollectionCode &&
            !['highlights', 'starred', 'trashed'].includes(filterStatus) &&
            !(filterStatus === 'topics' && filterTopicIds.length < 1) &&
            !(filterStatus === 'collections' && !filterCollectionId) &&
            !(isDataEmpty && !isTransitioning && !sourceFilter)
          "
          v-model="listMode"
          :last-updated-text="lastUpdatedText"
          :show-leading="!!sourceFilter"
          :class="{ 'source-filter-after-feed': !!sourceFilter && subscribedCollections.length > 0 }"
        >
          <template #leading>
            <div v-if="sourceFilter" class="source-filter-tag">
              <span class="source-filter-prefix">{{ $t('page.bookmarks_index.source_filter_site') }}:</span>
              <span class="source-filter-label">{{ sourceFilter.label }}</span>
              <button class="source-filter-close" type="button" :aria-label="$t('common.operate.cancel')" @click="clearSourceFilter">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          </template>
        </ListLayoutSwitcher>

        <!-- 专栏已过期/已关闭：锁图标空状态 -->
        <div v-if="feedBlocked" class="feed-closed-view">
          <div class="feed-closed-icon" aria-hidden="true">
            <!-- icon-empty-lock.svg -->
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="10" width="14" height="10" rx="2" />
              <path d="M8,10 L8,7 C8,4.790861 9.790861,3 12,3 C14.209139,3 16,4.790861 16,7 L16,10" />
              <circle cx="12" cy="15" r="1" />
            </svg>
          </div>
          <h3 class="feed-closed-title">{{ feedClosedTitle }}</h3>
          <p class="feed-closed-desc">{{ feedClosedDesc }}</p>
        </div>

        <!-- 专栏 feed：富卡片（标题 + X条划线 + 第一条划线预览 + 作者头像），点击 → /b -->
        <CollectionFeedList v-else-if="activeCollection" :bookmarks="collectionBookmarks" :author-avatar="activeOwnerAvatar" :collection-code="activeCollection.code" />

        <!-- key 重建：切换列表不清空，
             复用会残留旧缓存致错位 -->
        <BookmarkListContent
          v-else-if="showList"
          :key="`${filterStatus}:${filterTopicIds.join(',')}:${filterCollectionId}:${activeCollectionCode}:${sourceFilter?.domain || ''}`"
          :filter-status="filterStatus"
          :grouped-bookmarks="groupedBookmarks"
          :highlights="highlights"
          :list-mode="listMode"
          :filter-collection-code="filterCollectionCode"
          @delete="handleDelete"
          @archive-update="handleCellArchive"
          @alias-title-update="handleCellAliasTitle"
          @bookmark-update="handleCellBookmarkUpdate"
          @select-tag="selectTagFromCell"
          @source-filter="applySourceFilter"
        />

        <template v-if="!feedBlocked && !(isTransitioning && isDataEmpty) && !searchText && !isFirstSyncing">
          <!-- 跳转期间按 B 展示 -->
          <BookmarksEmptyState
            v-if="!loading && isDataEmpty"
            :filter-status="filterStatus"
            :is-current-inbox-tab="isCurrentInboxTab"
            :is-first-load="isFirstLoad"
            :inbox-state="inboxState === 'A' ? 'B' : inboxState"
          />
          <ListBottomStatus
            v-else
            :loading="loading"
            :ending="ending"
            :is-refresh-loading="isRefreshLoading"
            :is-in-trash="isInTrash"
            :filter-status="filterStatus"
            :filter-topic-ids="filterTopicIds"
            :filter-collection-id="filterCollectionId"
          />
        </template>
      </template>
    </BookmarksLayout>
  </div>
</template>

<script lang="ts" setup>
definePageMeta({ alias: ['/'] })

import AddUrlTopModal from '~/components/BookmarkList/AddUrlTopModal.vue'
import BookmarkListContent from '~/components/BookmarkList/BookmarkListContent.vue'
import BookmarksContentHeader from '~/components/BookmarkList/BookmarksContentHeader.vue'
import BookmarksEmptyState from '~/components/BookmarkList/BookmarksEmptyState.vue'
import BookmarksFab from '~/components/BookmarkList/BookmarksFab.vue'
import CollectionFeedList from '~/components/BookmarkList/CollectionFeedList.vue'
import FeedSwitcher from '~/components/BookmarkList/FeedSwitcher.vue'
import ListBottomStatus from '~/components/BookmarkList/ListBottomStatus.vue'
import ListLayoutSwitcher from '~/components/BookmarkList/ListLayoutSwitcher.vue'
import LocalSyncProgress from '~/components/BookmarkList/LocalSyncProgress.vue'
import StarredSharePrompt from '~/components/BookmarkList/StarredSharePrompt.vue'
import TabsSidebar from '~/components/BookmarkList/TabsSidebar.vue'
import ReceiveSubscribeModal from '~/components/GetSubscribeModal.vue'
import BookmarksLayout from '~/components/Layouts/BookmarksLayout.vue'

import { useBookmarkData } from '@/composables/bookmark/useBookmarkData'
import { type CollectionBookmarkItem, type LocalCollectionItem, useLocalCollections } from '@/composables/bookmark/useLocalCollections'
import { useOwnerInfo } from '@/composables/bookmark/useOwnerInfo'
import type { BookmarkTag, UserInfo } from '@commons/contracts/interface'
import { RESTMethodPath } from '@commons/contracts/const'
import { showFeedbackModal } from '~/components/Modal'
import Toast from '~/components/Toast'
import { useBookmarkFilter } from '~/composables/bookmark/useBookmarkFilter'
import { useInboxOnboardingState } from '~/composables/bookmark/useInboxOnboardingState'
import { useListLayoutMode } from '~/composables/bookmark/useListLayoutMode'
import { useRefreshIndicator } from '~/composables/bookmark/useRefreshIndicator'
import { useUserStore } from '~/stores/user'

const { t, locale } = useI18n()

defineOptions({
  name: 'bookmarks'
})

useHead({
  titleTemplate: t('common.app.name')
})

const bookmarksLayout = ref<InstanceType<typeof BookmarksLayout>>()
const tabsSidebar = ref<InstanceType<typeof TabsSidebar>>()
const route = useRoute()
const userStore = useUserStore()

const searchText = ref('')
const isSearching = ref(false)
const isShowTopModal = ref(false)

// fork-only：本地 userInfo ref
const userInfo = ref<UserInfo>()

// fork-only：领取订阅，replace 前捕获
const currentActivityId = (route.query.activity_id as string) || 'platform_0527'
const currentActivityType = (route.query.activity_type as string) || 'platform_0527'
const showReceiveSubscribe = ref(false)

// fork-only：进页清洗 activity query。?q=（设置页顶栏的搜索）也在这一次 replace 里读走并去掉：
// 同一 tick 里发两次 replace，vue-router 会取消前一次，activity 参数就留在地址栏了
const initialSearchQuery = typeof route.query.q === 'string' ? route.query.q.trim() : ''
useRouter().replace({ path: route.path, query: { ...route.query, claim: undefined, activity_id: undefined, activity_type: undefined, q: undefined } })

// 筛选状态 + 纯导航 helper
const {
  filterStatus,
  filterTopicIds,
  filterTopicName,
  filterCollectionId,
  filterCollectionCode,
  filterCollectionName,
  isInTrash,
  isCurrentInboxTab,
  applyTopics,
  applyCollection,
  applyTab
} = useBookmarkFilter()

const activeCollectionCode = ref<string | null>(null)
const activeCollectionId = ref<string | null>(null)
const sourceFilter = ref<{ domain: string; label: string } | null>(null)

// 新订阅入场动画目标（来自 ?nc=code）
const rawNc = route.query.nc
const newCollectionCode = ref<string | null>((Array.isArray(rawNc) ? rawNc[0] : rawNc) || null)

// 列表数据层：分页/滚动/派生/同步
const {
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
} = useBookmarkData(
  {
    filterStatus,
    filterTopicIds,
    filterTopicName,
    filterCollectionId,
    filterCollectionCode,
    filterCollectionName,
    isInTrash,
    isCurrentInboxTab,
    applyTopics,
    applyCollection,
    applyTab
  },
  searchText,
  activeCollectionCode,
  activeCollectionId,
  computed(() => sourceFilter.value?.domain)
)

const canCollections = import.meta.client && haveRequestToken()
const { $powersync } = useNuxtApp()
const localCollections = canCollections && isLocalFirstEnabled() && $powersync ? useLocalCollections() : null
const restSubscribedCollections = ref<LocalCollectionItem[]>([])
// REST 路径加载态
const restCollectionsLoading = ref(canCollections && !localCollections)
// 取 isLoading 定动画基线
const subQuery = localCollections ? localCollections.watchSubscribedCollections() : null
const subscribedCollections = subQuery ? subQuery.items : restSubscribedCollections
const subLoading = subQuery?.isLoading
const loadRestCollections = async () => {
  try {
    const rows = await request().get<
      Array<{
        id: number
        code: string
        subscription_end_time: string
        subscribed_at: string
        last_read_at: string
        display_name: string
        description: string
        status: number
        type: number
        updated_at: string
        avatar: string
        cancelled: boolean
      }>
    >({ url: RESTMethodPath.COLLECT_SUBSCRIBED_LIST, query: { page: 1, page_size: 100 } })
    restSubscribedCollections.value = (rows || []).map(item => ({
      id: String(item.id),
      code: item.code,
      name: item.display_name,
      avatar: item.avatar,
      description: item.description,
      owner_id: '',
      type: Number(item.type),
      status: Number(item.status),
      subscription_end_time: item.subscription_end_time,
      subscribed_at: item.subscribed_at,
      is_cancelled: item.cancelled,
      last_read_at: item.last_read_at,
      has_new: false,
      updated_at: item.updated_at
    }))
  } finally {
    restCollectionsLoading.value = false
  }
}
const activeCollection = computed(() => {
  if (filterStatus.value !== 'inbox' || searchText.value) return null
  return subscribedCollections.value.find(c => c.code === activeCollectionCode.value) || null
})

const bookmarkOpenedFrom = useState<'bookmarks' | 'inbox_collection' | 'search_result' | 'direct'>('bookmark-opened-from', () => 'bookmarks')
watch(
  [searchText, () => activeCollection.value?.code, filterStatus],
  ([search, collection, filter]) => {
    bookmarkOpenedFrom.value = search ? 'search_result' : collection || filter === 'collections' ? 'inbox_collection' : 'bookmarks'
  },
  { immediate: true, flush: 'sync' }
)

watch(
  () => activeCollection.value?.code,
  (code, previous) => {
    if (code && code !== previous) eventLog({ event_name: 'collection_opened', properties: { collection_id: code, opened_from: 'inbox' } })
  },
  { immediate: true }
)

// fork-only：订阅列表是否已就位
const subscriptionReady = computed(() => (localCollections ? !subLoading?.value : !restCollectionsLoading.value))
// fork-only：有效订阅数（排除已取消）
const activeSubscribedCount = computed(() => subscribedCollections.value.filter(c => !c.is_cancelled).length)

// inbox 空态三态判断
const { inboxState } = useInboxOnboardingState({
  isCurrentInboxTab,
  subscribedCount: activeSubscribedCount,
  subscriptionReady,
  isDataEmpty,
  isFirstLoad,
  userId: computed(() => userStore.userInfo?.userId)
})

// 状态 A → 跳转 /onboarding
watch(
  inboxState,
  state => {
    if (state === 'A') navigateTo('/onboarding', { replace: true })
  },
  { immediate: true }
)

// fork-only：专栏被取消订阅后切回 inbox
watch(
  () => subscribedCollections.value.map(c => c.code),
  codes => {
    if (!subscriptionReady.value) return
    if (activeCollectionCode.value && !codes.includes(activeCollectionCode.value)) selectFeed(null)
  }
)

// snippet 头像统一用主人头像
// local-first 未命中回默认
const ownerInfo = useOwnerInfo()
watch(
  () => activeCollection.value?.code,
  code => ownerInfo.ensureLoaded(code || undefined),
  { immediate: true }
)
const activeOwnerAvatar = computed(() => ownerInfo.resolve(activeCollection.value?.code) ?? (!localCollections ? activeCollection.value?.avatar : undefined))

const feedExpired = computed(() => {
  const end = activeCollection.value?.subscription_end_time
  return !!end && new Date(end).getTime() < Date.now()
})
const feedClosed = computed(() => !!activeCollection.value && activeCollection.value.status !== 1)
const feedBlocked = computed(() => feedExpired.value || feedClosed.value)
const feedExpiredDays = computed(() => {
  const end = activeCollection.value?.subscription_end_time
  if (!end) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(end).getTime()) / 86400000))
})

const isSubscribedToday = computed(() => {
  const start = activeCollection.value?.subscribed_at
  if (!start) return false
  const startDate = new Date(start)
  const now = new Date()
  return startDate.getFullYear() === now.getFullYear() && startDate.getMonth() === now.getMonth() && startDate.getDate() === now.getDate()
})

const subscribedSinceDate = computed(() => {
  const start = activeCollection.value?.subscribed_at
  if (!start) return ''
  return new Intl.DateTimeFormat(locale.value === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long' }).format(new Date(start))
})

const feedStatusText = computed(() => {
  if (feedClosed.value) return t('page.bookmarks_index.collection_feed.closed')
  if (feedExpired.value) return t('page.bookmarks_index.collection_feed.expired_days', { count: feedExpiredDays.value })
  if (isSubscribedToday.value) return t('page.bookmarks_index.collection_feed.subscribed_today')
  return t('page.bookmarks_index.collection_feed.subscribed_since', { date: subscribedSinceDate.value })
})
const feedClosedTitle = computed(() => {
  const name = activeCollection.value?.name ?? ''
  return feedClosed.value ? t('page.bookmarks_index.collection_feed.closed_title') : t('page.bookmarks_index.collection_feed.expired_title', { name })
})
const feedClosedDesc = computed(() => (feedClosed.value ? t('page.bookmarks_index.collection_feed.closed_desc') : t('page.bookmarks_index.collection_feed.expired_desc')))

// 当前页跳转；/c/[id] 是 SSR 页，external:true 强制整页跳转，避免 SPA 路由绕过其 SSR 逻辑
const openCollectionHome = () => {
  const code = activeCollection.value?.code
  if (code) navigateTo(eventEntryUrl(`/c/${code}`, 'inbox'), { external: true })
}

const collectionBookmarks = computed(() => bookmarks.value as unknown as CollectionBookmarkItem[])

const selectFeed = async (code: string | null) => {
  if (searchText.value) searchText.value = ''
  sourceFilter.value = null
  scrollListToTop()
  activeCollectionCode.value = code
  activeCollectionId.value = code ? subscribedCollections.value.find(collection => collection.code === code)?.id || null : null
  if (filterStatus.value !== 'inbox') await applyTab('inbox')
  resetBookmarks()
  if (code && localCollections) await localCollections.setLastRead(code)
  onLoadMore()
}

const applySourceFilter = (source: { domain: string; label: string }) => {
  if (filterStatus.value !== 'inbox' || !source.domain) return
  sourceFilter.value = source
  scrollListToTop()
}

const clearSourceFilter = () => {
  sourceFilter.value = null
  scrollListToTop()
}

// 新增项入场动画
// nc 弹簧，其余淡入
const feedAnimateCode = ref<string | null>(null) // 弹簧目标
const feedFadeCodes = ref<string[]>([]) // 淡入目标
let feedInitialized = false // 基线是否已定
let prevFeedCodes: string[] = []

// 本地首查结算即定基线
// 之后新增才播；REST 直接就绪
if (localCollections && subLoading) {
  // feedInitialized 守卫保证只定一次，无需自停
  watch(
    subLoading,
    loading => {
      if (loading || feedInitialized) return
      feedInitialized = true
      prevFeedCodes = subscribedCollections.value.map(c => c.code)
      const nc = newCollectionCode.value // 首屏含 nc 也弹簧
      if (nc && prevFeedCodes.includes(nc)) feedAnimateCode.value = nc
    },
    { immediate: true }
  )
} else {
  feedInitialized = true
}

watch(
  () => subscribedCollections.value.map(c => c.code),
  codes => {
    if (!feedInitialized) return // 等基线落定
    const added = codes.filter(c => !prevFeedCodes.includes(c))
    prevFeedCodes = codes
    if (!added.length) return
    const nc = newCollectionCode.value
    if (nc && added.includes(nc)) feedAnimateCode.value = nc
    const fades = added.filter(c => c !== nc)
    if (localCollections && fades.length) feedFadeCodes.value = [...feedFadeCodes.value, ...fades]
  },
  { immediate: true }
)

// 动画播完：清目标态（一次性）
const onFeedAnimated = (code: string) => {
  if (code === feedAnimateCode.value) feedAnimateCode.value = null
  if (code === newCollectionCode.value) newCollectionCode.value = null
  if (feedFadeCodes.value.includes(code)) feedFadeCodes.value = feedFadeCodes.value.filter(c => c !== code)
}

const { isFirstSyncing, percent: syncPercent, downloaded: syncDownloaded, total: syncTotal } = useLocalSyncProgress()

// 列表布局模式（card / text）
const { listMode } = useListLayoutMode()

// 刷新指示器
const { showRefreshLoading } = useRefreshIndicator(isRefreshLoading)

// 页面级滚动位置
const { y } = useScroll(window, { behavior: 'smooth', throttle: 10 })

// fork-only：analytics sectionMap 含 collections tab
const addLog = () => {
  const sectionMap: Record<string, 'inbox' | 'starred' | 'topics' | 'collections' | 'highlights' | 'archive' | 'trash'> = {
    inbox: 'inbox',
    starred: 'starred',
    topics: 'topics',
    collections: 'collections',
    highlights: 'highlights',
    archive: 'archive',
    trashed: 'trash'
  }

  const section = sectionMap[filterStatus.value] || 'inbox'
  analyticsLog({
    event: 'bookmark_list_view',
    section
  })
}

watch(
  () => route.query.filter,
  (newValue, oldValue) => {
    if (newValue === oldValue) {
      return
    }

    filterStatus.value = `${newValue || 'inbox'}`
    addLog()
  }
)

watch(filterStatus, (value, oldValue) => {
  if (value === oldValue) {
    return
  }

  if (value !== 'inbox') {
    activeCollectionCode.value = null
    activeCollectionId.value = null
    sourceFilter.value = null
  }

  reloadList()
})

watch(searchText, value => {
  if (value) sourceFilter.value = null
})

// ?q= from another page (e.g. the settings top bar) becomes a search. On a fresh mount the value was
// captured and stripped with the activity params above; the page is kept alive, so later returns to
// /bookmarks read and strip it here. Hooks rather than a route watcher, so a cached instance never
// reacts to another page's URL.
onMounted(() => {
  if (initialSearchQuery) searchText.value = initialSearchQuery
})
let firstActivation = true
onActivated(() => {
  if (firstActivation) {
    firstActivation = false
    return
  }
  const q = typeof route.query.q === 'string' ? route.query.q.trim() : ''
  if (!q) return
  searchText.value = q
  // Keep the current path: a name-based replace would turn the '/' alias into '/bookmarks' and remount the page
  useRouter().replace({ path: route.path, query: { ...route.query, q: undefined } })
})

// fork-only：加载用户后查活动状态
userStore.getUserInfo({ refresh: true }).then(info => {
  userInfo.value = info
  loadActivityStatus()
})

onMounted(() => {
  addLog()
  if (canCollections && !localCollections) loadRestCollections()
  useShareCollectInfo().ensure() // 预取星标合集信息，抹平切换延迟
  // 消费 nc：严格停 Inbox + 抹 URL 防重播（filter 不变不触发切 tab）
  if (newCollectionCode.value) {
    activeCollectionCode.value = null
    useRouter().replace({ query: { ...route.query, nc: undefined } })
  }
})

// 切换前滚顶：虚拟列表基于 window 滚动
// 不归零会沿用旧偏移致错位
const scrollListToTop = () => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })

// 编排动作：选择一组话题（交集）
const selectTopics = async (ids: string[], name = '') => {
  sourceFilter.value = null
  scrollListToTop()
  resetBookmarks()
  await applyTopics(ids, name)
  await onLoadMore()
}

// 编排动作：列表卡片上点了一个标签 → 进标签筛选页，只选这一个
const selectTagFromCell = async (tag: BookmarkTag) => {
  sourceFilter.value = null
  const ids = [String(tag.id)]
  if (filterStatus.value === 'topics') {
    await selectTopics(ids, tag.show_name)
    return
  }
  if (searchText.value) searchText.value = ''
  scrollListToTop()
  resetBookmarks()
  // 先把 ids 摆好，再翻 filterStatus，watch 触发的 reloadList 才会按这组标签加载
  filterTopicIds.value = ids
  filterTopicName.value = tag.show_name
  filterStatus.value = 'topics'
  await applyTopics(ids, tag.show_name)
}

// 编排动作：选择合集
const selectCollection = async (info: { id: number; name: string; code: string } | null) => {
  sourceFilter.value = null
  scrollListToTop()
  resetBookmarks()
  await applyCollection(info)
  await onLoadMore()
}

// 编排动作：切换 tab
const inboxClick = async (type: string, index?: number) => {
  if (searchText.value) {
    searchText.value = ''
    y.value = 0
  }

  if (type !== 'inbox') {
    activeCollectionCode.value = null
    activeCollectionId.value = null
    sourceFilter.value = null
  }

  if (type === filterStatus.value) {
    return
  }

  scrollListToTop()
  resetBookmarks()
  await applyTab(type)

  if (index !== undefined && bookmarksLayout.value?.isSmallScreen()) {
    const button = tabsSidebar.value?.getAllButtons()[index]
    button?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

const addUrlSuccess = () => {
  Toast.showToast({
    text: t('common.tips.add_url_success')
  })

  reloadList()
}

const feedbackClick = () => {
  const email = useUserStore().userInfo?.email
  showFeedbackModal({
    reportType: 'parse_error',
    title: '',
    email: email || '',
    params: {
      entry_point: 'inbox'
    }
  })
}

// ─── fork-only：促销/订阅领取活动系统 ────────────────────────────────────

const loadActivityStatus = async () => {
  if (!import.meta.client) return
  const storageKey = `activity_claimed_${currentActivityType}`

  if (localStorage.getItem(storageKey) === 'true') {
    showReceiveSubscribe.value = false
    return
  }

  request()
    .post<{ status: boolean }>({
      url: RESTMethodPath.PROMOTION_CHECK_RECEIVE,
      body: { activity_type: currentActivityType }
    })
    .then(res => {
      // 只保留侧栏 promo 入口，去掉自动弹窗
      showReceiveSubscribe.value = !!res && !res.status
      if (res && res.status) {
        localStorage.setItem(storageKey, 'true')
      }
    })
}

const receiveActivity = async () => {
  const period = currentActivityType === 'blogger' ? t('component.plan_card.plans.1.two_month') : t('component.plan_card.plans.1.one_month')
  const app = modalBootloader({
    ele: ReceiveSubscribeModal,
    props: {
      subTitle: t('component.subscribe.confirm_message', { month: period }),
      confirmText: t('component.subscribe.confirm'),
      cancelText: t('component.subscribe.cancel'),
      activity_id: currentActivityId,
      activity_type: currentActivityType,
      onDismiss: (success: boolean) => {
        app.unmount()
        app._container?.remove()
        success && loadActivityStatus()
      }
    }
  })
}
</script>

<style lang="scss" scoped>
:deep(.source-filter-after-feed) {
  margin-top: 20px;
}

.source-filter-tag {
  display: inline-flex;
  align-items: center;
  max-width: min(100%, 320px);
  padding: 5px 10px;
  border: 1px solid color-mix(in srgb, var(--slax-accent) 24%, var(--slax-border));
  border-radius: 999px;
  background: var(--slax-accent-bg);
  color: var(--slax-accent);
  font-size: 12px;
  line-height: 16px;
}

.source-filter-prefix {
  flex-shrink: 0;
  margin-right: 4px;
}

.source-filter-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-filter-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: currentColor;
  cursor: pointer;
  margin-left: 6px;
  opacity: 1;

  svg {
    width: 12px;
    height: 12px;
    flex: 0 0 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }
}

.feed-featured-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 24px 0 0;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--slax-border);
  color: var(--slax-text-muted);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.35;
}

.feed-featured-meta {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.feed-featured-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--slax-text);
}

.feed-subscription-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--slax-text-light);
  font-size: 12px;
  font-weight: 400;
  line-height: 1;
  white-space: nowrap;
}

.feed-subscription-meta::before {
  content: '';
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.7;
}

.feed-subscription-meta.expired {
  color: var(--slax-danger, #c44);
}

.feed-featured-actions {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.feed-home-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 0;
  border: none;
  background: transparent;
  color: var(--slax-text-light);
  font: inherit;
  font-size: 13px;
  font-weight: 400;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    color: var(--slax-text-muted);
  }

  svg {
    width: 13px;
    height: 13px;
  }
}

.feed-renew-btn {
  padding: 7px 16px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm, 8px);
  background: var(--slax-surface);
  color: var(--slax-accent);
  font: inherit;
  font-size: 13px;
  font-weight: 400;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    border-color: color-mix(in srgb, var(--slax-accent) 30%, var(--slax-border));
  }
}

.feed-closed-view {
  --style: flex flex-col items-center justify-center text-center;
  padding: 96px 24px 48px;
}

.feed-closed-icon {
  --style: w-72px h-72px rounded-full mb-24px flex-center;
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  color: var(--slax-text-light);

  svg {
    --style: w-32px h-32px;
    opacity: 0.7;
  }
}

.feed-closed-title {
  --style: text-20px font-500 mb-8px;
  color: var(--slax-text);
  font-family: var(--slax-font-serif);
  letter-spacing: 0.01em;
}

.feed-closed-desc {
  --style: m-0 text-14px;
  max-width: 360px;
  line-height: 1.7;
  color: var(--slax-text-light);
  white-space: pre-line;
}

.list-loading-enter-active,
.list-loading-leave-active {
  transition: transform 0.4s;
}

.list-loading-enter-from,
.list-loading-leave-to {
  --style: -translate-y-10px;
}

/* fork-only：侧边栏底部促销图 */
.sidebar-promo {
  /* 水平居中 */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px 16px;
  cursor: pointer;

  /* ≤768：不显示促销图 */
  @media (max-width: 768px) {
    display: none;
  }
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
  width: 100%;

  &:hover {
    transform: scale(1.03);
    opacity: 0.92;
  }

  &:active {
    transform: scale(1.01);
  }

  img {
    display: block;
    width: 100%;
    max-width: 140px;
    height: auto;
    object-fit: contain;
  }
}
</style>
