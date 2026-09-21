<template>
  <!-- 划线卡片：对齐 demo .highlight-card 结构 -->
  <div class="highlight-card" @click="jumpToOriginal(highlight)">
    <!-- 来源文章标题 -->
    <div class="highlight-source" v-if="highlight.title">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      </svg>
      <span>{{ highlight.title }}</span>
    </div>

    <!-- 划线引用块 -->
    <blockquote class="highlight-quote" v-if="highlight.type === 'mark' || highlight.type === 'comment' || highlight.type === 'reply'">
      {{ getContent(highlight) }}
    </blockquote>

    <!-- 笔记/评论文字 -->
    <p class="highlight-note" v-if="highlight.type === 'comment' && highlight.comment">
      {{ highlight.comment }}
    </p>
    <p class="highlight-note" v-else-if="highlight.type === 'reply' && highlight.comment">
      {{ highlight.comment }}
    </p>

    <!-- 时间 -->
    <div class="highlight-meta">{{ dateString(highlight.created_at) }}</div>
  </div>
</template>

<script setup lang="ts">
import { formatDate } from '@commons/utils/date'

import type { HighlightItem } from '@commons/types/interface'
import type { PropType } from 'vue'

defineProps({
  highlight: {
    type: Object as PropType<HighlightItem>,
    required: true
  }
})

const dateString = (date: string) => {
  return formatDate(new Date(date), 'YYYY-MM-DD HH:mm')
}

const getContent = (item: HighlightItem) => {
  return item.content.length < 1
    ? item.approx_source?.exact || ''
    : item.content
        .filter(content => content.type !== 'image')
        .map(content => content.text)
        .join('')
        .replaceAll('\n', '')
        .replaceAll('\t', '')
}

const { highlightRoute } = useSlaxRoutes()
const jumpToOriginal = (item: HighlightItem) => {
  pwaOpen({ url: highlightRoute(item) })
}
</script>

<style lang="scss" scoped>
.highlight-card {
  padding: 16px 18px;
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow: inset 0 1px 0 var(--slax-inset-hi);
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;

  &:hover {
    border-color: color-mix(in srgb, var(--slax-accent) 25%, transparent);
    box-shadow:
      0 2px 8px color-mix(in srgb, var(--slax-accent) 5%, transparent),
      inset 0 1px 0 var(--slax-inset-hi);
    transform: translateY(-1px);
  }
}

.highlight-source {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--slax-text-light);
  letter-spacing: 0.02em;
  align-self: flex-start;
  transition: color 0.15s;

  svg {
    flex-shrink: 0;
    opacity: 0.7;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 300px;
  }

  &:hover {
    color: var(--slax-accent);
  }
}

.highlight-quote {
  margin: 0;
  padding: 7px 10px 7px 11px;
  border-left: 3px solid var(--slax-accent);
  background: var(--slax-accent-bg);
  border-radius: 0 4px 4px 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--slax-text-muted);
}

.highlight-note {
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
  color: var(--slax-text);
}

.highlight-meta {
  font-size: 12px;
  color: var(--slax-text-light);
  font-weight: 300;
}
</style>
