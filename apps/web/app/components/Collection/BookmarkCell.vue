<template>
  <!-- 卡片新开页直跳 /b/{uuid} -->
  <NuxtLink class="collection-article-row" :to="target" target="_blank" rel="noopener noreferrer">
    <div class="article-content">
      <!-- 标题规则同 inbox 单元格 -->
      <h3 class="article-title">{{ truncateTitle(bookmark.alias_title || bookmark.title, 48) || bookmark.target_url }}</h3>
      <!-- 策展 snippet：头像+文本（对齐原型，无类型徽标） -->
      <blockquote v-if="snippet" class="article-owner-note" :class="`is-${snippet.type}`">
        <img v-if="ownerAvatar" class="article-owner-avatar" :src="ownerAvatar" alt="" loading="lazy" />
        <span class="article-owner-note-text">{{ snippet.text }}</span>
      </blockquote>
      <div class="article-meta">
        <span v-if="dateString" class="article-date">{{ dateString }}</span>
        <span v-if="bookmark.site_name" class="article-source">{{ bookmark.site_name }}</span>
        <span v-if="bookmark.mark_count" class="article-highlight-count">
          {{ $t('page.c_index.highlight_count', { count: bookmark.mark_count }) }}
        </span>
      </div>
    </div>
  </NuxtLink>
</template>

<script lang="ts" setup>
import { formatDate } from '@commons/frontend-utils/date'

import type { UserShareCollectListItem } from '@slax-reader/contracts/interface'

const props = defineProps({
  bookmark: {
    type: Object as PropType<UserShareCollectListItem>,
    required: true
  },
  // 作者头像（owner-note）
  ownerAvatar: {
    type: String,
    required: false,
    default: ''
  }
})

const target = computed(() => (props.bookmark.bookmark_uuid ? `/b/${props.bookmark.bookmark_uuid}` : '#'))

// 首条 mark：笔记优先，其次划线原文
const snippet = computed(() => {
  const fm = props.bookmark.first_mark
  if (!fm) return null
  const note = fm.comment?.trim()
  if (note) return { type: 'note' as const, text: note }
  const highlight = (markText(fm.content) || fm.source || '').trim()
  if (highlight) return { type: 'highlight' as const, text: highlight }
  return null
})

const dateString = computed(() => {
  // 统一按 starred_at（加星时间）
  const raw = props.bookmark.starred_at
  if (!raw) return ''
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? '' : formatDate(d, 'YYYY-MM-DD')
})
</script>

<style lang="scss" scoped>
.collection-article-row {
  position: relative;
  display: grid;
  grid-template-columns: var(--article-marker-col, 24px) minmax(0, 1fr);
  column-gap: var(--article-marker-gap, 8px);
  align-items: start;
  min-height: 62px;
  padding: 10px var(--article-row-x-padding, 4px);
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  transition: background var(--slax-dur-fast) ease;

  // 圆点 marker（非序号）
  &::before {
    content: '';
    width: var(--article-marker-size, 6px);
    height: var(--article-marker-size, 6px);
    margin-top: 10px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--slax-text-light) 62%, transparent);
    justify-self: start;
  }

  // 对齐到内容列的底部分隔线
  &::after {
    content: '';
    position: absolute;
    left: calc(var(--article-row-x-padding, 4px) + var(--article-marker-col, 24px) + var(--article-marker-gap, 8px));
    right: var(--article-row-x-padding, 4px);
    bottom: 0;
    height: 1px;
    background: var(--slax-border);
  }

  &:hover {
    background: var(--slax-accent-bg);
  }

  @media (max-width: 768px) {
    min-height: 68px;
    padding-top: 14px;
    padding-bottom: 14px;

    &:hover {
      background: transparent;
    }
  }
}

.article-content {
  grid-column: 2;
  min-width: 0;
}

.article-title {
  // 最多两行，超出省略
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0 0 4px;
  color: var(--slax-text);
  font-family: var(--slax-font-serif);
  font-size: 17px;
  font-weight: 400;
  line-height: 1.48;
}

.article-owner-note {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  margin: 8px 0;
  padding: 5px 10px 5px 11px;
  border-left: 3px solid var(--slax-accent);
  border-radius: 0 4px 4px 0;
  background: var(--slax-accent-bg);
  color: var(--slax-text-muted);
  font-size: 13px;
  line-height: 1.5;
  overflow: hidden;

  // 划线弱化，笔记最重
  &.is-highlight {
    border-left-color: color-mix(in srgb, var(--slax-text-light) 45%, transparent);
    background: transparent;
  }
}

.article-owner-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.article-owner-note-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.article-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--slax-text-light);
  font-size: 12px;
  font-weight: 300;
  line-height: 1.5;

  @media (max-width: 768px) {
    flex-wrap: wrap;
    gap: 6px 8px;
  }
}

.article-date {
  flex-shrink: 0;
}

.article-source {
  position: relative;
  display: inline-flex;
  align-items: center;
  max-width: 220px;
  min-width: 0;
  padding-left: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  @media (max-width: 768px) {
    max-width: 52vw;
  }
}

.article-highlight-count {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding-left: 8px;
  flex-shrink: 0;
  white-space: nowrap;

  @media (max-width: 768px) {
    display: none;
  }
}

.article-source::before,
.article-highlight-count::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 1px;
  height: 12px;
  background: var(--slax-border);
  transform: translateY(-50%);
}
</style>
