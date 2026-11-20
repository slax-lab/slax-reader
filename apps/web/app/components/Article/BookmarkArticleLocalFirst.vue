<template>
  <!-- 属性/事件经 attrs 透传，wrapper 不声明 -->
  <BookmarkArticle ref="inner" :detail="detail" :marks="marks" :ready="localReady">
    <template #before-body><slot name="before-body" /></template>
    <template #after-body><slot name="after-body" /></template>
  </BookmarkArticle>
</template>

<script setup lang="ts">
import BookmarkArticle from '~/components/Article/BookmarkArticle.vue'

import { LocalFirstHttpClient } from './Selection/adapters/LocalFirstHttpClient'
import type { MarkDetail } from '@commons/frontend-types/models'
import type { PowerSyncDatabase } from '@powersync/web'
import type { IHttpClient } from '@slax-reader/selection/adapters'
import { DwebHttpClient } from '~/components/Article/Selection/adapters'
import { ArticleSelectionAdaptersKey } from '~/components/Article/Selection/injection'
import type { QuoteData } from '~/components/Chat/type'
import { useUserStore } from '~/stores/user'

const props = withDefaults(
  defineProps<{
    detail: BookmarkArticleDetail
    bookmarkUuid: string
    localFirst: boolean
    localReady: boolean
    // A database received after setup; the app-level client stays absent on a deferred document.
    localDatabase?: PowerSyncDatabase
    // Tag editing needs the setup-time local adapter; a deferred document keeps tags on REST.
    localTags?: boolean
    marks?: MarkDetail
    isOwner?: boolean
  }>(),
  { localTags: true, localDatabase: undefined, marks: undefined, isOwner: undefined }
)

const userStore = useUserStore()
const emit = defineEmits<{ localMarkWrite: [] }>()
const restClient = new DwebHttpClient()
let localClient: { key: unknown; client: LocalFirstHttpClient } | null = null
const currentClient = (): IHttpClient => {
  if (!props.localFirst || !props.bookmarkUuid) return restClient
  const key = props.localDatabase ?? props.bookmarkUuid
  if (localClient?.key !== key) localClient = { key, client: new LocalFirstHttpClient(props.bookmarkUuid, props.localDatabase, () => emit('localMarkWrite')) }
  return localClient.client
}
const switchingClient: IHttpClient = {
  post: options => currentClient().post(options),
  get: options => currentClient().get(options),
  put: options => currentClient().put(options),
  delete: options => currentClient().delete(options)
}

// 行为差异门控在 localFirst
// 用 getter 延迟取值，晚绑定
provide(ArticleSelectionAdaptersKey, {
  // The selection layer keeps the first client it receives; resolve the transport per request so a page that
  // switches to local data after the first mark draw writes locally from then on.
  httpClient: () => switchingClient,
  get allowActionOverride() {
    // snapshot owner（非 localFirst）也放开划线/评论/标签，对齐 463d6a21 isSnapshotOwner
    if (props.localFirst || props.isOwner) return true
    // /b visitor 必须显式禁用，避免 Selection 回退到 collection_info.allow_action
    if (props.isOwner === false) return false
    return undefined
  },
  get allowChatbot() {
    // chat 仅 owner，对齐侧边栏
    return props.localFirst || !!props.isOwner
  },
  ownerUserId: () => (props.localFirst ? userStore.userInfo?.userId : undefined),
  get markSource() {
    return props.localFirst ? 'props' : 'detail'
  },
  get tagsDataSource() {
    return props.localFirst && props.localTags ? 'local' : 'rest'
  },
  get tagsBookmarkUuid() {
    return props.localFirst && props.localTags ? props.bookmarkUuid : ''
  },
  // 行末评论 icon：快照页常开
  commentTailIndicator: true
})

// defineExpose 保持扁平形状
// 父页面读 articleSelection 实例
const inner = ref<InstanceType<typeof BookmarkArticle>>()
defineExpose({
  findQuote: (quote: QuoteData) => inner.value?.findQuote(quote),
  get articleSelection() {
    return inner.value?.articleSelection
  }
})
</script>
