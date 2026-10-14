<template>
  <!-- 主列表内容：按 filterStatus 分发 书签（日期分组）/ 高亮 两种列表 -->
  <div class="bookmarks">
    <template v-if="filterStatus !== 'highlights'">
      <ClientOnly>
        <Transition name="list-mode" mode="out-in">
          <WindowVirtualizer :key="`${effectiveMode}:${locale}`" :data="displayItems" :buffer-size="600">
            <!-- item 必须带稳定 key，否则退化为下标 key，
                 增删改会错位并残留幽灵单元格 -->
            <template #default="{ item }">
              <BookmarkDateGroup v-if="item.type === 'group'" :key="`g:${item.key}`" :label="item.label" />
              <BookmarkCell
                v-else
                :key="`b:${item.bookmark.id}`"
                :index="item.index"
                :is-subscribe="filterStatus === 'collections'"
                :bookmark="item.bookmark"
                :collection-code="filterCollectionCode"
                :source-filterable="filterStatus === 'inbox'"
                :text-mode="effectiveMode === 'text'"
                :class="{ 'text-mode': effectiveMode === 'text' }"
                @source-filter="source => emit('source-filter', source)"
                @select-tag="(tag: BookmarkTag) => emit('select-tag', tag)"
                @delete="(id: number) => emit('delete', id)"
                @archive-update="(id: number, archive: boolean) => emit('archive-update', id, archive)"
                @alias-title-update="(id: number, aliasTitle: string) => emit('alias-title-update', id, aliasTitle)"
                @bookmark-update="(id: number, bookmark: BookmarkItem) => emit('bookmark-update', id, bookmark)"
              />
            </template>
          </WindowVirtualizer>
        </Transition>
        <template #fallback>
          <template v-for="item in displayItems.slice(0, 20)" :key="item.type === 'group' ? item.key : item.bookmark.id">
            <BookmarkDateGroup v-if="item.type === 'group'" :label="item.label" />
            <BookmarkCell
              v-else
              :index="item.index"
              :is-subscribe="filterStatus === 'collections'"
              :bookmark="item.bookmark"
              :collection-code="filterCollectionCode"
              :source-filterable="filterStatus === 'inbox'"
              :text-mode="effectiveMode === 'text'"
              :class="{ 'text-mode': effectiveMode === 'text' }"
              @source-filter="source => emit('source-filter', source)"
              @select-tag="(tag: BookmarkTag) => emit('select-tag', tag)"
              @delete="(id: number) => emit('delete', id)"
              @archive-update="(id: number, archive: boolean) => emit('archive-update', id, archive)"
              @alias-title-update="(id: number, aliasTitle: string) => emit('alias-title-update', id, aliasTitle)"
              @bookmark-update="(id: number, bookmark: BookmarkItem) => emit('bookmark-update', id, bookmark)"
            />
          </template>
        </template>
      </ClientOnly>
    </template>
    <template v-else-if="filterStatus === 'highlights'">
      <div class="card-cells-wrapper">
        <BookmarkHighlightCell v-for="highlight in highlights" :key="highlight.id" :highlight="highlight" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, provide } from 'vue'

import BookmarkCell from '~/components/BookmarkList/BookmarkCell.vue'
import BookmarkDateGroup from '~/components/BookmarkList/BookmarkDateGroup.vue'
import BookmarkHighlightCell from '~/components/BookmarkList/BookmarkHighlightCell.vue'

import type { HighlightItem } from '@slax-reader/contracts/interface'
import type { BookmarkItem, BookmarkTag } from '@commons/frontend-types/models'
import { useMediaQuery } from '@vueuse/core'
import { LocalFirstAdapterKey, SharedUserTagsKey } from '~/composables/local-first/injection'
import { WindowVirtualizer } from 'virtua/vue'

type GroupedItem = { type: 'group'; label: string; key: string } | { type: 'bookmark'; bookmark: BookmarkItem; index: number }

const props = defineProps<{
  filterStatus: string
  groupedBookmarks: GroupedItem[]
  highlights: HighlightItem[]
  listMode: 'card' | 'text'
  filterCollectionCode: string
}>()

// 切语言时 remount 虚拟列表
// 避免分区头中英叠加
const { locale } = useI18n()

// local-first 下用户词表是一份 useQuery，只建一次，整个列表的卡片共用；REST 下为 null
const lf = inject(LocalFirstAdapterKey, null)
provide(SharedUserTagsKey, lf?.userTagSource?.() ?? null)

// ≤768、星标、回收站强制文字列表；归档 / 未打标签与收件箱一样可用卡片
const isH5 = useMediaQuery('(max-width: 768px)')
const isTextOnly = computed(() => ['starred', 'trashed'].includes(props.filterStatus))
const effectiveMode = computed<'card' | 'text'>(() => (isH5.value || isTextOnly.value ? 'text' : props.listMode))

// 文字视图下不按月分段
const displayItems = computed<GroupedItem[]>(() => (effectiveMode.value === 'text' ? props.groupedBookmarks.filter(item => item.type !== 'group') : props.groupedBookmarks))

const emit = defineEmits<{
  delete: [id: number]
  'archive-update': [id: number, archive: boolean]
  'alias-title-update': [id: number, aliasTitle: string]
  'bookmark-update': [id: number, bookmark: BookmarkItem]
  'source-filter': [source: { domain: string; label: string }]
  'select-tag': [tag: BookmarkTag]
}>()
</script>

<style lang="scss" scoped>
.list-mode-leave-active {
  transition: opacity 0.08s ease;
}
.list-mode-leave-to {
  opacity: 0;
}
.list-mode-enter-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}
.list-mode-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.bookmarks {
  --style: relative;

  .card-cells-wrapper {
    --style: px-16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
}

// text-mode：紧凑文字模式，严格对齐 demo 的 .article-list.text-mode
:deep(.text-mode.article-card) {
  background: transparent;
  border: 1px solid transparent;
  border-bottom-color: var(--slax-border);
  border-radius: 0;
  box-shadow: none;
  // 左右 4px、上下 8px；序号与正文间距 32px
  padding: 8px 4px;
  align-items: flex-start;
  gap: 32px;
  margin-bottom: 0;

  &:hover {
    background: var(--slax-accent-bg);
    border-color: transparent;
    border-bottom-color: var(--slax-border);
    box-shadow: none;
    transform: none;
  }

  // 收紧标题与 meta 间距
  .title-wrap {
    margin-bottom: 2px;
  }

  // 内容区右侧留出星标空间
  .article-body {
    padding-right: 32px;
  }

  // meta 行间距
  .article-meta {
    gap: 8px;
  }

  // 来源：去胶囊底色，浅色文字
  // 原先左侧有一条分隔线是用来隔开日期和来源，日期去掉后不再需要
  .article-source {
    background: transparent;
    border-radius: 0;
    padding: 0;
    margin-left: 0;
    color: var(--slax-text-light);
    font-weight: 300;

    &:hover {
      color: var(--slax-accent);
    }
  }

  // 星标：缩小 icon，绝对定位并与标题垂直居中
  .article-star {
    right: 4px;
    top: 8px;
    width: 28px;
    height: 25px;
    border-radius: 0;

    svg {
      width: 12px;
      height: 12px;
    }
  }

  .article-actions {
    margin-right: -10px;
  }
}

// ≤768 文字列表紧凑排版
@media (max-width: 768px) {
  :deep(.text-mode.article-card) {
    padding: 16px 0;
    gap: 14px;

    &:hover {
      background: transparent;
    }

    .article-num {
      min-width: 24px;
      font-size: 14px;
      padding-top: 3px;
      text-align: center;
    }

    .article-body {
      padding-right: 32px;
    }

    .article-title {
      font-size: 17px;
      line-height: 1.5;
    }

    // h5 间距 6px
    .title-wrap {
      margin-bottom: 6px;
    }

    .article-meta {
      gap: 8px;
      min-width: 0;
    }

    .article-source {
      font-size: 12px;
      background: transparent;
      border-radius: 0;
      color: var(--slax-text-light);
      padding: 0;
      max-width: 54vw;

      &:hover {
        color: var(--slax-accent);
      }
    }

    .article-actions {
      display: none;
    }

    .article-star {
      right: 0;
      top: 16px;
      width: 32px;
      height: 28px;
      border-radius: 0;

      svg {
        width: 13px;
        height: 13px;
      }
    }
  }
}
</style>
