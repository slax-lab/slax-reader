<template>
  <!-- 属性/事件经 attrs 透传，wrapper 不声明 -->
  <BookmarkArticle ref="inner" :detail="detail" :marks="marks" :ready="localReady" />
</template>

<script setup lang="ts">
import BookmarkArticle from '~/components/Article/BookmarkArticle.vue'

import { LocalFirstHttpClient } from './Selection/adapters/LocalFirstHttpClient'
import type { MarkDetail } from '@commons/types/interface'
import { DwebHttpClient } from '~/components/Article/Selection/adapters'
import { ArticleSelectionAdaptersKey } from '~/components/Article/Selection/injection'
import type { QuoteData } from '~/components/Chat/type'
import { useUserStore } from '~/stores/user'

const props = defineProps<{
  detail: BookmarkArticleDetail
  bookmarkUuid: string
  localFirst: boolean
  localReady: boolean
  marks?: MarkDetail
  isOwner?: boolean
}>()

const userStore = useUserStore()

// 行为差异门控在 localFirst
// 用 getter 延迟取值，晚绑定
provide(ArticleSelectionAdaptersKey, {
  httpClient: () => (props.localFirst && props.bookmarkUuid ? new LocalFirstHttpClient(props.bookmarkUuid) : new DwebHttpClient()),
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
  get tagsBookmarkUuid() {
    return props.localFirst ? props.bookmarkUuid : ''
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
