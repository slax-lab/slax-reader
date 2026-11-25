<template>
  <div class="search-view">
    <!-- 搜索结果头部：返回按钮 + 元信息 -->
    <div class="search-view-header">
      <button class="search-back-btn" @click="navigateBack" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>{{ $t('page.bookmarks_index.search_back') }}</span>
      </button>
      <p class="search-view-meta" v-if="status === 'success'">
        {{ $t('component.search_header.found_count', { count: searchResults.length }) }}
        <span class="search-keyword">{{ defaultSearchText }}</span>
      </p>
    </div>

    <!-- 搜索结果列表 -->
    <div class="search-result-list" v-if="searchResults.length > 0">
      <article v-for="result in searchResults" :key="result.bookmark_id" class="search-result-item" @click="navigateToBookmark(result)">
        <h3 class="search-result-title" v-html="result.highlight_title" />
        <p class="search-result-snippet" v-if="result.highlight_content">…<span v-html="result.highlight_content"></span>…</p>
        <div class="search-result-meta" v-if="result.type === 'vector'">
          <span class="search-result-tag">{{ $t('component.search_header.semantic_relative', { value: `${(result.vs_score * 100).toFixed(1)}` }) }}</span>
        </div>
      </article>
    </div>

    <!-- 单次返回全量，非加载即到底 -->
    <ListEndHint v-if="searchResults.length > 0" class="search-end" :text="$t('page.bookmarks_index.no_more')" />

    <BookmarksEmptyView
      v-if="status === 'failed'"
      class="search-error"
      :title="$t('component.search_header.failed')"
      :desc="defaultSearchText"
      :action-text="$t('component.search_header.retry')"
      @action="search(defaultSearchText)"
    />

    <!-- 空态 -->
    <BookmarksEmptyView
      v-if="status === 'success' && searchResults.length === 0"
      class="search-empty"
      :title="$t('component.search_header.empty')"
      :desc="$t('component.search_header.empty_desc')"
    >
      <template #icon>
        <AppIcon name="empty.search" :size="32" />
      </template>
    </BookmarksEmptyView>

    <!-- 加载中 -->
    <div class="search-loading" v-if="status === 'loading'">
      <div class="i-svg-spinners:90-ring" style="color: var(--slax-accent); width: 20px; height: 20px"></div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import AppIcon from '~/components/AppIcon.vue'
import BookmarksEmptyView from '~/components/BookmarkList/BookmarksEmptyView.vue'
import ListEndHint from '~/components/ListEndHint.vue'

import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { SearchResultItem } from '@slax-reader/contracts/interface'

const props = defineProps({
  defaultSearchText: {
    type: String,
    required: false,
    default: ''
  }
})

const emits = defineEmits(['back', 'searchStatusUpdate'])

const status = ref<'idle' | 'loading' | 'success' | 'failed'>('idle')
const searchResults = ref<SearchResultItem[]>([])
let generation = 0

const search = async (keyword: string) => {
  const current = ++generation
  searchResults.value = []
  status.value = keyword ? 'loading' : 'idle'
  if (!keyword) return

  try {
    const results = await request().post<SearchResultItem[]>({
      url: RESTMethodPath.SEARCH_CONTENT,
      body: { keyword },
      errorInterceptors: () => {}
    })
    if (current !== generation) return
    searchResults.value = results || []
    status.value = 'success'
  } catch {
    if (current === generation) status.value = 'failed'
  }
}

watch(() => props.defaultSearchText, search)
watch(() => status.value === 'loading', loading => emits('searchStatusUpdate', loading))
onMounted(() => search(props.defaultSearchText))

const navigateBack = () => {
  emits('back')
  emits('searchStatusUpdate', false)
}

const navigateToBookmark = (result: SearchResultItem) => {
  // 快照走 seam；缺标识回退 /bookmarks/[id]
  const target = useSlaxRoutes().snapshotRoute(result) ?? `/bookmarks/${result.bookmark_id}`
  pwaOpen({ url: target })
}

</script>

<style lang="scss" scoped>
.search-view {
  padding-bottom: 48px;
}

.search-view-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.search-back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: transparent;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  cursor: pointer;
  color: var(--slax-text-muted);
  font-family: inherit;
  font-size: 14px;
  transition: all 0.15s;
  flex-shrink: 0;

  &:hover {
    background: var(--slax-surface);
    color: var(--slax-text);
    border-color: color-mix(in srgb, var(--slax-accent) 30%, var(--slax-border));
  }
}

.search-view-meta {
  font-size: 14px;
  color: var(--slax-text-light);
  margin: 0;
}

.search-keyword {
  color: var(--slax-accent);
  font-weight: 500;
  margin-left: 4px;
}

.search-result-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.search-result-item {
  display: block;
  padding: 16px 18px;
  border-radius: var(--slax-radius);
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;

  &:hover {
    background: var(--slax-surface);
    border-color: var(--slax-border);
  }
}

.search-result-title {
  font-family: var(--slax-font-serif);
  font-size: 16px;
  font-weight: 500;
  color: var(--slax-text);
  margin: 0 0 6px;
  line-height: 1.5;

  :deep(mark) {
    background: var(--slax-accent-bg);
    color: var(--slax-accent);
    border-radius: 3px;
    padding: 0 2px;
  }
}

.search-result-snippet {
  font-size: 14px;
  color: var(--slax-text-light);
  line-height: 1.7;
  margin: 0 0 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;

  :deep(mark) {
    background: var(--slax-accent-bg);
    color: var(--slax-accent);
    border-radius: 3px;
    padding: 0 2px;
  }
}

.search-result-meta {
  margin-top: 4px;
}

.search-result-tag {
  font-size: 11px;
  color: var(--slax-text-light);
  background: var(--slax-accent-bg);
  padding: 2px 8px;
  border-radius: 999px;
}

.search-end {
  margin-top: 32px;
}

.search-loading {
  display: flex;
  justify-content: center;
  padding: 48px 0;
}
</style>
