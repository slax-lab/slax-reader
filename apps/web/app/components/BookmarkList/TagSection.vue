<!-- 标签页的一段：标题 + 说明 + 一组 TagChip；tags 空时交给 #empty slot -->
<template>
  <section class="tag-section">
    <div class="tag-section-head">
      <h4 class="tag-section-title">{{ title }}</h4>
      <span v-if="hint" class="tag-section-hint">{{ hint }}</span>
    </div>

    <!-- 改用 v-if div 包裹 v-for，
         避开 LF 异步列表的 patch 崩溃 -->
    <div class="tags-list">
      <div v-if="tags.length" class="tags-cells">
        <div class="tag-item" v-for="tag in tags" :key="tag.id">
          <TagChip :tag="tag" :promotable="promotable" @click="emit('select', tag)" @promote="emit('promote', tag)" />
          <button v-if="editable" class="tag-edit-btn" type="button" :title="$t('common.operate.edit')" @click.stop="emit('edit', tag)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        </div>
      </div>
      <slot v-else name="empty" />
    </div>
  </section>
</template>

<script lang="ts" setup>
import TagChip from '~/components/BookmarkList/TagChip.vue'

import type { BookmarkTag } from '@commons/contracts/interface'

defineProps<{
  title: string
  hint?: string
  tags: BookmarkTag[]
  promotable?: boolean
  editable?: boolean
}>()

const emit = defineEmits<{
  select: [tag: BookmarkTag]
  promote: [tag: BookmarkTag]
  edit: [tag: BookmarkTag]
}>()
</script>

<style lang="scss" scoped>
.tag-section {
  & + & {
    margin-top: 20px;
  }
}

.tag-section-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}

.tag-section-title {
  margin: 0;
  font-family: var(--slax-font-serif);
  font-size: var(--slax-fs-body);
  font-weight: 500;
  color: var(--slax-text);
}

.tag-section-hint {
  font-size: 12px;
  color: var(--slax-text-light);
}

// 标签列表：flex wrap 胶囊布局
.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

// 不生成盒子，.tag-item 仍是 flex 子项
.tags-cells {
  display: contents;
}

.tag-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tag-edit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--slax-border);
  border-radius: 50%;
  background: var(--slax-surface-solid);
  color: var(--slax-text-light);
  cursor: pointer;
  opacity: 0;
  transition: all 0.12s;

  .tag-item:hover &,
  .tag-item:focus-within & {
    opacity: 1;
  }

  &:hover {
    border-color: var(--slax-accent);
    color: var(--slax-accent);
    background: var(--slax-accent-bg);
  }
}
</style>
