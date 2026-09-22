<!-- 统一的标签 chip：标签页 / 添加面板 / 列表卡片共用 -->
<template>
  <span
    class="tag-chip"
    :class="{ mine: tag.source === 'mine', active, compact, legacy, clickable: isClickable, 'has-acts': promotable || removable }"
    :title="tag.show_name"
    role="button"
    :tabindex="isClickable ? 0 : -1"
    @click.stop="emit('click', tag)"
    @keydown.enter.stop="emit('click', tag)"
  >
    <span class="tag-name">{{ tag.show_name }}</span>
    <span v-if="typeof count === 'number'" class="tag-count">{{ count }}</span>
    <i v-if="aiMark" class="tag-ai" :title="$t('component.bookmark_tags.by_ai')">AI</i>
    <!-- Actions sit in a gutter reserved on the right: the chip keeps its width on hover and nothing gets covered -->
    <span v-if="promotable || removable" class="tag-acts">
      <button v-if="promotable" class="tag-act promote" type="button" :title="$t('component.tags_header.promote')" @click.stop="emit('promote', tag)">↑</button>
      <button v-if="removable" class="tag-act remove" type="button" :title="$t('common.operate.delete')" @click.stop="emit('remove', tag)">
        <svg v-if="legacy" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <template v-else>×</template>
      </button>
    </span>
  </span>
</template>

<script lang="ts" setup>
import { getCurrentInstance } from 'vue'

import type { BookmarkTag } from '@commons/frontend-types/models'

const props = defineProps<{
  tag: BookmarkTag
  active?: boolean
  removable?: boolean
  promotable?: boolean
  aiMark?: boolean
  count?: number
  compact?: boolean
  legacy?: boolean
  legacyInteractive?: boolean
}>()

const emit = defineEmits<{
  click: [tag: BookmarkTag]
  remove: [tag: BookmarkTag]
  promote: [tag: BookmarkTag]
}>()

// 只有父级监听了 click 才把 chip 当按钮画
const onClickListener = !!getCurrentInstance()?.vnode.props?.onClick
const isClickable = computed(() => onClickListener && (!props.legacy || props.legacyInteractive))
void props
</script>

<style lang="scss" scoped>
.tag-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 4px 10px;
  border: 1px solid var(--slax-border);
  border-radius: 999px;
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  font-size: var(--slax-fs-tag);
  line-height: 1.5;
  white-space: nowrap;
  user-select: none;
  transition:
    background var(--slax-dur-normal),
    border-color var(--slax-dur-normal),
    color var(--slax-dur-normal);

  &.compact {
    padding: 2px 8px;
    gap: 4px;
  }

  &.mine {
    border-color: color-mix(in srgb, var(--slax-accent) 30%, var(--slax-border));
    background: var(--slax-accent-bg);
    color: var(--slax-accent);
  }

  &.active {
    border-color: var(--slax-accent);
    background: var(--slax-accent-bg);
    color: var(--slax-accent);
  }

  &.clickable {
    cursor: pointer;

    &:hover {
      border-color: color-mix(in srgb, var(--slax-accent) 40%, var(--slax-border));
    }
  }

  .tag-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tag-count {
    font-size: 11px;
    opacity: 0.6;
  }

  .tag-ai {
    font:
      600 9px/1 ui-monospace,
      monospace;
    letter-spacing: 0.06em;
    padding: 2px 3px;
    border: 1px solid currentColor;
    border-radius: 3px;
    opacity: 0.55;
    font-style: normal;
  }

  // Chips with actions keep a gutter on the right at all times, so showing the buttons never changes the width
  &.has-acts {
    padding-right: 28px;
  }

  &.compact.has-acts {
    padding-right: 24px;
  }

  // Hidden, not display:none, so the buttons stay reachable by keyboard
  .tag-acts {
    display: inline-flex;
    visibility: hidden;
    position: absolute;
    top: 50%;
    right: 5px;
    transform: translateY(-50%);
    gap: 2px;
  }

  .tag-act {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1px solid var(--slax-border-strong);
    border-radius: 50%;
    background: var(--slax-surface-solid);
    color: inherit;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;

    &:hover {
      border-color: var(--slax-accent);
      color: var(--slax-accent);
    }
  }

  &:hover .tag-acts,
  &:focus-within .tag-acts {
    visibility: visible;
  }

  // BookmarkTags 在标签改造前使用的方角、透明底样式。
  // 仅切换外观，保留当前 chip 的事件与多标签交互结构。
  &.legacy {
    gap: 0;
    padding: 4px 10px;
    border-color: var(--slax-border);
    border-radius: 6px;
    background: transparent;
    color: var(--slax-text-muted);
    font-size: 13px;
    cursor: default;

    &.clickable {
      cursor: pointer;

      &:hover {
        border-color: var(--slax-border);
      }
    }

    .tag-name {
      max-width: 150px;
    }

    .tag-ai {
      display: none;
    }

    &.has-acts,
    &.compact.has-acts {
      padding-right: 10px;
    }

    .tag-acts {
      position: static;
      top: auto;
      right: auto;
      transform: none;
      gap: 0;
    }

    .tag-act {
      box-sizing: content-box;
      flex-shrink: 0;
      height: 14px;
      width: 0;
      margin: 0;
      padding: 0;
      overflow: hidden;
      border: none;
      border-left: 1px solid var(--slax-border);
      border-radius: 3px;
      background: none;
      color: var(--slax-text-light);
      opacity: 0;
      transition: all 0.15s;
    }

    &:hover .tag-act,
    &:focus-within .tag-act {
      width: 14px;
      margin-left: 6px;
      padding-left: 6px;
      opacity: 1;
    }
  }
}
</style>
